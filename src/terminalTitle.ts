/// <reference lib="es2022.intl" />
// Titles are display data from the PTY, never commands or HTML.
export function normalizeSessionName(value: string) {
  return Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "").replace(/\s+/g, " ").trim()).slice(0, 240).join("");
}

function codexProjectLabel(value: string) {
  const segments = typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter(undefined, {granularity:"grapheme"}).segment(value), part => part.segment)
    : Array.from(value);
  return segments.length > 24 ? segments.slice(0, 21).join("") + "..." : value;
}

export function stableTerminalTitle(value: string) {
  const title = normalizeSessionName(value);
  // Codex's activity marker changes every 100ms; it is not part of the name.
  return title.replace(/^(?:[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏●]\s+)+/u, "")
    .replace(/^\[\s*[!.]\s*\]\s+Action Required(?:\s+\|\s+|$)/u, "");
}

function isShellTitle(value: string) {
  const title = normalizeSessionName(value)
    .replace(/^(?:Administrator|管理员)\s*:\s*/i, "").replace(/^"(.*)"$/, "$1");
  // Match only a shell label or executable path, never words inside a real name.
  if (/[\\/]/.test(title) && !/^(?:[a-z]:[\\/]|[\\/])/i.test(title)) return false;
  const executable = title.replace(/\\/g, "/").split("/").pop() || "";
  return /^(?:pwsh|powershell|cmd)(?:\.exe)?$/i.test(executable)
    || /^(?:Windows )?PowerShell(?: 7)?$/i.test(title);
}

export function sessionNameFromTitle(value: string, projectName?: string | null, cwd?: string | null) {
  const title = stableTerminalTitle(value);
  // Shell startup/restore titles carry no new session-name information.
  if (isShellTitle(title)) return null;
  const basename = cwd?.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  const projects = [projectName, basename].filter((name): name is string => Boolean(name))
    .flatMap(name => [normalizeSessionName(name), codexProjectLabel(normalizeSessionName(name))]);
  for (const project of projects) {
    if (title === project) return "";
    // Only remove a known trailing project, not arbitrary "|" inside a name.
    if (title.endsWith(" | " + project)) return title.slice(0, -project.length - 3).trim();
  }
  return title;
}

export function parseTabNameCommand(value: string): {name: string | null; error?: string} | null {
  if (value.includes("\n") || value.includes("\r")) return null;
  const match = /^\/tab-name(?:[ \t]+(.*))?$/.exec(value);
  if (!match) return null;
  if (Array.from(match[1] ?? "").length > 240) return {name:null,error:"会话显示名称最多 240 个字符。"};
  const name = normalizeSessionName(match[1] ?? "");
  if (!name) return {name:null, error:"请输入 /tab-name 新名称，或 /tab-name --auto 恢复自动名称。"};
  return {name:name === "--auto" ? null : name};
}

type SavedName = {automatic: string; custom: string | null; fromHistory?: boolean};
const storageKey = "opencode-workbench.session-names";
export function readSessionName(sessionId: string): SavedName | null {
  try {
    const item = JSON.parse(localStorage.getItem(storageKey) || "{}")[sessionId];
    if (!item || typeof item.automatic !== "string" || (item.custom !== null && typeof item.custom !== "string")) return null;
    const automatic = normalizeSessionName(item.automatic);
    const fromHistory = item.fromHistory === true;
    return {automatic:!fromHistory && isShellTitle(automatic) ? "" : automatic,
      custom:item.custom === null ? null : normalizeSessionName(item.custom),fromHistory};
  } catch { return null; }
}
export function saveSessionName(sessionId: string, name: SavedName) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const entries = Object.entries(parsed && typeof parsed === "object" ? parsed : {}).filter(([id]) => id !== sessionId).slice(-99);
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries([...entries, [sessionId, name]])));
  } catch { /* The current tab remains usable when browser storage is unavailable. */ }
}
