import { describe, expect, it } from "vitest";
import { loadSessionHistoryWithFallback } from "../../../electron/sessionHistoryFallback";

const event = { type: "TurnBegin", payload: { user_input: "hello" } };

describe("session history fallback", () => {
  it("uses local wire history when the Server snapshot is empty", async () => {
    await expect(loadSessionHistoryWithFallback(
      async () => ({ events: [], source: "server" }),
      async () => [event],
    )).resolves.toEqual({ events: [event], source: "local" });
  });

  it("keeps a non-empty Server snapshot authoritative", async () => {
    await expect(loadSessionHistoryWithFallback(
      async () => ({ events: [event], source: "server" }),
      async () => [],
    )).resolves.toEqual({ events: [event], source: "server" });
  });

  it("falls back when the Server snapshot times out", async () => {
    await expect(loadSessionHistoryWithFallback(
      () => new Promise(() => undefined),
      async () => [event],
      1,
    )).resolves.toEqual({ events: [event], source: "local" });
  });
});
