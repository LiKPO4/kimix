export function compactModelDisplayName(model: string | null | undefined): string {
  const value = model?.trim() ?? "";
  if (!value.includes("/")) return value;
  return value.split("/").filter(Boolean).at(-1) ?? value;
}

const MODEL_STATUS_RE = /^模型[：:]\s*(.+)/;

export function compactModelText(text: string): string {
  return text.replace(/(模型[：:]\s*)(\S+)/g, (_match, prefix: string, model: string) => {
    return `${prefix}${compactModelDisplayName(model)}`;
  });
}

export function extractModelFromStatusMessage(message: string | undefined | null): string | null {
  if (!message) return null;
  const match = message.match(MODEL_STATUS_RE);
  if (!match?.[1]) return null;
  const model = match[1].trim();
  return model || null;
}

export function getLastUsedModelFromEvents(events: { type: string; message?: string | null; model?: string | null }[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "assistant_message" && typeof event.model === "string" && event.model.trim()) {
      return event.model.trim();
    }
    if (event.type !== "status_update") continue;
    const model = extractModelFromStatusMessage(event.message);
    if (model) return model;
  }
  return null;
}
