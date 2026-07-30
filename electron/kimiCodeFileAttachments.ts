import path from "node:path";

export const MAX_GENERIC_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export function genericAttachmentMediaType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  const known: Record<string, string> = {
    ".css": "text/css",
    ".csv": "text/csv",
    ".html": "text/html",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".ts": "text/typescript",
    ".tsx": "text/tsx",
    ".txt": "text/plain",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
  };
  return known[extension] ?? "application/octet-stream";
}

export function safeGenericAttachmentName(name: string, fallbackPath?: string): string {
  const fallback = fallbackPath ? path.basename(fallbackPath) : "attachment";
  const basename = path.basename(name.trim() || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
  return basename || "attachment";
}
