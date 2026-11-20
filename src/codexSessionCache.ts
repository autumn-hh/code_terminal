import type { CodexSessionSummary } from "./types";

type ProjectIdentity = { id: string; path: string };
type CacheStorage = Pick<Storage, "getItem" | "setItem">;
const storagePrefix = "opencode-workbench.codex-sessions.v1:";

export function codexSessionProjectKey(project: ProjectIdentity) {
  const windows = /^[a-z]:[\\/]/i.test(project.path) || project.path.startsWith("\\\\");
  let path = windows ? project.path.replace(/\\/g, "/").toLowerCase() : project.path;
  const unc = path.startsWith("//");
  path = path.replace(/\/+/g, "/").replace(/\/$/, "");
  if (unc) path = "/" + path;
  if (!path) path = "/";
  return JSON.stringify([project.id, path]);
}

function parseSessions(value: unknown): CodexSessionSummary[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sessions: CodexSessionSummary[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id ||
      typeof entry.title !== "string" || typeof entry.cwd !== "string" ||
      typeof entry.updatedAt !== "number" || !Number.isFinite(entry.updatedAt) || entry.updatedAt < 0) return undefined;
    sessions.push({ id: entry.id, title: entry.title, cwd: entry.cwd, updatedAt: entry.updatedAt });
  }
  return sessions;
}

// Missing records in a limited recent-history response are not deletions.
// Keep every previously loaded ID; a refresh replaces fields for matching IDs.
function mergeSessions(previous: CodexSessionSummary[], incoming: CodexSessionSummary[]) {
  const merged = new Map<string, CodexSessionSummary>();
  for (const session of incoming) merged.set(session.id, session);
  for (const session of previous) if (!merged.has(session.id)) merged.set(session.id, session);
  return [...merged.values()];
}

export class CodexSessionCache {
  private memory = new Map<string, CodexSessionSummary[]>();
  private readKeys = new Set<string>();
  private pending = new Map<string, Promise<CodexSessionSummary[]>>();

  constructor(private storage: () => CacheStorage) {}

  get(project: ProjectIdentity): CodexSessionSummary[] | undefined {
    const key = codexSessionProjectKey(project);
    if (!this.readKeys.has(key)) {
      this.readKeys.add(key);
      try {
        const raw = this.storage().getItem(storagePrefix + key);
        const saved: unknown = raw ? JSON.parse(raw) : null;
        if (saved && typeof saved === "object" && "version" in saved && saved.version === 1 && "sessions" in saved) {
          const sessions = parseSessions(saved.sessions);
          if (sessions) this.memory.set(key, sessions);
        }
      } catch {
        // Private browsing, invalid JSON and disabled storage still allow live history.
      }
    }
    return this.memory.get(key);
  }

  load(project: ProjectIdentity, fetchSessions: () => Promise<CodexSessionSummary[]>, force = false): Promise<CodexSessionSummary[]> {
    const key = codexSessionProjectKey(project);
    const cached = this.get(project);
    if (!force && cached !== undefined) return Promise.resolve(cached);
    const pending = this.pending.get(key);
    if (pending) return pending;
    // One request per identity, including repeated refresh clicks. Different
    // projects/paths never share pending results, even if their names match.
    const request = Promise.resolve().then(fetchSessions).then(value => {
      const sessions = parseSessions(value);
      if (!sessions) throw new Error("历史会话数据格式无效");
      const merged = mergeSessions(this.memory.get(key) ?? [], sessions);
      this.memory.set(key, merged);
      try {
        this.storage().setItem(storagePrefix + key, JSON.stringify({ version: 1, sessions: merged }));
      } catch {
        // Retain the complete in-memory result if persistence is unavailable/full.
      }
      return merged;
    }).finally(() => {
      if (this.pending.get(key) === request) this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }
}
