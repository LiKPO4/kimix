import { describe, expect, it } from "vitest";
import { prependOlderServerMessages, type ServerMessageSummary } from "../kimiCodeServerClient";

function msg(id: string): ServerMessageSummary {
  return { id, session_id: "s1", role: "user", content: [], created_at: "2026-01-01T00:00:00Z" };
}

type Page = { items: ServerMessageSummary[]; has_more: boolean };

function pageFetcher(pages: Record<string, Page>) {
  const calls: string[] = [];
  const fetchPage = async (beforeId: string): Promise<Page> => {
    calls.push(beforeId);
    const page = pages[beforeId];
    if (!page) throw new Error(`unexpected before_id ${beforeId}`);
    return page;
  };
  return { calls, fetchPage };
}

describe("prependOlderServerMessages", () => {
  it("多页补齐：倒序页反转为升序并前插，游标逐页前移", async () => {
    // tail 已有 m5；第一页返回 [m4, m3]（倒序），第二页返回 [m2, m1]
    const { calls, fetchPage } = pageFetcher({
      m5: { items: [msg("m4"), msg("m3")], has_more: true },
      m3: { items: [msg("m2"), msg("m1")], has_more: false },
    });
    const result = await prependOlderServerMessages(fetchPage, [msg("m5")]);
    expect(result?.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(calls).toEqual(["m5", "m3"]);
  });

  it("空页且 has_more=false 视为补齐完成", async () => {
    const { fetchPage } = pageFetcher({
      m5: { items: [], has_more: false },
    });
    const result = await prependOlderServerMessages(fetchPage, [msg("m5")]);
    expect(result?.map((m) => m.id)).toEqual(["m5"]);
  });

  it("空页但 has_more=true 视为补齐失败返回 null", async () => {
    const { fetchPage } = pageFetcher({
      m5: { items: [], has_more: true },
    });
    const result = await prependOlderServerMessages(fetchPage, [msg("m5")]);
    expect(result).toBeNull();
  });

  it("fetchPage 抛错返回 null", async () => {
    const result = await prependOlderServerMessages(
      async () => { throw new Error("network down"); },
      [msg("m5")],
    );
    expect(result).toBeNull();
  });

  it("页中包含已见 id 时去重（防御 server 返回含 pivot 的页）", async () => {
    const { fetchPage } = pageFetcher({
      m5: { items: [msg("m5"), msg("m4"), msg("m3")], has_more: false },
    });
    const result = await prependOlderServerMessages(fetchPage, [msg("m5")]);
    expect(result?.map((m) => m.id)).toEqual(["m3", "m4", "m5"]);
  });

  it("页内容全部已见且 has_more=true 时返回 null（游标无进展防死循环）", async () => {
    const { fetchPage } = pageFetcher({
      m5: { items: [msg("m5")], has_more: true },
    });
    const result = await prependOlderServerMessages(fetchPage, [msg("m5")]);
    expect(result).toBeNull();
  });

  it("始终有更新页时受 maxPages 限制返回 null", async () => {
    let counter = 0;
    const fetchPage = async (): Promise<Page> => {
      counter += 1;
      return { items: [msg(`old-${counter}`)], has_more: true };
    };
    const result = await prependOlderServerMessages(fetchPage, [msg("m5")], 3);
    expect(result).toBeNull();
    expect(counter).toBe(3);
  });

  it("tail 首条无 id 时无法定位游标返回 null", async () => {
    const tail = [{ ...msg(""), id: "" } as ServerMessageSummary];
    const result = await prependOlderServerMessages(async () => ({ items: [], has_more: false }), tail);
    expect(result).toBeNull();
  });

  it("snapshot 风格消息用 message_id 字段也能定位游标", async () => {
    const snapshotStyle = (id: string) => ({ message_id: id, session_id: "s1", role: "user", content: [], created_at: "2026-01-01T00:00:00Z" } as unknown as ServerMessageSummary);
    const { calls, fetchPage } = pageFetcher({
      m5: { items: [snapshotStyle("m4")], has_more: false },
    });
    const result = await prependOlderServerMessages(fetchPage, [snapshotStyle("m5")]);
    expect(result?.map((m) => (m as unknown as Record<string, unknown>).message_id ?? m.id)).toEqual(["m4", "m5"]);
    expect(calls).toEqual(["m5"]);
  });
});
