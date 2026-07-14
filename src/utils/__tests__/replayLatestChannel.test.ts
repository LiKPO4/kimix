import { describe, expect, it, vi } from "vitest";
import { createReplayLatestChannel } from "../../../electron/replayLatestChannel";

describe("replay latest channel", () => {
  it("replays a bootstrap payload published before the renderer subscribes", () => {
    const channel = createReplayLatestChannel<{ projectId: string }>();
    channel.publish({ projectId: "remove-black" });
    const listener = vi.fn();

    channel.subscribe(listener);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ projectId: "remove-black" });
  });

  it("delivers later values once and stops after unsubscribe", () => {
    const channel = createReplayLatestChannel<number>();
    const listener = vi.fn();
    const unsubscribe = channel.subscribe(listener);

    channel.publish(1);
    unsubscribe();
    channel.publish(2);

    expect(listener.mock.calls).toEqual([[1]]);
  });
});
