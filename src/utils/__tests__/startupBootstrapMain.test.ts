import { describe, expect, it, vi } from "vitest";
import { createReplayLatestChannel } from "../../../electron/replayLatestChannel";
import {
  createDeferredOnceTask,
  createDistinctAsyncWriter,
  publishStartupBootstrap,
  registerStartupBootstrapPublisher,
} from "../../../electron/startupBootstrap";

function createDidFinishLoadSource() {
  const listeners = new Set<() => void>();
  return {
    subscription: {
      add: (listener: () => void) => { listeners.add(listener); },
      remove: (listener: () => void) => { listeners.delete(listener); },
    },
    emit: () => { listeners.forEach((listener) => listener()); },
  };
}

describe("startup bootstrap main-process lifecycle", () => {
  it("defers default-project preparation and schedules it only once", async () => {
    const task = vi.fn();
    const onError = vi.fn();
    const schedule = createDeferredOnceTask(task, onError);

    schedule();
    schedule();
    expect(task).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(task).toHaveBeenCalledOnce();

    schedule();
    await Promise.resolve();
    expect(task).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("contains a deferred preparation failure without scheduling it again", async () => {
    const error = new Error("directory unavailable");
    const onError = vi.fn();
    const schedule = createDeferredOnceTask(async () => {
      throw error;
    }, onError);

    schedule();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);

    schedule();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("publishes the recovery payload before deferred directory preparation", async () => {
    const order: string[] = [];
    const schedulePreparation = createDeferredOnceTask(
      () => { order.push("prepare"); },
      vi.fn(),
    );

    const publishing = publishStartupBootstrap({
      resolveProject: () => ({ id: "project-06" }),
      fallbackProject: () => ({ id: "fallback" }),
      send: () => { order.push("send"); },
      rememberProject: async () => { order.push("remember"); },
      onError: vi.fn(),
    });
    schedulePreparation();

    expect(order).toEqual(["send", "remember"]);
    await publishing;
    expect(order).toEqual(["send", "remember", "prepare"]);
  });

  it("coalesces concurrent writes and skips a successfully remembered project", async () => {
    const write = vi.fn(async () => undefined);
    const remember = createDistinctAsyncWriter(
      (project: { id: string }) => project.id,
      write,
    );

    await Promise.all([
      remember({ id: "project-06" }),
      remember({ id: "project-06" }),
    ]);
    await remember({ id: "project-06" });

    expect(write).toHaveBeenCalledOnce();
  });

  it("writes again when the remembered project identity changes", async () => {
    const write = vi.fn(async () => undefined);
    const remember = createDistinctAsyncWriter(
      (project: { id: string }) => project.id,
      write,
    );

    await remember({ id: "project-06" });
    await remember({ id: "project-07" });

    expect(write).toHaveBeenCalledTimes(2);
  });

  it("retries the same project after a failed write", async () => {
    const write = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    const remember = createDistinctAsyncWriter(
      (project: { id: string }) => project.id,
      write,
    );

    await expect(remember({ id: "project-06" })).rejects.toThrow("disk full");
    await expect(remember({ id: "project-06" })).resolves.toBeUndefined();

    expect(write).toHaveBeenCalledTimes(2);
  });

  it("publishes again after a renderer reload replaces the preload replay channel", () => {
    const source = createDidFinishLoadSource();
    let channel = createReplayLatestChannel<{ projectId: string }>();
    const firstRenderer = vi.fn();
    channel.subscribe(firstRenderer);
    const dispose = registerStartupBootstrapPublisher(source.subscription, () => {
      channel.publish({ projectId: "project-06" });
    });

    source.emit();
    expect(firstRenderer).toHaveBeenCalledOnce();

    channel = createReplayLatestChannel<{ projectId: string }>();
    const reloadedRenderer = vi.fn();
    channel.subscribe(reloadedRenderer);
    source.emit();

    expect(reloadedRenderer).toHaveBeenCalledOnce();
    expect(reloadedRenderer).toHaveBeenCalledWith({ projectId: "project-06" });

    dispose();
    source.emit();
    expect(reloadedRenderer).toHaveBeenCalledOnce();
  });

  it("sends bootstrap before remembering the project and tolerates a write failure", async () => {
    const order: string[] = [];
    const send = vi.fn(() => { order.push("send"); });
    const onError = vi.fn((stage: string) => { order.push(`error:${stage}`); });

    const project = await publishStartupBootstrap({
      resolveProject: () => ({ id: "project-06" }),
      fallbackProject: () => ({ id: "fallback" }),
      send,
      rememberProject: async () => {
        order.push("remember");
        throw new Error("disk full");
      },
      onError,
    });

    expect(project).toEqual({ id: "project-06" });
    expect(send).toHaveBeenCalledWith({ project: { id: "project-06" } });
    expect(order).toEqual(["send", "remember", "error:remember-project"]);
    expect(onError).toHaveBeenCalledWith("remember-project", expect.any(Error));
  });

  it("falls back to a safe project when startup project resolution throws", async () => {
    const send = vi.fn();
    const rememberProject = vi.fn(async () => undefined);
    const onError = vi.fn();

    await publishStartupBootstrap({
      resolveProject: () => { throw new Error("projects file unavailable"); },
      fallbackProject: () => ({ id: "default-project" }),
      send,
      rememberProject,
      onError,
    });

    expect(send).toHaveBeenCalledWith({ project: { id: "default-project" } });
    expect(rememberProject).toHaveBeenCalledWith({ id: "default-project" });
    expect(onError).toHaveBeenCalledWith("resolve-project", expect.any(Error));
  });
});
