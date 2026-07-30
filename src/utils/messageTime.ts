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
