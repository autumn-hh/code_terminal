import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
import { defaultTerminalAppearance } from "./terminalThemes";
import { TerminalInputQueue } from "./terminalInputQueue";
import { TerminalSocketInput } from "./terminalSocketInput";
import { terminalPerformance } from "./terminalPerformance";
import type { OpenDialogOptions, OpenDialogReturn } from "@tauri-apps/plugin-dialog";
import type { EventCallback, EventName, Options, UnlistenFn } from "@tauri-apps/api/event";
import type { InvokeArgs, InvokeOptions } from "@tauri-apps/api/core";
import type {
  CodexSessionSummary,
  DirectoryListing,
  TerminalExit,
  TerminalOutput,
  TerminalStarted,
  WorkbenchState,
} from "./types";

const previewSessionIdPrefix = "preview-terminal-";
let previewTerminalSequence = 0;
let serverToken: string | null | undefined;
let serverEventsSocket: WebSocket | null = null;
let serverEventsReady: Promise<void> | null = null;
let serverSocketInput: TerminalSocketInput | null = null;
let serverSessionLease = false;
const serverPageSessions = new Set<string>();
let serverHeartbeatTimer: number | null = null;
let serverHeartbeatPending = false;
let serverHeartbeatWakeInstalled = false;
let serverSocketHasOpened = false;
const serverEventHandlers = new Map<string, Set<EventCallback<unknown>>>();
const serverInputQueue = new TerminalInputQueue(async (sessionId, data) => {
  await ensureServerEventsSocket();
  if (serverSocketInput) return serverSocketInput.write(sessionId, data);
  // Only older servers without input capability use HTTP. Never replay a
  // socket write after a disconnect: its delivery may already have occurred.
  const start = terminalPerformance.now();
  terminalPerformance.count('httpWrites');
  try { await serverInvoke<void>("terminal_write", { sessionId, data }); }
  finally { if (start) terminalPerformance.sample('httpWriteMs', terminalPerformance.now() - start); }
});

const previewState: WorkbenchState = {
  projects: [],
  activeProjectId: null,
  terminalAppearance: defaultTerminalAppearance,
  customTerminalAppearance: defaultTerminalAppearance,
};

function getPreviewCwd() {
  return window.location.hostname || "browser-preview";
}

function getPreviewTerminalStarted(args?: InvokeArgs): TerminalStarted {
  const requestedSessionId =
    args && !Array.isArray(args) && !(args instanceof ArrayBuffer) && !(args instanceof Uint8Array)
      ? typeof args.sessionId === "string"
        ? args.sessionId
        : null
      : null;

  previewTerminalSequence += 1;
  return {
    sessionId: requestedSessionId || `${previewSessionIdPrefix}${previewTerminalSequence}`,
    shell: "Browser preview",
    cwd: getPreviewCwd(),
    windowsBuildNumber: null,
  };
}

async function previewInvoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  switch (cmd) {
    case "load_state":
      return previewState as T;
    case "initial_project_id":
      return null as T;
    case "list_directory":
      return ({
        path: getPreviewCwd(),
        parentPath: null,
        entries: [],
      } satisfies DirectoryListing) as T;
    case "create_directory":
      return ({
        path: getPreviewCwd(),
        parentPath: null,
        entries: [],
      } satisfies DirectoryListing) as T;
    case "list_codex_sessions":
      return [] as CodexSessionSummary[] as T;
    case "set_terminal_appearance":
      if (args && !Array.isArray(args) && !(args instanceof ArrayBuffer) && !(args instanceof Uint8Array)) {
        previewState.terminalAppearance = args.appearance as WorkbenchState["terminalAppearance"];
      }
      return previewState as T;
    case "terminal_start":
      return getPreviewTerminalStarted(args) as T;
    case "terminal_write":
    case "terminal_resize":
    case "terminal_stop":
    case "append_tui_debug_log":
      return undefined as T;
    case "clear_tui_debug_log":
      return "" as T;
    case "save_pasted_image":
      return "C:\\Temp\\code-terminal\\pasted-images\\preview-paste.png" as T;
    default:
      return Promise.reject(new Error(`Tauri command "${cmd}" is not available in browser preview.`));
  }
}

function readServerToken() {
  if (serverToken !== undefined) return serverToken;

  try {
    const url = new URL(window.location.href);
    const fragmentParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    serverToken =
      fragmentParams.get("token") ||
      url.searchParams.get("token") ||
      window.sessionStorage.getItem("code-terminal.server-token") ||
      null;
    if (serverToken) {
      window.sessionStorage.setItem("code-terminal.server-token", serverToken);
    }
    window.localStorage.removeItem("code-terminal.server-token");

    if (url.searchParams.has("token") || fragmentParams.has("token")) {
      url.searchParams.delete("token");
      fragmentParams.delete("token");
      const nextFragment = fragmentParams.toString();
      window.history.replaceState(null, "", `${url.pathname}${url.search}${nextFragment ? `#${nextFragment}` : ""}`);
    }
  } catch {
    serverToken = null;
  }

  return serverToken;
}

function serverApiUrl(command: string) {
  return new URL(`/api/${command}`, window.location.origin);
}

function serverHeaders() {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = readServerToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export async function uploadAttachment(file: File, onProgress?: (percentage: number) => void, signal?: AbortSignal): Promise<string> {
  if (file.size > 25 * 1024 * 1024) throw new Error('单个文件不能超过 25 MB');
  if (signal?.aborted) throw new Error('上传已取消');
  if (isTauriRuntime()) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const path = await tauriInvoke<string>('save_attachment', { name: file.name, bytes });
    onProgress?.(100);
    return path;
  }
  if (!isServerRuntime()) throw new Error('上传文件需要连接完整服务端');
  const url = serverApiUrl('upload_attachment');
  url.searchParams.set('name', file.name);
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const finish = () => signal?.removeEventListener('abort', abort);
    request.open('POST', url);
    request.timeout = 120000;
    const token = readServerToken();
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100));
    };
    request.onload = () => {
      finish();
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(request.status === 413 ? '单个文件不能超过 25 MB' : request.status === 401 ? '访问凭证失效，请重新打开授权链接' : '文件上传失败，请重试'));
        return;
      }
      try {
        const path: unknown = JSON.parse(request.responseText);
        if (typeof path !== 'string' || !path) throw new Error();
        resolve(path);
      } catch { reject(new Error('服务器未返回文件路径，请确认服务端已更新')); }
    };
    request.onerror = () => { finish(); reject(new Error('网络中断，文件未上传成功')); };
    request.ontimeout = () => { finish(); reject(new Error('文件上传超时，请重试')); };
    request.onabort = () => { finish(); reject(new Error('上传已取消')); };
    signal?.addEventListener('abort', abort, { once: true });
    request.send(file);
  });
}

async function serverInvoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  if (serverEventHandlers.size > 0 && isTerminalEventProducingCommand(cmd)) {
    await ensureServerEventsSocket();
  }

  const init: RequestInit = {
    headers: serverHeaders(),
  };
  const requestArgs = cmd === "terminal_start" && serverSessionLease ? { ...args, lease: true } : args;
  if (cmd === "terminal_stop" && args && "sessionId" in args && typeof args.sessionId === "string") {
    // Even if the stop request fails, a closed page tab must not keep renewing it.
    forgetServerSession(args.sessionId);
  }
  const isGet = cmd === "load_state" || cmd === "initial_project_id" || cmd === "terminal_sessions";
  if (!isGet) {
    init.method = "POST";
    init.body = JSON.stringify(requestArgs ?? {});
  }

  const controller = ["terminal_attach", "terminal_stop", "terminal_background", "terminal_sessions", "terminal_resize"].includes(cmd)
    ? new AbortController() : null;
  const timeout = controller ? window.setTimeout(() => controller.abort(), 8000) : null;
  if (controller) init.signal = controller.signal;
  try {
    const response = await fetch(serverApiUrl(cmd), init);
    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText);
      throw new Error(message || response.statusText);
    }
    if (response.status === 204) {
      if (cmd === "terminal_stop" && args && "sessionId" in args && typeof args.sessionId === "string") {
        forgetServerSession(args.sessionId);
      }
      return undefined as T;
    }

    const result = await response.json();
    if ((cmd === "terminal_start" || cmd === "terminal_attach") && typeof result?.sessionId === "string") {
      serverPageSessions.add(result.sessionId);
      startServerHeartbeat();
    }
    return result as T;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
}

function forgetServerSession(sessionId: string) {
  serverPageSessions.delete(sessionId);
  if (serverPageSessions.size === 0 && serverHeartbeatTimer !== null) {
    window.clearInterval(serverHeartbeatTimer);
    serverHeartbeatTimer = null;
  }
}

export function releaseServerSession(sessionId: string) {
  forgetServerSession(sessionId);
}

function dispatchServerEvent(eventName: string, eventPayload: TerminalOutput | TerminalExit) {
  if (eventName === "terminal-exit") forgetServerSession(eventPayload.sessionId);
  serverEventHandlers.get(eventName)?.forEach(handler => {
    handler({ event: eventName, id: 0, payload: eventPayload } as Parameters<typeof handler>[0]);
  });
}

async function heartbeatServerSessions() {
  if (!serverSessionLease || serverHeartbeatPending || serverPageSessions.size === 0) return;
  serverHeartbeatPending = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(serverApiUrl("terminal_heartbeat"), {
      method: "POST", headers: serverHeaders(), signal: controller.signal,
      body: JSON.stringify({ sessionIds: [...serverPageSessions] }),
    });
    if (!response.ok) return;
    const result = await response.json() as { missingSessionIds: string[] };
    for (const sessionId of result.missingSessionIds ?? []) {
      if (serverPageSessions.has(sessionId)) dispatchServerEvent("terminal-exit", { sessionId });
    }
  } catch {
    // Offline pages expire server-side. Never stop or recreate a session on a transient error.
  } finally {
    window.clearTimeout(timeout);
    serverHeartbeatPending = false;
  }
}

function startServerHeartbeat() {
  if (!serverSessionLease || serverPageSessions.size === 0 || serverHeartbeatTimer !== null) return;
  if (!serverHeartbeatWakeInstalled) {
    serverHeartbeatWakeInstalled = true;
    const resume = () => {
      if (document.visibilityState === "hidden" || serverPageSessions.size === 0) return;
      void ensureServerEventsSocket().catch(() => undefined);
      void heartbeatServerSessions();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
  }
  serverHeartbeatTimer = window.setInterval(() => {
    void ensureServerEventsSocket().catch(() => undefined);
    void heartbeatServerSessions();
  }, 20000);
  void heartbeatServerSessions();
}

export async function supportsServerSessionLease() {
  if (!isServerRuntime()) return false;
  await ensureServerEventsSocket();
  return serverSessionLease;
}

function isTerminalEventProducingCommand(command: string) {
  return command === "terminal_start" || command === "terminal_write" || command === "terminal_attach";
}

function isServerRuntime() {
  const port = window.location.port;
  const hostname = window.location.hostname;
  const isLocalVitePreview = port === "1420" && (hostname === "127.0.0.1" || hostname === "localhost");
  return !isTauriRuntime() && window.location.protocol !== "file:" && !isLocalVitePreview;
}

export function canUseNativeOpenDialog() {
  return isTauriRuntime();
}

function serverEventsUrl(ticket: string | null) {
  const url = new URL("/api/events", window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (ticket) url.searchParams.set("ticket", ticket);
  return url;
}

async function requestServerEventsTicket() {
  const response = await fetch(serverApiUrl("events_ticket"), {
    method: "POST",
    headers: serverHeaders(),
    body: "{}",
  });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(message || response.statusText);
  }
  return (await response.json()) as { ticket: string | null; terminalInput?: boolean; sessionLease?: boolean };
}

function normalizeServerEventName(type: string) {
  switch (type) {
    case "terminalOutput":
      return "terminal-output";
    case "terminalExit":
      return "terminal-exit";
    default:
      return type;
  }
}

function ensureServerEventsSocket(): Promise<void> {
  if (serverEventsSocket?.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  if (serverEventsReady) {
    return serverEventsReady;
  }

  const ready = (async () => {
    const { ticket, terminalInput, sessionLease } = await requestServerEventsTicket();
    serverSessionLease = sessionLease === true;
    const socket = new WebSocket(serverEventsUrl(ticket));
    const input = terminalInput ? new TerminalSocketInput(socket) : null;
    serverEventsSocket = socket;
    serverSocketInput = input;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup(); socket.close(); reject(new Error("服务器事件通道连接超时"));
      }, 8000);
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleUnavailable = () => {
        cleanup();
        reject(new Error("服务器事件通道连接失败"));
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleUnavailable);
        socket.removeEventListener("close", handleUnavailable);
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleUnavailable);
      socket.addEventListener("close", handleUnavailable);
    });

    socket.addEventListener("message", (event) => {
      let payload: {
        type?: string;
        id?: number;
        error?: string | null;
        payload?: TerminalOutput | TerminalExit;
        terminalOutput?: TerminalOutput;
        terminalExit?: TerminalExit;
        terminal_output?: TerminalOutput;
        terminal_exit?: TerminalExit;
      };

      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (!payload.type) return;
      if (payload.type === "terminal-input-ack" && typeof payload.id === "number") {
        input?.acknowledge(payload.id, payload.error);
        return;
      }

      const eventName = normalizeServerEventName(payload.type);
      const eventPayload =
        payload.payload ?? payload.terminalOutput ?? payload.terminal_output ?? payload.terminalExit ?? payload.terminal_exit;
      if (!eventPayload) return;

      dispatchServerEvent(eventName, eventPayload);
    });
    socket.addEventListener("close", () => {
      input?.fail();
      if (serverEventsSocket === socket) {
        serverEventsSocket = null;
        serverEventsReady = null;
        serverSocketInput = null;
      }
      if (serverEventHandlers.size > 0) {
        window.setTimeout(() => {
          void ensureServerEventsSocket().catch(() => undefined);
        }, 1200);
      }
    });
    if (serverSocketHasOpened && serverSessionLease) {
      for (const sessionId of serverPageSessions) dispatchServerEvent("terminal-reconnect", { sessionId });
    }
    serverSocketHasOpened = true;
    startServerHeartbeat();
    void heartbeatServerSessions();
  })();

  serverEventsReady = ready;
  void ready.catch(() => {
    if (serverEventsReady === ready) {
      serverEventsSocket = null;
      serverEventsReady = null;
      serverSocketInput?.fail();
      serverSocketInput = null;
    }
  });
  return ready;
}

export function isTauriRuntime() {
  return isTauri();
}

export function isMacPlatform() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return /Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad|iPod/.test(ua);
}

export function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  if (isTauriRuntime()) {
    return tauriInvoke<T>(cmd, args, options);
  }

  if (isServerRuntime()) {
    if (cmd === "terminal_write" && args && typeof args === "object" &&
        "sessionId" in args && typeof args.sessionId === "string" && "data" in args && typeof args.data === "string") {
      return serverInputQueue.write(args.sessionId, args.data) as Promise<T>;
    }
    return serverInvoke<T>(cmd, args);
  }

  return previewInvoke<T>(cmd, args);
}

export function listen<T>(
  event: EventName,
  handler: EventCallback<T>,
  options?: Options,
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return tauriListen<T>(event, handler, options);
  }

  if (isServerRuntime() && (event === "terminal-output" || event === "terminal-exit" || event === "terminal-reconnect")) {
    const handlers = serverEventHandlers.get(event) ?? new Set<EventCallback<unknown>>();
    handlers.add(handler as EventCallback<unknown>);
    serverEventHandlers.set(event, handlers);
    void ensureServerEventsSocket().catch(() => undefined);
    return Promise.resolve(() => {
      handlers.delete(handler as EventCallback<unknown>);
      if (handlers.size === 0) {
        serverEventHandlers.delete(event);
      }
      if (serverEventHandlers.size === 0) {
        serverSocketInput?.fail();
        serverSocketInput = null;
        serverEventsSocket?.close();
        serverEventsSocket = null;
        serverEventsReady = null;
      }
    });
  }

  void options;
  return Promise.resolve(() => undefined);
}

export function setWindowTitle(title: string) {
  document.title = title;
  if (!isTauriRuntime()) return Promise.resolve();

  return getCurrentWindow().setTitle(title);
}

export function startWindowDrag() {
  if (!isTauriRuntime()) return Promise.resolve();

  return getCurrentWindow().startDragging();
}

export function minimizeWindow() {
  if (!isTauriRuntime()) return Promise.resolve();

  return getCurrentWindow().minimize();
}

export function toggleWindowMaximize() {
  if (!isTauriRuntime()) return Promise.resolve();

  return getCurrentWindow().toggleMaximize();
}

export function closeWindow() {
  if (!isTauriRuntime()) return Promise.resolve();

  return getCurrentWindow().close();
}


export function openDialog<T extends OpenDialogOptions>(options?: T): Promise<OpenDialogReturn<T>> {
  if (isTauriRuntime()) {
    return tauriOpen(options);
  }

  return Promise.resolve(null as OpenDialogReturn<T>);
}
