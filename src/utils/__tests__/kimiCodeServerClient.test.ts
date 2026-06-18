import { describe, expect, it } from "vitest";
import {
  flattenServerEvent,
  isKimiCodeServerSessionRoutingEnabled,
  toServerPromptContent,
} from "../../../electron/kimiCodeServerClient";

describe("KimiCodeServerClient protocol adapters", () => {
  it("requires a separate explicit flag for server session routing", () => {
    expect(isKimiCodeServerSessionRoutingEnabled({})).toBe(false);
    expect(isKimiCodeServerSessionRoutingEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER: "1" })).toBe(false);
    expect(isKimiCodeServerSessionRoutingEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER_SESSIONS: "1" })).toBe(true);
  });

  it("maps SDK prompt parts to the official server content shape", () => {
    expect(toServerPromptContent("hello")).toEqual([{ type: "text", text: "hello" }]);
    expect(toServerPromptContent([
      { type: "text", text: "look" },
      { type: "image_url", imageUrl: { url: "data:image/png;base64,AA==", id: "img-1" } },
    ])).toEqual([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA==", id: "img-1" } },
    ]);
  });

  it("flattens websocket event payloads into the SDK-compatible event shape", () => {
    expect(flattenServerEvent({
      type: "assistant.delta",
      seq: 7,
      session_id: "s1",
      payload: { delta: "hi", agentId: "main" },
    })).toEqual({ type: "assistant.delta", delta: "hi", agentId: "main", seq: 7 });
  });
});
