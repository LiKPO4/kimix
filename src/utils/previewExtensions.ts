export const PREVIEW_READABLE_TEXT_EXTENSIONS = [
  "md",
  "txt",
  "json",
  "log",
  "yaml",
  "yml",
  "toml",
  "ini",
  "csv",
  "tsv",
] as const;

export type PreviewReadableTextExtension = (typeof PREVIEW_READABLE_TEXT_EXTENSIONS)[number];

export function normalizePreviewExtensions(
  input: unknown,
  fallback: string[] = ["md", "txt"],
): string[] {
  const raw = Array.isArray(input) ? input : fallback;
  const allowedSet = new Set(PREVIEW_READABLE_TEXT_EXTENSIONS);
  const normalized = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase().replace(/^\.+/, ""))
    .filter((item) => allowedSet.has(item as PreviewReadableTextExtension));
  const result = Array.from(new Set(normalized)).slice(0, 20);
  return result.length > 0 ? result : [...fallback];
}

export function isPreviewReadableExtension(ext: string): boolean {
  const normalized = ext.trim().toLowerCase().replace(/^\.+/, "");
  return (PREVIEW_READABLE_TEXT_EXTENSIONS as readonly string[]).includes(normalized);
}

export function previewExtensionSet(input?: unknown): Set<string> {
  return new Set(normalizePreviewExtensions(input).map((item) => `.${item}`));
}
