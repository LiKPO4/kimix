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
  // 时钟校准：首次探测后若未命中，用官方时间戳最大的一条覆盖本地基线（与
  // kimiCodeServerClient.calibrateLivePostTerminalWatchToOfficialTime 同款），避免
  // 本地时钟偏快时把引导后落库的确认消息误判为旧消息；失败保持本地时间基线。
  let baseline = startedAt;
  let calibrated = false;
  while (Date.now() <= deadline) {
    const result = await client.listMessages(sessionId, 100).catch(() => null);
    if (result?.items) {
      for (const item of result.items) {
        if (item.role !== "user") continue;
        const createdAt = Date.parse(item.created_at);
        if (!Number.isFinite(createdAt) || createdAt <= baseline) continue;
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
      // 校准放在内容匹配之后：校准响应若已含确认消息（确认消息先于首轮探测落库），
      // 先匹配仍能命中；未命中才校准，避免把确认消息自身时间戳吸收进基线造成漏检。
      if (!calibrated) {
        let latestAt: number | undefined;
        for (const item of result.items) {
          const at = Date.parse(item.created_at);
          if (Number.isFinite(at) && (latestAt === undefined || at > latestAt)) latestAt = at;
        }
        if (latestAt !== undefined) {
          baseline = latestAt;
          calibrated = true;
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
