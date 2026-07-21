/** Max chars of a message body worth testing — internal prompts match near the start. */
const INTERNAL_PROMPT_HEAD_CHARS = 800;
/** Only the first few user/steer messages can mark a session as internal. */
const INTERNAL_USER_EVENT_SCAN_LIMIT = 6;

const INTERNAL_PROMPT_PATTERNS: RegExp[] = [
  /^只回复\s*(OK|NEW)$/i,
  /^【Kimix Hooks 上下文】/,
  /^【Kimix 需求澄清工具[:：]/,
  /^【Kimix 长程任务[:：]/,
  /^【Kimix 隐藏 Superpowers Bootstrap】/,
  /^<!-- kimix-superpowers-bootstrap -->/,
  /^请查看agent文档，给出用于交接下一个agent的提示词/,
  /^请作为(执行|审查)\s*agent/,
  /^你正在作为 Kimix 长程任务/,
  /^你是 Kimix Hooks 规则创建 agent/,
  /这是 Kimix 内部调度指令/,
];

const promptTextCache = new Map<string, boolean>();
const PROMPT_TEXT_CACHE_MAX = 400;

/** Session-object identity cache: unchanged session refs skip all work. */
const hiddenSessionCache = new WeakMap<object, boolean>();

export function isInternalPromptText(text: string) {
  if (!text) return false;
  const cached = promptTextCache.get(text);
  if (cached !== undefined) return cached;

  // Patterns are start-anchored (or near-start). Never normalize multi-MB bodies.
  const head = text.length > INTERNAL_PROMPT_HEAD_CHARS
    ? text.slice(0, INTERNAL_PROMPT_HEAD_CHARS)
    : text;
  const normalized = head.replace(/\s+/g, " ").trim();
  const result = normalized.length > 0 && INTERNAL_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized));

  if (promptTextCache.size >= PROMPT_TEXT_CACHE_MAX) {
    const first = promptTextCache.keys().next().value;
    if (first !== undefined) promptTextCache.delete(first);
  }
  // Cache by original string so repeat scans of the same event content hit.
  promptTextCache.set(text, result);
  return result;
}

function eventLooksInternal(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const record = event as { type?: unknown; content?: unknown };
  if (record.type !== "user_message" && record.type !== "steer_message") return false;
  const content = typeof record.content === "string" ? record.content : "";
  if (!content) return false;
  return isInternalPromptText(content)
    || content.includes("Hooks 规则创建 agent")
    || content.includes("HookRule JSON");
}

function eventsContainInternalPrompt(events: unknown[] | undefined): boolean {
  if (!events || events.length === 0) return false;
  let checked = 0;
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const type = (event as { type?: unknown }).type;
    if (type !== "user_message" && type !== "steer_message") continue;
    if (eventLooksInternal(event)) return true;
    checked += 1;
    if (checked >= INTERNAL_USER_EVENT_SCAN_LIMIT) break;
  }
  return false;
}

function computeIsHiddenInternalSession(session: {
  id?: string;
  title?: string;
  brief?: string;
  events?: unknown[];
  collaboration?: { agentEvents?: Record<string, unknown[]> };
}): boolean {
  if (session.id?.startsWith("kimix-hidden-hooks-")) return true;
  const title = session.title ?? session.brief ?? "";
  if (isInternalPromptText(title)) return true;
  if (title.startsWith("{\"name\":") || title.includes("HookRule JSON") || title.includes("Hooks 规则创建 agent")) {
    return true;
  }
  if (eventsContainInternalPrompt(session.events)) return true;
  // Room agents store the first user turn under agentEvents, not always on session.events.
  const agentEvents = session.collaboration?.agentEvents;
  if (agentEvents) {
    for (const events of Object.values(agentEvents)) {
      if (eventsContainInternalPrompt(events)) return true;
    }
  }
  return false;
}

export function isHiddenInternalSession(session: {
  id?: string;
  title?: string;
  brief?: string;
  events?: unknown[];
  collaboration?: { agentEvents?: Record<string, unknown[]> };
}) {
  if (session && typeof session === "object") {
    const cached = hiddenSessionCache.get(session as object);
    if (cached !== undefined) return cached;
  }
  const result = computeIsHiddenInternalSession(session);
  if (session && typeof session === "object") {
    hiddenSessionCache.set(session as object, result);
  }
  return result;
}

/** test helper */
export function resetInternalSessionCachesForTests() {
  promptTextCache.clear();
}
