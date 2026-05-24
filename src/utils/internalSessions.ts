export function isHiddenInternalSession(session: { id?: string; title?: string; brief?: string; events?: unknown[] }) {
  if (session.id?.startsWith("kimix-hidden-hooks-")) return true;
  const title = session.title ?? session.brief ?? "";
  if (title.startsWith("{\"name\":") || title.includes("HookRule JSON") || title.includes("Hooks 规则创建 agent")) return true;
  return (session.events ?? []).some((event) => {
    if (!event || typeof event !== "object") return false;
    const content = typeof (event as { content?: unknown }).content === "string" ? (event as { content: string }).content : "";
    return content.includes("Hooks 规则创建 agent") || content.includes("HookRule JSON");
  });
}
