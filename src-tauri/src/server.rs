use axum::{
    body::to_bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State, Request,
    },
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    env, fs,
    io::{Read, Write},
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::broadcast;
use tower_http::services::{ServeDir, ServeFile};
use uuid::Uuid;

#[path = "atomic_state.rs"]
mod atomic_state;
#[path = "codex_sessions.rs"]
mod codex_sessions;
#[path = "attachments.rs"]
mod attachments;
#[path = "terminal_lifecycle.rs"]
mod terminal_lifecycle;

const MAX_PASTED_IMAGE_BYTES: usize = 25 * 1024 * 1024;
const DEFAULT_ADDR: &str = "127.0.0.1:8787";
const EVENTS_TICKET_TTL: Duration = Duration::from_secs(30);
const MAX_SOCKET_INPUT_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchState {
    projects: Vec<Project>,
    active_project_id: Option<String>,
    #[serde(default)]
    terminal_appearance: Option<TerminalAppearanceSettings>,
    #[serde(default)]
    custom_terminal_appearance: Option<TerminalAppearanceSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Project {
    id: String,
    name: String,
    path: String,
    status: ProjectStatus,
    last_opened_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalAppearanceSettings {
    preset: String,
    font_size: u8,
    line_height: f64,
    background: String,
    foreground: String,
    cursor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ProjectStatus {
    Idle,
    Running,
    Stopped,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalStarted {
    session_id: String,
    shell: String,
    cwd: String,
    windows_build_number: Option<u32>,
    keep_alive: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_sequence: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_truncated: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: String,
    data: String,
    sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    session_id: String,
    code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ServerEvent {
    TerminalOutput(TerminalOutput),
    TerminalExit(TerminalExit),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerEventMessage<T> {
    #[serde(rename = "type")]
    event_type: &'static str,
    payload: T,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenQuery {
    token: Option<String>,
    ticket: Option<String>,
}

#[derive(Debug, Serialize)]
struct EventsTicketResponse {
    ticket: Option<String>,
    #[serde(rename = "terminalInput")]
    terminal_input: bool,
    #[serde(rename = "sessionLease")]
    session_lease: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SocketInput {
    id: u64,
    session_id: String,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertProjectRequest {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListDirectoryRequest {
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDirectoryRequest {
    parent_path: String,
    name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryEntry {
    name: String,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryListing {
    path: String,
    parent_path: Option<String>,
    entries: Vec<DirectoryEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectIdRequest {
    project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReorderProjectsRequest {
    project_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetTerminalAppearanceRequest {
    appearance: TerminalAppearanceSettings,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalStartRequest {
    session_id: String,
    project_id: Option<String>,
    cols: u16,
    rows: u16,
    #[serde(default)]
    lease: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalWriteRequest {
    session_id: String,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalResizeRequest {
    session_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalStopRequest {
    session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalHeartbeatRequest { session_ids: Vec<String> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalBackgroundRequest { session_id: String, keep_alive: bool }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalAttachRequest { session_id: String, after_sequence: Option<u64> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionInfo {
    session_id: String,
    project_id: Option<String>,
    shell: String,
    cwd: String,
    keep_alive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePastedImageRequest {
    mime_type: String,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
struct AttachmentQuery {
    name: String,
}

#[derive(Clone)]
struct AppState {
    config: ServerConfig,
    state_store: Arc<Mutex<WorkbenchState>>,
    terminals: Arc<Mutex<HashMap<String, TerminalSession>>>,
    events: broadcast::Sender<ServerEvent>,
    events_tickets: Arc<Mutex<HashMap<String, Instant>>>,
    start_gate: Arc<Mutex<()>>,
    history_slots: Arc<tokio::sync::Semaphore>,
    cleanup_slots: Arc<tokio::sync::Semaphore>,
    start_slots: Arc<tokio::sync::Semaphore>,
}

#[derive(Clone)]
struct ServerConfig {
    addr: SocketAddr,
    token: Option<String>,
    state_file: PathBuf,
    static_dir: PathBuf,
    idle_timeout: Duration,
    max_sessions: usize,
}

struct TerminalSession {
    instance_id: Uuid,
    project_id: Option<String>,
    child: Box<dyn PtyChild + Send>,
    control_tx: mpsc::Sender<TerminalControl>,
    last_seen: Instant,
    keep_alive: bool,
    lease_enabled: bool,
    shell: String,
    cwd: String,
    output: Arc<Mutex<OutputHistory>>,
}

#[derive(Default)]
struct OutputHistory { chunks: VecDeque<(u64, String)>, bytes: usize, sequence: u64 }

impl OutputHistory {
    fn push(&mut self, data: &str) -> u64 {
        self.sequence += 1;
        self.bytes += data.len();
        self.chunks.push_back((self.sequence, data.to_owned()));
        while self.bytes > 64 * 1024 || self.chunks.len() > 1024 {
            if let Some((_, chunk)) = self.chunks.pop_front() { self.bytes -= chunk.len(); }
        }
        self.sequence
    }
    fn snapshot(&self, after: Option<u64>) -> (String, bool) {
        let after = after.unwrap_or(0);
        let first = self.chunks.front().map(|(seq, _)| *seq).unwrap_or(self.sequence + 1);
        (self.chunks.iter().filter(|(seq, _)| *seq > after).map(|(_, data)| data.as_str()).collect(),
         after.saturating_add(1) < first)
    }
}

enum TerminalControl {
    Write(String),
    WriteConfirmed(String, tokio::sync::oneshot::Sender<Result<(), String>>),
    Resize { cols: u16, rows: u16 },
    Stop,
}

impl Default for WorkbenchState {
    fn default() -> Self {
        Self {
            projects: Vec::new(),
            active_project_id: None,
            terminal_appearance: None,
            custom_terminal_appearance: None,
        }
    }
}

pub async fn run() -> Result<(), String> {
    let config = read_server_config()?;
    let state = load_state_from_disk(&config.state_file)?;
    let (events, _) = broadcast::channel(512);
    let app_state = AppState {
        config: config.clone(),
        state_store: Arc::new(Mutex::new(state)),
        terminals: Arc::new(Mutex::new(HashMap::new())),
        events,
        events_tickets: Arc::new(Mutex::new(HashMap::new())),
        start_gate: Arc::new(Mutex::new(())),
        history_slots: Arc::new(tokio::sync::Semaphore::new(2)),
        cleanup_slots: Arc::new(tokio::sync::Semaphore::new(2)),
        start_slots: Arc::new(tokio::sync::Semaphore::new(1)),
    };
    start_session_reaper(&app_state)?;

    let static_service = ServeDir::new(&config.static_dir)
        .not_found_service(ServeFile::new(config.static_dir.join("index.html")));
    let app = Router::new()
        .route("/api/load_state", get(load_state))
        .route("/api/initial_project_id", get(initial_project_id))
        .route(
            "/api/set_terminal_appearance",
            post(set_terminal_appearance),
        )
        .route("/api/list_directory", post(list_directory))
        .route("/api/create_directory", post(create_directory))
        .route("/api/upsert_project", post(upsert_project))
        .route("/api/set_active_project", post(set_active_project))
        .route("/api/reorder_projects", post(reorder_projects))
        .route("/api/remove_project", post(remove_project))
        .route("/api/open_project_window", post(open_project_window))
        .route("/api/open_project_folder", post(open_project_folder))
        .route("/api/list_codex_sessions", post(list_codex_sessions))
        .route("/api/terminal_start", post(terminal_start))
        .route("/api/terminal_write", post(terminal_write))
        .route("/api/terminal_resize", post(terminal_resize))
        .route("/api/terminal_stop", post(terminal_stop))
        .route("/api/terminal_sessions", get(terminal_sessions))
        .route("/api/terminal_heartbeat", post(terminal_heartbeat))
        .route("/api/terminal_background", post(terminal_background))
        .route("/api/terminal_attach", post(terminal_attach))
        .route("/api/save_pasted_image", post(save_pasted_image))
        .route("/api/upload_attachment", post(upload_attachment))
        .route("/api/events", get(events_ws))
        .route("/api/events_ticket", post(events_ticket))
        .fallback_service(static_service)
        .with_state(app_state.clone());

    let listener = tokio::net::TcpListener::bind(config.addr)
        .await
        .map_err(|error| error.to_string())?;
    println!("code-terminal server listening on http://{}", config.addr);
    if config.token.is_some() {
        println!("auth token enabled; open with #token=<CODE_TERMINAL_TOKEN>");
        if !config.addr.ip().is_loopback() {
            eprintln!(
                "warning: non-loopback HTTP exposes terminal traffic; use an HTTPS reverse proxy for remote access"
            );
        }
    }
    axum::serve(listener, app)
        // Terminal redraws arrive as small interactive packets; do not hold
        // subsequent frames behind Nagle/delayed TCP acknowledgements.
        .tcp_nodelay(true)
        .with_graceful_shutdown(shutdown_signal(app_state))
        .await
        .map_err(|error| error.to_string())
}

fn read_server_config() -> Result<ServerConfig, String> {
    let addr_value = env::var("CODE_TERMINAL_ADDR").unwrap_or_else(|_| DEFAULT_ADDR.into());
    let addr = parse_listen_addr(&addr_value)?;
    let token = env::var("CODE_TERMINAL_TOKEN")
        .ok()
        .filter(|value| !value.trim().is_empty());
    if !addr.ip().is_loopback() && token.is_none() {
        return Err(
            "CODE_TERMINAL_TOKEN is required when CODE_TERMINAL_ADDR is not localhost".into(),
        );
    }

    let state_file = env::var("CODE_TERMINAL_STATE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| default_state_file());
    let static_dir = env::var("CODE_TERMINAL_DIST")
        .map(PathBuf::from)
        .unwrap_or_else(|_| default_static_dir());
    if !static_dir.join("index.html").exists() {
        return Err(format!(
            "frontend dist not found at {}; run npm run build:frontend first",
            static_dir.display()
        ));
    }

    Ok(ServerConfig {
        addr,
        token,
        state_file,
        static_dir,
        idle_timeout: Duration::from_secs(read_bounded_setting("CODE_TERMINAL_IDLE_TIMEOUT_SECONDS", terminal_lifecycle::DEFAULT_IDLE_TIMEOUT.as_secs(), 2, 86400)?),
        max_sessions: read_bounded_setting("CODE_TERMINAL_MAX_SESSIONS", terminal_lifecycle::DEFAULT_MAX_SESSIONS as u64, 1, 128)? as usize,
    })
}

fn read_bounded_setting(name: &str, default: u64, min: u64, max: u64) -> Result<u64, String> {
    match env::var(name) {
        Err(env::VarError::NotPresent) => Ok(default),
        value => value.ok().and_then(|v| v.parse::<u64>().ok()).filter(|v| *v >= min && *v <= max)
            .ok_or_else(|| format!("{name} must be between {min} and {max}")),
    }
}

fn start_session_reaper(state: &AppState) -> Result<(), String> {
    let terminals = Arc::downgrade(&state.terminals);
    let timeout = state.config.idle_timeout;
    let events = state.events.clone();
    thread::Builder::new().name("terminal-reaper".into()).spawn(move || {
        loop {
            thread::sleep(timeout.min(Duration::from_secs(5)));
            let Some(terminals) = terminals.upgrade() else { break };
            let expired = {
                let Ok(mut sessions) = terminals.lock() else { continue };
                let now = Instant::now();
                let ids: Vec<_> = sessions.iter().filter(|(_, s)| s.lease_enabled &&
                    terminal_lifecycle::expired(s.last_seen, s.keep_alive, now, timeout))
                    .map(|(id, _)| id.clone()).collect();
                ids.into_iter().filter_map(|id| sessions.remove(&id).map(|s| (id, s))).collect::<Vec<_>>()
            };
            for (id, session) in expired {
                stop_detached_terminal_session(session);
                let _ = events.send(ServerEvent::TerminalExit(TerminalExit { session_id: id, code: None }));
                eprintln!("reclaimed disconnected terminal session");
            }
        }
    }).map_err(|e| format!("Unable to start terminal cleanup: {e}"))?;
    Ok(())
}

fn parse_listen_addr(value: &str) -> Result<SocketAddr, String> {
    let trimmed = value.trim();
    let normalized = if let Some(port) = trimmed.strip_prefix("localhost:") {
        format!("127.0.0.1:{port}")
    } else {
        trimmed.to_string()
    };

    normalized
        .parse()
        .map_err(|error| format!("invalid CODE_TERMINAL_ADDR \"{value}\": {error}"))
}

fn default_state_file() -> PathBuf {
    env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".code-terminal")
        .join("workbench-state.json")
}

fn default_static_dir() -> PathBuf {
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("dist")
}

async fn shutdown_signal(state: AppState) {
    let _ = tokio::signal::ctrl_c().await;
    if let Ok(mut sessions) = state.terminals.lock() {
        for (_, session) in sessions.drain() {
            stop_detached_terminal_session(session);
        }
    }
}

fn authorize(
    config: &ServerConfig,
    headers: &HeaderMap,
    query_token: Option<&str>,
) -> Result<(), ApiError> {
    let Some(expected_token) = config.token.as_deref() else {
        return Ok(());
    };

    if query_token == Some(expected_token) {
        return Ok(());
    }

    let auth_token = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    if auth_token == Some(expected_token) {
        return Ok(());
    }

    let header_token = headers
        .get("x-code-terminal-token")
        .and_then(|value| value.to_str().ok());
    if header_token == Some(expected_token) {
        return Ok(());
    }

    Err(ApiError::unauthorized())
}

async fn load_state(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> Result<Json<WorkbenchState>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    Ok(Json(state.state_store.lock().map_err(lock_error)?.clone()))
}

async fn initial_project_id(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> Result<Json<Option<String>>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    Ok(Json(None))
}

async fn set_terminal_appearance(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<SetTerminalAppearanceRequest>,
) -> Result<Json<WorkbenchState>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    let next_state = {
        let mut current = state.state_store.lock().map_err(lock_error)?;
        let appearance = normalize_terminal_appearance(request.appearance);
        if appearance.preset == "custom" {
            current.custom_terminal_appearance = Some(appearance.clone());
        }
        current.terminal_appearance = Some(appearance);
        save_state_to_disk(&state.config.state_file, &current)?;
        current.clone()
    };
    Ok(Json(next_state))
}

async fn list_directory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<ListDirectoryRequest>,
) -> Result<Json<DirectoryListing>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    Ok(Json(directory_listing(request.path.as_deref())?))
}

async fn create_directory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<CreateDirectoryRequest>,
) -> Result<Json<DirectoryListing>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    let parent = normalize_directory_path(&request.parent_path)?;
    let name = normalize_new_directory_name(&request.name)?;
    let target = parent.join(name);
    if target.exists() {
        return Err(ApiError::bad_request("文件夹已存在"));
    }

    fs::create_dir(&target).map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(directory_listing(Some(&path_to_string(&parent)))?))
}

async fn upsert_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<UpsertProjectRequest>,
) -> Result<Json<WorkbenchState>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    let path = normalize_project_path(&request.path)?;
    let now = now_unix();
    let name = project_name(&path);
    let next_state = {
        let mut current = state.state_store.lock().map_err(lock_error)?;
        if let Some(project) = current
            .projects
            .iter_mut()
            .find(|project| project.path == path)
        {
            project.last_opened_at = now;
            current.active_project_id = Some(project.id.clone());
        } else {
            let id = Uuid::new_v4().to_string();
            current.projects.insert(
                0,
                Project {
                    id: id.clone(),
                    name,
                    path,
                    status: ProjectStatus::Idle,
                    last_opened_at: now,
                },
            );
            current.active_project_id = Some(id);
        }
        save_state_to_disk(&state.config.state_file, &current)?;
        current.clone()
    };
    Ok(Json(next_state))
}

async fn set_active_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<ProjectIdRequest>,
) -> Result<Json<WorkbenchState>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    let next_state = {
        let mut current = state.state_store.lock().map_err(lock_error)?;
        if !current
            .projects
            .iter()
            .any(|project| project.id == request.project_id)
        {
            return Err(ApiError::bad_request("项目不存在"));
        }
        current.active_project_id = Some(request.project_id);
        save_state_to_disk(&state.config.state_file, &current)?;
        current.clone()
    };
    Ok(Json(next_state))
}

async fn reorder_projects(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<ReorderProjectsRequest>,
) -> Result<Json<WorkbenchState>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    let next_state = {
        let mut current = state.state_store.lock().map_err(lock_error)?;
        if request.project_ids.len() != current.projects.len() {
            return Err(ApiError::bad_request("项目排序不完整"));
        }

        let mut remaining = current.projects.clone();
        let mut ordered_projects = Vec::with_capacity(remaining.len());
        for project_id in request.project_ids {
            let index = remaining
                .iter()
                .position(|project| project.id == project_id)
                .ok_or_else(|| ApiError::bad_request("项目排序包含未知项目"))?;
            ordered_projects.push(remaining.remove(index));
        }
        if !remaining.is_empty() {
            return Err(ApiError::bad_request("项目排序包含重复项目"));
        }

        current.projects = ordered_projects;
        if !current
            .projects
            .iter()
            .any(|project| Some(&project.id) == current.active_project_id.as_ref())
        {
            current.active_project_id = current.projects.first().map(|project| project.id.clone());
        }
        save_state_to_disk(&state.config.state_file, &current)?;
        current.clone()
    };
    Ok(Json(next_state))
}

async fn remove_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<ProjectIdRequest>,
) -> Result<Json<WorkbenchState>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    let permit = state.cleanup_slots.clone().try_acquire_owned()
        .map_err(|_| ApiError::busy("正在结束其他终端，请稍后重试"))?;
    let terminals = state.terminals.clone();
    let project_id = request.project_id.clone();
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        stop_terminals_for_project(&terminals, &project_id)
    }).await.map_err(|e| ApiError::internal(e.to_string()))??;
    let next_state = {
        let mut current = state.state_store.lock().map_err(lock_error)?;
        current
            .projects
            .retain(|project| project.id != request.project_id);
        if current.active_project_id.as_deref() == Some(&request.project_id) {
            current.active_project_id = current.projects.first().map(|project| project.id.clone());
        }
        save_state_to_disk(&state.config.state_file, &current)?;
        current.clone()
    };
    Ok(Json(next_state))
}

async fn open_project_window(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> Result<StatusCode, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    Ok(StatusCode::NO_CONTENT)
}

async fn open_project_folder(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<ProjectIdRequest>,
) -> Result<StatusCode, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    let path = {
        let current = state.state_store.lock().map_err(lock_error)?;
        let project = current
            .projects
            .iter()
            .find(|project| project.id == request.project_id)
            .ok_or_else(|| ApiError::bad_request("项目不存在"))?;
        PathBuf::from(&project.path)
    };
    if !path.exists() || !path.is_dir() {
        return Err(ApiError::bad_request("项目路径不存在"));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_codex_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<ProjectIdRequest>,
) -> Result<Json<Vec<codex_sessions::CodexSessionSummary>>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    let path = {
        let current = state.state_store.lock().map_err(lock_error)?;
        current
            .projects
            .iter()
            .find(|project| project.id == request.project_id)
            .map(|project| project.path.clone())
            .ok_or_else(|| ApiError::bad_request("项目不存在"))?
    };

    terminal_lifecycle::check_task_capacity().map_err(ApiError::busy)?;
    let permit = state.history_slots.clone().try_acquire_owned()
        .map_err(|_| ApiError::busy("历史会话查询繁忙，请稍后重试"))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        codex_sessions::list_codex_sessions(&path, 12)
    })
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?
        .map(Json)
        .map_err(ApiError::internal)
}

async fn terminal_start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<TerminalStartRequest>,
) -> Result<Json<TerminalStarted>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    let permit = state.start_slots.clone().try_acquire_owned()
        .map_err(|_| ApiError::busy("正在创建终端，请稍后重试"))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        start_terminal_session(&state, request.session_id, request.project_id, request.cols, request.rows, request.lease)
    }).await.map_err(|e| ApiError::internal(e.to_string()))?.map(Json)
}

async fn terminal_write(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<TerminalWriteRequest>,
) -> Result<StatusCode, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    send_terminal_control(
        &state.terminals,
        &request.session_id,
        TerminalControl::Write(request.data),
    )?;
    Ok(StatusCode::NO_CONTENT)
}

async fn terminal_resize(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<TerminalResizeRequest>,
) -> Result<StatusCode, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    send_terminal_control(
        &state.terminals,
        &request.session_id,
        TerminalControl::Resize {
            cols: request.cols,
            rows: request.rows,
        },
    )?;
    Ok(StatusCode::NO_CONTENT)
}

async fn terminal_stop(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<TerminalStopRequest>,
) -> Result<StatusCode, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    let permit = state.cleanup_slots.clone().try_acquire_owned()
        .map_err(|_| ApiError::busy("正在结束其他终端，请稍后重试"))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        stop_terminal_session(&state.terminals, &request.session_id)
    }).await.map_err(|e| ApiError::internal(e.to_string()))??;
    Ok(StatusCode::NO_CONTENT)
}

async fn terminal_sessions(
    State(state): State<AppState>, headers: HeaderMap, Query(query): Query<TokenQuery>,
) -> Result<Json<Vec<TerminalSessionInfo>>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    let sessions = state.terminals.lock().map_err(lock_error)?;
    Ok(Json(sessions.iter().map(|(id, s)| TerminalSessionInfo {
        session_id: id.clone(), project_id: s.project_id.clone(), shell: s.shell.clone(),
        cwd: s.cwd.clone(), keep_alive: s.keep_alive,
    }).collect()))
}

async fn terminal_heartbeat(
    State(state): State<AppState>, headers: HeaderMap, Query(query): Query<TokenQuery>,
    Json(request): Json<TerminalHeartbeatRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    if request.session_ids.len() > 128 || request.session_ids.iter().any(|id| id.len() > 256) {
        return Err(ApiError::bad_request("会话列表过大"));
    }
    let mut sessions = state.terminals.lock().map_err(lock_error)?;
    let mut missing = Vec::new();
    for id in request.session_ids {
        if let Some(session) = sessions.get_mut(&id) {
            session.last_seen = Instant::now();
            session.lease_enabled = true;
        }
        else { missing.push(id); }
    }
    Ok(Json(serde_json::json!({"missingSessionIds": missing})))
}

async fn terminal_background(
    State(state): State<AppState>, headers: HeaderMap, Query(query): Query<TokenQuery>,
    Json(request): Json<TerminalBackgroundRequest>,
) -> Result<StatusCode, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    let mut sessions = state.terminals.lock().map_err(lock_error)?;
    let session = sessions.get_mut(&request.session_id).ok_or_else(|| ApiError::not_found("终端已结束"))?;
    session.keep_alive = request.keep_alive;
    session.lease_enabled = true;
    session.last_seen = Instant::now();
    Ok(StatusCode::NO_CONTENT)
}

async fn terminal_attach(
    State(state): State<AppState>, headers: HeaderMap, Query(query): Query<TokenQuery>,
    Json(request): Json<TerminalAttachRequest>,
) -> Result<Json<TerminalStarted>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    let mut sessions = state.terminals.lock().map_err(lock_error)?;
    let session = sessions.get_mut(&request.session_id).ok_or_else(|| ApiError::not_found("终端已结束，可新建终端或恢复 Codex 历史会话"))?;
    session.last_seen = Instant::now();
    let output = session.output.lock().map_err(lock_error)?;
    session.lease_enabled = true;
    let (data, truncated) = output.snapshot(request.after_sequence);
    Ok(Json(TerminalStarted {
        session_id: request.session_id, shell: session.shell.clone(), cwd: session.cwd.clone(),
        windows_build_number: None, keep_alive: session.keep_alive, output: Some(data),
        output_sequence: Some(output.sequence),
        output_truncated: Some(truncated),
    }))
}

async fn save_pasted_image(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(request): Json<SavePastedImageRequest>,
) -> Result<Json<String>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    Ok(Json(save_pasted_image_to_disk(
        request.mime_type,
        request.bytes,
    )?))
}

async fn upload_attachment(
    State(state): State<AppState>,
    Query(query): Query<AttachmentQuery>,
    request: Request,
) -> Result<Json<String>, ApiError> {
    // Authenticate before reading any file bytes; this route alone has a 25 MB limit.
    authorize(&state.config, request.headers(), None)?;
    let bytes = to_bytes(request.into_body(), attachments::MAX_ATTACHMENT_BYTES).await
        .map_err(|_| ApiError { status: StatusCode::PAYLOAD_TOO_LARGE, message: "文件上传失败或超过 25 MB".into() })?;
    let root = state.config.state_file.parent().unwrap_or(Path::new(".")).join("uploads");
    let path = tokio::task::spawn_blocking(move || attachments::save_attachment(&root, &query.name, &bytes))
        .await.map_err(|e| ApiError::internal(e.to_string()))?
        .map_err(ApiError::internal)?;
    Ok(Json(path))
}

async fn events_ws(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    let ticket_authorized = query
        .ticket
        .as_deref()
        .map(|ticket| consume_events_ticket(&state.events_tickets, ticket))
        .unwrap_or(false);
    if !ticket_authorized && authorize(&state.config, &headers, query.token.as_deref()).is_err() {
        let error = ApiError::unauthorized();
        return error.into_response();
    }

    ws.max_message_size(MAX_SOCKET_INPUT_BYTES * 8)
        .on_upgrade(move |socket| events_socket(socket, state))
}

async fn events_ticket(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> Result<Json<EventsTicketResponse>, ApiError> {
    authorize(&state.config, &headers, query.token.as_deref())?;
    if state.config.token.is_none() {
        return Ok(Json(EventsTicketResponse {
            ticket: None,
            terminal_input: true,
            session_lease: true,
        }));
    }

    let ticket = Uuid::new_v4().to_string();
    let now = Instant::now();
    let mut tickets = state.events_tickets.lock().map_err(lock_error)?;
    tickets.retain(|_, issued_at| now.duration_since(*issued_at) <= EVENTS_TICKET_TTL);
    tickets.insert(ticket.clone(), now);
    Ok(Json(EventsTicketResponse {
        ticket: Some(ticket),
        terminal_input: true,
        session_lease: true,
    }))
}

fn consume_events_ticket(tickets: &Mutex<HashMap<String, Instant>>, ticket: &str) -> bool {
    let Ok(mut tickets) = tickets.lock() else {
        return false;
    };
    tickets
        .remove(ticket)
        .map(|issued_at| issued_at.elapsed() <= EVENTS_TICKET_TTL)
        .unwrap_or(false)
}

fn parse_socket_input(text: &str, last_id: u64) -> Result<SocketInput, ApiError> {
    let input: SocketInput =
        serde_json::from_str(text).map_err(|_| ApiError::bad_request("无效的终端输入消息"))?;
    if input.id <= last_id
        || input.id > 9_007_199_254_740_991
        || input.session_id.is_empty()
        || input.session_id.len() > 256
        || input.data.is_empty()
        || input.data.len() > MAX_SOCKET_INPUT_BYTES
    {
        return Err(ApiError::bad_request("终端输入序号或大小无效"));
    }
    Ok(input)
}

async fn events_socket(socket: WebSocket, state: AppState) {
    let mut events = state.events.subscribe();
    let (mut sender, mut receiver) = socket.split();
    let mut last_id = 0;

    loop {
        tokio::select! {
          incoming = receiver.next() => {
            let Some(Ok(message)) = incoming else { break };
            match message {
                Message::Text(text) => {
                    // Messages are handled in wire order on this authenticated socket.
                    // Invalid/duplicate frames close it rather than replaying uncertain input.
                    let Ok(input) = parse_socket_input(&text, last_id) else { break };
                    last_id = input.id;
                    let (confirm, received) = tokio::sync::oneshot::channel();
                    let result = match send_terminal_control(&state.terminals, &input.session_id, TerminalControl::WriteConfirmed(input.data, confirm)) {
                        Err(error) => Err(error),
                        Ok(()) => match tokio::time::timeout(Duration::from_secs(4), received).await {
                            Ok(Ok(Ok(()))) => Ok(()),
                            _ => Err(ApiError::internal("终端写入失败或超时")),
                        },
                    };
                    let failed = result.is_err();
                    let reply = serde_json::json!({"type":"terminal-input-ack","id":input.id,
                        "error":result.err().map(|error| error.message)}).to_string();
                    if sender.send(Message::Text(reply)).await.is_err() || failed { break; }
                }
                Message::Close(_) | Message::Binary(_) => break,
                Message::Ping(data) => { if sender.send(Message::Pong(data)).await.is_err() { break; } }
                Message::Pong(_) => {}
            }
          }
          event = events.recv() => { match event {
            Ok(event) => {
                let message = match event {
                    ServerEvent::TerminalOutput(payload) => {
                        serde_json::to_string(&ServerEventMessage {
                            event_type: "terminal-output",
                            payload,
                        })
                    }
                    ServerEvent::TerminalExit(payload) => {
                        serde_json::to_string(&ServerEventMessage {
                            event_type: "terminal-exit",
                            payload,
                        })
                    }
                };
                let Ok(message) = message else {
                    continue;
                };
                if sender.send(Message::Text(message)).await.is_err() {
                    break;
                }
            }
            // Do not silently skip output: reconnect resumes from the buffered sequence.
            Err(broadcast::error::RecvError::Lagged(_)) => break,
            Err(broadcast::error::RecvError::Closed) => break,
          } }
        }
    }
}

fn start_terminal_session(
    state: &AppState,
    session_id: String,
    project_id: Option<String>,
    cols: u16,
    rows: u16,
    lease_enabled: bool,
) -> Result<TerminalStarted, ApiError> {
    let _starting = state.start_gate.lock().map_err(lock_error)?;
    if session_id.is_empty() || session_id.len() > 256 {
        return Err(ApiError::bad_request("终端会话标识无效"));
    }
    if state.terminals.lock().map_err(lock_error)?.len() >= state.config.max_sessions {
        return Err(ApiError::busy("终端会话已达上限，请先关闭不需要的会话（含后台保留会话）"));
    }
    terminal_lifecycle::check_task_capacity().map_err(ApiError::busy)?;
    let cwd = resolve_terminal_cwd(&state.state_store, project_id.as_deref())?;
    if state
        .terminals
        .lock()
        .map_err(lock_error)?
        .contains_key(&session_id)
    {
        return Err(ApiError::bad_request("终端会话已存在"));
    }

    let (program, args, shell_label) = default_terminal_shell();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let mut command = CommandBuilder::new(program);
    for arg in args {
        command.arg(arg);
    }
    configure_terminal_environment(&mut command);
    command.cwd(cwd.clone());

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let child = pair.slave.spawn_command(command)
        .map_err(|error| ApiError::internal(format!("启动本地终端失败：{error}")))?;
    drop(pair.slave);
    let master = pair.master;
    let (control_tx, control_rx) = mpsc::channel::<TerminalControl>();
    let instance_id = Uuid::new_v4();
    let output_session_id = session_id.clone();
    let exit_session_id = session_id.clone();
    let events_for_output = state.events.clone();
    let events_for_exit = state.events.clone();
    let terminals_for_exit = state.terminals.clone();
    let output_history = Arc::new(Mutex::new(OutputHistory::default()));

    {
        let mut sessions = state.terminals.lock().map_err(lock_error)?;
        if sessions.contains_key(&session_id) {
            let mut child = child;
            let _ = control_tx.send(TerminalControl::Stop);
            let _ = child.kill();
            return Err(ApiError::bad_request("终端会话已存在"));
        }
        sessions.insert(
            session_id.clone(),
            TerminalSession {
                instance_id,
                project_id,
                child,
                control_tx,
                last_seen: Instant::now(),
                keep_alive: false,
                lease_enabled,
                shell: shell_label.clone(),
                cwd: path_to_string(&cwd),
                output: output_history.clone(),
            },
        );
    }

    if let Err(error) = thread::Builder::new().name("terminal-control".into()).spawn(move || {
        let mut writer = writer;
        let master = master;
        while let Ok(message) = control_rx.recv() {
            match message {
                TerminalControl::Write(data) => {
                    if writer
                        .write_all(data.as_bytes())
                        .and_then(|_| writer.flush())
                        .is_err()
                    {
                        break;
                    }
                }
                TerminalControl::WriteConfirmed(data, confirm) => {
                    let result = writer
                        .write_all(data.as_bytes())
                        .and_then(|_| writer.flush())
                        .map_err(|error| error.to_string());
                    let failed = result.is_err();
                    let _ = confirm.send(result);
                    if failed {
                        break;
                    }
                }
                TerminalControl::Resize { cols, rows } => {
                    let _ = master.resize(PtySize {
                        rows: rows.max(8),
                        cols: cols.max(20),
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
                TerminalControl::Stop => break,
            }
        }
    }) {
        let _ = stop_terminal_session(&state.terminals, &session_id);
        return Err(ApiError::busy(format!("无法分配终端线程：{error}")));
    }

    if let Err(error) = thread::Builder::new().name("terminal-output".into()).spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut pending_utf8 = Vec::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => emit_terminal_output(
                    &events_for_output,
                    &output_session_id,
                    &mut pending_utf8,
                    &buffer[..size],
                    &output_history,
                ),
                Err(_) => break,
            }
        }
        flush_terminal_output(&events_for_output, &output_session_id, &mut pending_utf8, &output_history);
        let _ = events_for_exit.send(ServerEvent::TerminalExit(TerminalExit {
            session_id: exit_session_id.clone(),
            code: None,
        }));
        release_naturally_exited_terminal(&terminals_for_exit, &exit_session_id, instance_id);
    }) {
        let _ = stop_terminal_session(&state.terminals, &session_id);
        return Err(ApiError::busy(format!("无法分配终端线程：{error}")));
    }

    Ok(TerminalStarted {
        session_id,
        shell: shell_label,
        cwd: path_to_string(&cwd),
        windows_build_number: None,
        keep_alive: false,
        output: None,
        output_sequence: None,
        output_truncated: None,
    })
}

fn send_terminal_control(
    terminals: &Arc<Mutex<HashMap<String, TerminalSession>>>,
    session_id: &str,
    control: TerminalControl,
) -> Result<(), ApiError> {
    let control_tx = {
        let mut sessions = terminals.lock().map_err(lock_error)?;
        sessions
            .get_mut(session_id)
            .map(|session| {
                session.last_seen = Instant::now();
                session.control_tx.clone()
            })
            .ok_or_else(|| ApiError::not_found("终端会话不存在"))?
    };
    control_tx
        .send(control)
        .map_err(|_| ApiError::not_found("终端会话已关闭"))
}

fn stop_terminal_session(
    terminals: &Arc<Mutex<HashMap<String, TerminalSession>>>,
    session_id: &str,
) -> Result<(), ApiError> {
    let session = terminals.lock().map_err(lock_error)?.remove(session_id);
    if let Some(session) = session {
        stop_detached_terminal_session(session);
    }
    Ok(())
}

fn stop_terminals_for_project(
    terminals: &Arc<Mutex<HashMap<String, TerminalSession>>>,
    project_id: &str,
) -> Result<(), ApiError> {
    let sessions = {
        let mut current = terminals.lock().map_err(lock_error)?;
        let matching = current
            .iter()
            .filter_map(|(session_id, session)| {
                if session.project_id.as_deref() == Some(project_id) {
                    Some(session_id.clone())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();

        matching
            .into_iter()
            .filter_map(|session_id| current.remove(&session_id))
            .collect::<Vec<_>>()
    };

    for session in sessions {
        stop_detached_terminal_session(session);
    }
    Ok(())
}

fn stop_detached_terminal_session(mut session: TerminalSession) {
    let _ = session.control_tx.send(TerminalControl::Stop);
    if let Some(pid) = session.child.process_id() { terminal_lifecycle::stop_pty_processes(pid); }
    let _ = session.child.kill();
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        match session.child.try_wait() {
            Ok(Some(_)) | Err(_) => break,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Ok(None) => { eprintln!("terminal child has not exited after termination"); break; }
        }
    }
}

fn release_naturally_exited_terminal(
    terminals: &Arc<Mutex<HashMap<String, TerminalSession>>>,
    session_id: &str,
    instance_id: Uuid,
) {
    let session = terminals.lock().ok().and_then(|mut sessions| {
        let is_same_instance = sessions
            .get(session_id)
            .map(|session| session.instance_id == instance_id)
            .unwrap_or(false);
        is_same_instance
            .then(|| sessions.remove(session_id))
            .flatten()
    });
    if let Some(session) = session {
        stop_detached_terminal_session(session);
    }
}

fn emit_terminal_output(
    events: &broadcast::Sender<ServerEvent>,
    session_id: &str,
    pending_utf8: &mut Vec<u8>,
    bytes: &[u8],
    output: &Mutex<OutputHistory>,
) {
    pending_utf8.extend_from_slice(bytes);
    loop {
        if pending_utf8.is_empty() {
            return;
        }

        match std::str::from_utf8(pending_utf8) {
            Ok(text) => {
                let data = text.to_string();
                pending_utf8.clear();
                emit_terminal_text(events, session_id, data, output);
                return;
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                if valid_up_to > 0 {
                    let data = String::from_utf8_lossy(&pending_utf8[..valid_up_to]).to_string();
                    pending_utf8.drain(..valid_up_to);
                    emit_terminal_text(events, session_id, data, output);
                    continue;
                }

                if let Some(error_len) = error.error_len() {
                    let data = String::from_utf8_lossy(&pending_utf8[..error_len]).to_string();
                    pending_utf8.drain(..error_len);
                    emit_terminal_text(events, session_id, data, output);
                    continue;
                }

                return;
            }
        }
    }
}

fn flush_terminal_output(
    events: &broadcast::Sender<ServerEvent>,
    session_id: &str,
    pending_utf8: &mut Vec<u8>,
    output: &Mutex<OutputHistory>,
) {
    if pending_utf8.is_empty() {
        return;
    }

    let data = String::from_utf8_lossy(pending_utf8).to_string();
    pending_utf8.clear();
    emit_terminal_text(events, session_id, data, output);
}

fn emit_terminal_text(events: &broadcast::Sender<ServerEvent>, session_id: &str, data: String, output: &Mutex<OutputHistory>) {
    if data.is_empty() {
        return;
    }

    let sequence = if let Ok(mut history) = output.lock() {
        history.push(&data)
    } else { 0 };
    let _ = events.send(ServerEvent::TerminalOutput(TerminalOutput {
        session_id: session_id.to_string(),
        data,
        sequence,
    }));
}

fn save_pasted_image_to_disk(mime_type: String, bytes: Vec<u8>) -> Result<String, ApiError> {
    if bytes.is_empty() {
        return Err(ApiError::bad_request("剪贴板图片为空"));
    }
    if bytes.len() > MAX_PASTED_IMAGE_BYTES {
        return Err(ApiError::bad_request("剪贴板图片过大，无法临时保存"));
    }

    let extension = pasted_image_extension(&mime_type)
        .ok_or_else(|| ApiError::bad_request(format!("不支持的图片类型：{mime_type}")))?;
    let dir = env::temp_dir().join("code-terminal").join("pasted-images");
    fs::create_dir_all(&dir).map_err(|error| ApiError::internal(error.to_string()))?;
    let path = dir.join(format!("paste-{}.{}", Uuid::new_v4(), extension));
    fs::write(&path, bytes).map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(path_to_string(&path))
}

fn load_state_from_disk(path: &Path) -> Result<WorkbenchState, String> {
    let mut state: WorkbenchState = atomic_state::load_json(path)?.unwrap_or_default();
    for project in &mut state.projects {
        project.status = ProjectStatus::Stopped;
        project.path = normalize_existing_path(&project.path);
    }
    Ok(state)
}

fn save_state_to_disk(path: &Path, state: &WorkbenchState) -> Result<(), ApiError> {
    atomic_state::save_json(path, state).map_err(ApiError::internal)
}

fn normalize_project_path(path: &str) -> Result<String, ApiError> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(ApiError::bad_request("目录不存在"));
    }
    if !path.is_dir() {
        return Err(ApiError::bad_request("请选择目录"));
    }
    canonicalize_clean(&path).map(|path| path_to_string(&path))
}

fn directory_listing(path: Option<&str>) -> Result<DirectoryListing, ApiError> {
    let path = match path.map(str::trim).filter(|value| !value.is_empty()) {
        Some(path) => normalize_directory_path(path)?,
        None => env::current_dir()
            .map_err(|error| ApiError::internal(error.to_string()))
            .and_then(|path| canonicalize_clean(&path))?,
    };
    let parent_path = path.parent().and_then(|parent| {
        canonicalize_clean(parent)
            .ok()
            .map(|parent| path_to_string(&parent))
    });
    let mut entries = fs::read_dir(&path)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .filter_map(|entry| directory_entry(entry.ok()?))
        .collect::<Vec<_>>();

    entries.sort_by_key(|entry| entry.name.to_ascii_lowercase());

    Ok(DirectoryListing {
        path: path_to_string(&path),
        parent_path,
        entries,
    })
}

fn directory_entry(entry: fs::DirEntry) -> Option<DirectoryEntry> {
    let file_type = entry.file_type().ok()?;
    if !file_type.is_dir() {
        return None;
    }

    let name = entry.file_name().to_string_lossy().to_string();
    let path = canonicalize_clean(&entry.path()).ok()?;
    Some(DirectoryEntry {
        name,
        path: path_to_string(&path),
    })
}

fn normalize_directory_path(path: &str) -> Result<PathBuf, ApiError> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(ApiError::bad_request("目录不存在"));
    }
    if !path.is_dir() {
        return Err(ApiError::bad_request("请选择目录"));
    }
    canonicalize_clean(&path)
}

fn normalize_new_directory_name(name: &str) -> Result<String, ApiError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("请输入文件夹名称"));
    }
    if name == "." || name == ".." {
        return Err(ApiError::bad_request("文件夹名称无效"));
    }
    if name
        .chars()
        .any(|character| character == '/' || character == '\\' || character.is_control())
    {
        return Err(ApiError::bad_request("文件夹名称不能包含路径分隔符"));
    }

    Ok(name.to_string())
}

fn resolve_terminal_cwd(
    store: &Arc<Mutex<WorkbenchState>>,
    project_id: Option<&str>,
) -> Result<PathBuf, ApiError> {
    if let Some(project_id) = project_id {
        let state = store.lock().map_err(lock_error)?;
        let project = state
            .projects
            .iter()
            .find(|project| project.id == project_id)
            .ok_or_else(|| ApiError::bad_request("项目不存在"))?;
        let path = PathBuf::from(&project.path);
        if !path.exists() || !path.is_dir() {
            return Err(ApiError::bad_request("项目路径不存在"));
        }
        return canonicalize_clean(&path);
    }

    env::current_dir()
        .map_err(|error| ApiError::internal(error.to_string()))
        .map(clean_windows_verbatim_path)
}

fn canonicalize_clean(path: &Path) -> Result<PathBuf, ApiError> {
    path.canonicalize()
        .map(clean_windows_verbatim_path)
        .map_err(|error| ApiError::internal(error.to_string()))
}

fn normalize_existing_path(path: &str) -> String {
    let path = PathBuf::from(clean_windows_verbatim_path_str(path));
    if path.exists() {
        match canonicalize_clean(&path) {
            Ok(path) => path_to_string(&path),
            Err(_) => path_to_string(&path),
        }
    } else {
        path_to_string(&path)
    }
}

fn path_to_string(path: &Path) -> String {
    clean_windows_verbatim_path_str(&path.to_string_lossy())
}

fn clean_windows_verbatim_path(path: PathBuf) -> PathBuf {
    PathBuf::from(clean_windows_verbatim_path_str(&path.to_string_lossy()))
}

fn clean_windows_verbatim_path_str(path: &str) -> String {
    #[cfg(windows)]
    {
        if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }
        if let Some(rest) = path.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }

    path.to_string()
}

fn project_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Project")
        .to_string()
}

fn normalize_terminal_appearance(
    appearance: TerminalAppearanceSettings,
) -> TerminalAppearanceSettings {
    TerminalAppearanceSettings {
        preset: if is_terminal_theme_preset(&appearance.preset) {
            appearance.preset
        } else {
            "custom".into()
        },
        font_size: appearance.font_size.clamp(10, 22),
        line_height: clamp_terminal_line_height(appearance.line_height),
        background: sanitize_hex_color(&appearance.background, "#070b10"),
        foreground: sanitize_hex_color(&appearance.foreground, "#d7dde7"),
        cursor: sanitize_hex_color(&appearance.cursor, "#8ab4ff"),
    }
}

fn is_terminal_theme_preset(value: &str) -> bool {
    matches!(
        value,
        "workbench"
            | "daylight"
            | "midnight"
            | "ocean"
            | "jade"
            | "violet"
            | "rose"
            | "amber"
            | "classic"
            | "custom"
    )
}

fn clamp_terminal_line_height(value: f64) -> f64 {
    if !value.is_finite() {
        return 1.28;
    }
    (value.clamp(1.0, 1.8) * 100.0).round() / 100.0
}

fn sanitize_hex_color(value: &str, fallback: &str) -> String {
    if value.len() == 7
        && value.starts_with('#')
        && value
            .chars()
            .skip(1)
            .all(|character| character.is_ascii_hexdigit())
    {
        value.to_string()
    } else {
        fallback.to_string()
    }
}

#[cfg(windows)]
fn default_terminal_shell() -> (String, Vec<String>, String) {
    (
        "powershell.exe".into(),
        vec![
            "-NoLogo".into(),
            "-NoProfile".into(),
            "-NoExit".into(),
            "-Command".into(),
            powershell_startup_script().into(),
        ],
        "PowerShell".into(),
    )
}

#[cfg(not(windows))]
fn default_terminal_shell() -> (String, Vec<String>, String) {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    (shell.clone(), Vec::new(), shell)
}

fn configure_terminal_environment(command: &mut CommandBuilder) {
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    #[cfg(windows)]
    command.env("POWERSHELL_UPDATECHECK", "Off");
}

#[cfg(windows)]
fn powershell_startup_script() -> &'static str {
    "$ProgressPreference='SilentlyContinue';try{$c=Get-Command Set-PSReadLineOption -ErrorAction SilentlyContinue;if($c){if($c.Parameters.ContainsKey('PredictionSource')){Set-PSReadLineOption -PredictionSource None -ErrorAction SilentlyContinue};if($c.Parameters.ContainsKey('BellStyle')){Set-PSReadLineOption -BellStyle None -ErrorAction SilentlyContinue}}}catch{}"
}

fn pasted_image_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type.to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/bmp" => Some("bmp"),
        _ => None,
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> ApiError {
    ApiError::internal(error.to_string())
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn busy(message: impl Into<String>) -> Self {
        Self { status: StatusCode::SERVICE_UNAVAILABLE, message: message.into() }
    }
    fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: "未授权".into(),
        }
    }

    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut headers = HeaderMap::new();
        headers.insert(
            "content-type",
            HeaderValue::from_static("text/plain; charset=utf-8"),
        );
        (self.status, headers, self.message).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server_config_with_token(token: Option<&str>) -> ServerConfig {
        ServerConfig {
            addr: "127.0.0.1:8787".parse().unwrap(),
            token: token.map(str::to_string),
            state_file: PathBuf::from("state.json"),
            static_dir: PathBuf::from("dist"),
            idle_timeout: terminal_lifecycle::DEFAULT_IDLE_TIMEOUT,
            max_sessions: terminal_lifecycle::DEFAULT_MAX_SESSIONS,
        }
    }

    #[test]
    fn authorization_prefers_bearer_and_keeps_query_compatibility() {
        let config = server_config_with_token(Some("expected-token"));
        let mut headers = HeaderMap::new();
        headers.insert(
            "authorization",
            HeaderValue::from_static("Bearer expected-token"),
        );

        assert!(authorize(&config, &headers, None).is_ok());
        assert!(authorize(&config, &HeaderMap::new(), Some("expected-token")).is_ok());
        assert!(authorize(&config, &HeaderMap::new(), None).is_err());
    }

    #[test]
    fn events_ticket_is_single_use_and_expires() {
        let tickets = Mutex::new(HashMap::from([("single-use".into(), Instant::now())]));
        assert!(consume_events_ticket(&tickets, "single-use"));
        assert!(!consume_events_ticket(&tickets, "single-use"));

        tickets.lock().unwrap().insert(
            "expired".into(),
            Instant::now() - EVENTS_TICKET_TTL - Duration::from_secs(1),
        );
        assert!(!consume_events_ticket(&tickets, "expired"));
    }

    #[test]
    fn socket_input_rejects_replay_invalid_shapes_and_oversized_utf8() {
        let frame = r#"{"id":1,"sessionId":"s","data":"hello"}"#;
        assert_eq!(parse_socket_input(frame, 0).unwrap().data, "hello");
        assert!(parse_socket_input(frame, 1).is_err());
        assert!(parse_socket_input(r#"{"id":2,"sessionId":"","data":"x"}"#, 0).is_err());
        assert!(
            parse_socket_input(r#"{"id":2,"sessionId":"s","data":"x","cmd":"run"}"#, 0).is_err()
        );
        assert!(parse_socket_input("not json", 0).is_err());
        let large =
            serde_json::json!({"id":2,"sessionId":"s","data":"中".repeat(22000)}).to_string();
        assert!(parse_socket_input(&large, 0).is_err());
    }

    #[test]
    fn output_snapshot_is_bounded_and_sequence_delta_is_exact() {
        let mut history = OutputHistory::default();
        assert_eq!(history.push("first"), 1);
        assert_eq!(history.push("中文"), 2);
        assert_eq!(history.snapshot(Some(1)), ("中文".into(), false));
        for _ in 0..100 { history.push(&"中".repeat(2000)); }
        assert!(history.bytes <= 64 * 1024);
        let (recent, truncated) = history.snapshot(Some(2));
        assert!(truncated);
        assert!(recent.chars().all(|c| c == '中'));
        assert_eq!(history.snapshot(Some(history.sequence)), ("".into(), false));
        assert!(!history.snapshot(Some(history.sequence - 1)).1);
    }
}

impl From<String> for ApiError {
    fn from(message: String) -> Self {
        ApiError::internal(message)
    }
}
