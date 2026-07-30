const pad2 = (value: number) => String(value).padStart(2, "0");

export function formatMessageTime(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return "";

  const current = new Date(now);
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const sameYear = date.getFullYear() === current.getFullYear();
  const sameDay = sameYear &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate();

  if (sameDay) return time;
  const datePart = `${date.getMonth() + 1}.${date.getDate()}`;
  return sameYear ? `${datePart} ${time}` : `${date.getFullYear()}.${datePart} ${time}`;
}

export function formatMessageTimeTitle(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}
