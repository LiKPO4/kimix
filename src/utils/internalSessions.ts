export function isInternalPromptText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return [
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
  ].some((pattern) => pattern.test(normalized));
}

export function isHiddenInternalSession(session: { id?: string; title?: string; brief?: string; events?: unknown[] }) {
  if (session.id?.startsWith("kimix-hidden-hooks-")) return true;
  const title = session.title ?? session.brief ?? "";
  if (isInternalPromptText(title)) return true;
  if (title.startsWith("{\"name\":") || title.includes("HookRule JSON") || title.includes("Hooks 规则创建 agent")) return true;
  return (session.events ?? []).some((event) => {
    if (!event || typeof event !== "object") return false;
    const content = typeof (event as { content?: unknown }).content === "string" ? (event as { content: string }).content : "";
    return isInternalPromptText(content) || content.includes("Hooks 规则创建 agent") || content.includes("HookRule JSON");
  });
}
