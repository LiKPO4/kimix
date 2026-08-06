import type { KimiCodeServerClient } from "./kimiCodeServerClient";

export type KimiCodePromptPart = { type: "text"; text: string } | { type?: string; [key: string]: unknown };

const STEER_CONFIRM_TIMEOUT_MS = 90 * 1000;
const STEER_CONFIRM_INTERVAL_MS = 3_000;

function normalizeSteerText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function promptInputText(input: string | KimiCodePromptPart[]): string {
  if (typeof input === "string") return input;
  return input
    .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
}

function steerUserMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const item = part as { type?: unknown; text?: unknown };
      return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
    })
    .join("\n");
}

/**
 * Server 路径的 steer 官方确认轮询：live WS 不推送 steer user 确认帧（实测无
 * context.spliced / prompt.steered 的 WS 广播），官方在 steer 两步协议成功后把内容
 * 作为 user 消息写入上下文（context.append_message，实测延迟约 15s）。轮询
 * listMessages，发现「steer 时刻之后落库、内容与 steer 文本匹配」的 user 消息即
 * 返回合成确认记录（source=server-confirm，渲染层映射为 sent）；超时返回 null，
 * 由轮次终态的 completed 收敛兜底。幂等：确认记录只发一次，且与本地 steer_message
 * 按内容合并，重复合并不产生第二条气泡。
 */
export async function waitForOfficialSteerUserMessage(
  client: Pick<KimiCodeServerClient, "listMessages">,
  sessionId: string,
  input: string | KimiCodePromptPart[],
  startedAt: number,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<Record<string, unknown> | null> {
  const expectedText = normalizeSteerText(promptInputText(input));
  if (!expectedText) return null;
  const timeoutMs = options?.timeoutMs ?? STEER_CONFIRM_TIMEOUT_MS;
  const intervalMs = options?.intervalMs ?? STEER_CONFIRM_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const result = await client.listMessages(sessionId, 100).catch(() => null);
    if (result?.items) {
      for (const item of result.items) {
        if (item.role !== "user") continue;
        const createdAt = Date.parse(item.created_at);
        if (!Number.isFinite(createdAt) || createdAt <= startedAt) continue;
        const normalized = normalizeSteerText(steerUserMessageText(item.content));
        if (!normalized) continue;
        if (
          normalized === expectedText ||
          normalized.startsWith(expectedText) ||
          expectedText.startsWith(normalized)
        ) {
          return {
            type: "turn.steer",
            time: Date.now(),
            input,
            messageId: item.id,
            source: "server-confirm",
          };
        }
      }
    }
    await delay(intervalMs);
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
