export type ProjectStatus = "idle" | "running" | "stopped" | "error";

export interface Project {
  id: string;
  name: string;
  path: string;
  status: ProjectStatus;
  lastOpenedAt: number;
}

export interface WorkbenchState {
  projects: Project[];
  activeProjectId?: string | null;
  terminalAppearance?: TerminalAppearanceSettings | null;
  customTerminalAppearance?: TerminalAppearanceSettings | null;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface DirectoryListing {
  path: string;
  parentPath?: string | null;
  entries: DirectoryEntry[];
}

export interface CodexSessionSummary {
  id: string;
  title: string;
  cwd: string;
  updatedAt: number;
}

export type BuiltInTerminalThemePreset =
  | "workbench"
  | "daylight"
  | "midnight"
  | "ocean"
  | "jade"
  | "violet"
  | "rose"
  | "amber"
  | "classic";
export type TerminalThemePreset = BuiltInTerminalThemePreset | "custom";
export type TerminalColorKey = "background" | "foreground" | "cursor";

export interface TerminalAppearanceSettings {
  preset: TerminalThemePreset;
  fontSize: number;
  lineHeight: number;
  background: string;
  foreground: string;
  cursor: string;
}

export interface CliStatus {
  available: boolean;
  version?: string | null;
  message?: string | null;
}

export interface TerminalStarted {
  sessionId: string;
  shell: string;
  cwd: string;
  windowsBuildNumber?: number | null;
  keepAlive?: boolean;
  output?: string;
  outputSequence?: number;
  outputTruncated?: boolean;
}

export interface ServerTerminalSession {
  sessionId: string;
  projectId: string | null;
  shell: string;
  cwd: string;
  keepAlive: boolean;
}

export interface TerminalOutput {
  sessionId: string;
  data: string;
  sequence?: number;
}

export interface TerminalExit {
  sessionId: string;
  code?: number | null;
}

export interface TerminalCommandRequest {
  id: number;
  command: string;
}
