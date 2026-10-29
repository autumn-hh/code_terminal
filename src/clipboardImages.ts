import { uploadAttachment } from "./tauriRuntime";

export function getClipboardImageItem(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return null;

  const items = Array.from(dataTransfer.items);
  return items.find((item) => item.kind === "file" && item.type.startsWith("image/")) ?? null;
}

export async function saveClipboardImage(item: DataTransferItem) {
  const file = item.getAsFile();
  if (!file) return null;

  return uploadAttachment(file);
}

export function formatPastedImagePath(path: string) {
  // Codex recognizes a standalone image path on paste. Unnecessary surrounding
  // quotes turn it into ordinary text; keep quoting for paths that need it.
  if (/^[\p{L}\p{N}_./:\\-]+$/u.test(path)) return path;
  return `"${path.replace(/"/g, '\\"')}"`;
}
