import { useEffect, useState } from "react";
import { Check, Link2, MessageSquare } from "lucide-react";
import { isUuid } from "./ids";
import { copyTerminalText } from "./terminalClipboard";
import { invoke } from "./tauriRuntime";
import type { CodexSessionSummary, Project } from "./types";
import "./sessionLink.css";

type SessionReference = { projectId: string; sessionId: string };

export function readSessionLink(): SessionReference | "invalid" | null {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("sessionId")) return null;
  const projects = params.getAll("projectId");
  const sessions = params.getAll("sessionId");
  if (projects.length !== 1 || sessions.length !== 1 || !isUuid(projects[0]) || !isUuid(sessions[0])) return "invalid";
  return { projectId: projects[0].toLowerCase(), sessionId: sessions[0].toLowerCase() };
}

export function CopySessionLink({ projectId, sessionId, title }: SessionReference & { title: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2800);
    return () => window.clearTimeout(timer);
  }, [status]);
  if (!isUuid(projectId) || !isUuid(sessionId)) return null;
  async function copyLink() {
    const url = new URL(window.location.href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("sessionId", sessionId);
    try {
      await copyTerminalText(url.href);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }
  return <>
    <button type="button" className="session-link-copy" aria-label={`复制会话链接：${title}`}
      title="复制会话链接" onClick={() => void copyLink()}>
      {status === "copied" ? <Check size={15} /> : <Link2 size={15} />}
    </button>
    {status !== "idle" && <span className="session-link-feedback" role="status">
      {status === "copied" ? "已复制会话链接" : "复制失败，请检查浏览器剪贴板权限"}
    </span>}
  </>;
}

export function SessionLinkPreview({ reference, project, loading, error, onOpen }: {
  reference: SessionReference | "invalid";
  project?: Project;
  loading: boolean;
  error: string | null;
  onOpen: (projectId: string, session: CodexSessionSummary) => void;
}) {
  const [session, setSession] = useState<CodexSessionSummary | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    if (reference === "invalid" || !project || project.id !== reference.projectId) return;
    let active = true;
    invoke<CodexSessionSummary[]>("list_codex_sessions", reference)
      .then((result) => {
        if (!active) return;
        const match = result.find(item => item.id === reference.sessionId);
        if (match) setSession(match);
        else setProblem("该项目中找不到这条历史会话。");
      })
      .catch((cause) => { if (active) setProblem(String(cause).replace(/^Error:\s*/, "")); });
    return () => { active = false; };
  }, [reference, project]);
  const message = reference === "invalid" ? "会话链接无效，需要有效的项目和会话编号。"
    : error || (!loading && !project ? "此工作台未登记链接中的项目。" : problem);
  const ready = !message && project && session;
  return <main className="session-link-page">
    <article aria-label="会话链接" className="session-link-panel">
      <MessageSquare size={22} aria-hidden="true" />
      <h1>{ready ? session.title : "打开历史会话"}</h1>
      {ready ? <>
        <p>{project.name}</p><small>{project.path}</small>
        <button type="button" onClick={() => onOpen(project.id, session)}>进入会话</button>
      </> : message ? <>
        <p role="alert">{/未授权|unauthori[sz]ed|forbidden/i.test(message)
          ? "当前标签页尚未获得访问权限。请先在此标签页登录 Code Terminal，再打开会话链接。"
          : message}</p>
        <button type="button" onClick={() => window.location.reload()}>重新读取</button>
      </> : <p role="status">正在读取项目与会话…</p>}
    </article>
  </main>;
}
