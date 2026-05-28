export type DownloadProgressInfo = {
  percent: number;
  receivedBytes: number;
  totalBytes?: number;
  bytesPerSecond?: number;
};

export function formatBytes(bytes?: number) {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatDownloadPercent(percent: number | null) {
  if (!Number.isFinite(percent)) return "0%";
  const normalized = Math.max(0, Math.min(100, percent ?? 0));
  return normalized < 10 && normalized > 0
    ? `${normalized.toFixed(1)}%`
    : `${Math.round(normalized)}%`;
}

export function formatDownloadDetail(progress: DownloadProgressInfo | null) {
  if (!progress) return "";
  const received = formatBytes(progress.receivedBytes);
  const total = progress.totalBytes ? formatBytes(progress.totalBytes) : "未知大小";
  const speed = progress.bytesPerSecond ? ` · ${formatBytes(progress.bytesPerSecond)}/s` : "";
  return `${received} / ${total}${speed}`;
}

export function formatReleaseDate(value: string): string {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}
