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

export function getLastUsedModelFromEventsAfter(
  events: { type: string; timestamp?: number; message?: string | null; model?: string | null }[],
  after?: number,
): string | null {
  if (after === undefined) return getLastUsedModelFromEvents(events);
  return getLastUsedModelFromEvents(events.filter((event) => (
    typeof event.timestamp === "number" && event.timestamp > after
  )));
}

export function resolveResumedSessionModel(input: {
  resumedModel?: string | null;
  sessionModel?: string | null;
  switchedToModel?: string | null;
  modelSwitchedAt?: number;
}): string | null {
  // Only an explicit in-flight target may outrank the resumed official profile.
  // modelSwitchedAt is historical metadata and cannot prove a mutation is pending.
  return input.switchedToModel?.trim()
    || input.resumedModel?.trim()
    || input.sessionModel?.trim()
    || null;
}

export function resolveAuthoritativeSessionModel(input: {
  runtimeModel?: string | null;
  sessionModel?: string | null;
  historyModel?: string | null;
}): string | null {
  return input.runtimeModel?.trim()
    || input.sessionModel?.trim()
    || input.historyModel?.trim()
    || null;
}

export function getSessionModelForDisplay(input: {
  events: Array<{ type: string; timestamp?: number; message?: string | null; model?: string | null }>;
  sessionModel?: string | null;
  modelSwitchedAt?: number;
}): string | null {
  const sessionModel = input.sessionModel?.trim() || null;
  // Session/profile state owns the model selector. Event models describe the
  // turn that produced them and may arrive late through replay/reconciliation;
  // they must never roll the current session model backward.
  return sessionModel ?? getLastUsedModelFromEvents(input.events);
}
