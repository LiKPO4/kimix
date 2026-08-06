import { describe, expect, it, vi } from "vitest";
import { waitForOfficialSteerUserMessage } from "../../../electron/steerConfirm";
import type { ServerMessageSummary } from "../../../electron/kimiCodeServerClient";

function userMessage(id: string, text: string, createdAt: string): ServerMessageSummary {
  return {
    id,
    session_id: "s1",
    role: "user",
    content: [{ type: "text", text }],
    created_at: createdAt,
  };
}

const now = Date.now();
const startedAt = now - 60_000;

describe("waitForOfficialSteerUserMessage", () => {
  it("returns a server-confirm record when the steer content lands as an official user message", async () => {
    const client = {
      listMessages: vi.fn().mockResolvedValue({
        items: [
          userMessage("msg_01KZB4F6GSBXN9E832ZXQVSAVY", "顺便把版本迭代到162行吗", new Date(startedAt + 10_000).toISOString()),
        ],
        has_more: false,
      }),
    };
    const record = await waitForOfficialSteerUserMessage(client, "s1", "顺便把版本迭代到162行吗", startedAt, {
      timeoutMs: 50,
      intervalMs: 10,
    });
    expect(record).not.toBeNull();
    expect(record).toMatchObject({
      type: "turn.steer",
      input: "顺便把版本迭代到162行吗",
      messageId: "msg_01KZB4F6GSBXN9E832ZXQVSAVY",
      source: "server-confirm",
    });
    // 命中即停（幂等：确认帧只发一次）
    expect(client.listMessages).toHaveBeenCalledTimes(1);
  });

  it("ignores a same-content user message that predates the steer (historical echo)", async () => {
    // 用户之前发过相同内容（历史里已存在）：created_at 早于 steer 时刻的 user
    // 消息不是本次 steer 的确认，不得误收敛。
    const client = {
      listMessages: vi.fn().mockResolvedValue({
        items: [
          userMessage("msg_old", "顺便把版本迭代到162行吗", new Date(startedAt - 60_000).toISOString()),
        ],
        has_more: false,
      }),
    };
    const record = await waitForOfficialSteerUserMessage(client, "s1", "顺便把版本迭代到162行吗", startedAt, {
      timeoutMs: 60,
      intervalMs: 10,
    });
    expect(record).toBeNull();
  });

  it("ignores unrelated official user messages (no content match)", async () => {
    const client = {
      listMessages: vi.fn().mockResolvedValue({
        items: [userMessage("msg_other", "另一条用户消息", new Date(startedAt + 5_000).toISOString())],
        has_more: false,
      }),
    };
    const record = await waitForOfficialSteerUserMessage(client, "s1", "顺便把版本迭代到162行吗", startedAt, {
      timeoutMs: 60,
      intervalMs: 10,
    });
    expect(record).toBeNull();
  });

  it("ignores assistant messages even when their body contains the steer text", async () => {
    const client = {
      listMessages: vi.fn().mockResolvedValue({
        items: [
          {
            id: "msg_assistant",
            session_id: "s1",
            role: "assistant",
            content: [{ type: "text", text: "顺便把版本迭代到162行吗" }],
            created_at: new Date(startedAt + 5_000).toISOString(),
          },
        ],
        has_more: false,
      }),
    };
    const record = await waitForOfficialSteerUserMessage(client, "s1", "顺便把版本迭代到162行吗", startedAt, {
      timeoutMs: 60,
      intervalMs: 10,
    });
    expect(record).toBeNull();
  });

  it("returns null for attachment-only steers (no comparable text)", async () => {
    const client = {
      listMessages: vi.fn().mockResolvedValue({ items: [], has_more: false }),
    };
    const record = await waitForOfficialSteerUserMessage(client, "s1", [{ type: "image" } as never], startedAt, {
      timeoutMs: 60,
      intervalMs: 10,
    });
    expect(record).toBeNull();
    expect(client.listMessages).not.toHaveBeenCalled();
  });
});
