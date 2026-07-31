const pad2 = (value: number) => String(value).padStart(2, "0");

export function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return "";

  const year = pad2(date.getFullYear() % 100);
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return `${year}/${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

export function formatMessageTimeTitle(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatRelativeTime(ts: number): string {
  // 边界保护：非有限数或 <= 0 的损坏数据不显示，未来时间戳（时钟回拨）按"刚刚"处理
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const weeks = Math.floor(diff / 604800000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分`;
  if (hours < 24) return `${hours} 小时`;
  if (days < 7) return `${days} 天`;
  return `${weeks} 周`;
}
