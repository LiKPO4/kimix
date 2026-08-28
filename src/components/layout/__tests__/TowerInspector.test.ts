import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TowerInspector } from "../TowerInspector";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const towerSnapshot = {
  version: 1,
  repoRoot: "D:/repo",
  base: "master",
  mode: "branch",
  createdAt: "2026-08-28T00:00:00Z",
  roster: { agents: [{ name: "执行者 A", agentId: "agent-a", kind: "worker", missionId: "m-1", branch: "tower/m-1", spawnedAt: "2026-08-28T00:00:00Z" }] },
  missions: [{ id: "m-1", title: "实现设置", slug: "settings", kind: "build", scope: ["src"], branch: "tower/m-1", worktree: "D:/repo/.tower/m-1", deps: [], status: "active", tasks: [{ text: "实现", done: true }, { text: "验证", done: false }], notes: [], blockers: [] }],
  activity: ["older", "latest"],
  ownership: { ownerSessionId: "session-a", ownedByCurrentSession: true, openMissionIds: ["m-1"] },
};

async function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(createElement(TowerInspector, {
    open: true,
    runtimeSessionId: "session-a",
    workDir: "D:/repo",
    towerMode: true,
    showToast: vi.fn(),
  })));
  await act(async () => await Promise.resolve());
  return container;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "api");
  vi.restoreAllMocks();
});

describe("TowerInspector", () => {
  it("renders dense mission rows and the three tabs from an official snapshot", async () => {
    (window as unknown as { api: unknown }).api = {
      getKimiCodeTowerSnapshot: vi.fn(async () => ({ success: true, data: towerSnapshot })),
      teardownKimiCodeTower: vi.fn(async () => ({ success: true, data: undefined })),
    };
    const container = await render();
    expect(container.textContent).toContain("实现设置");
    expect(container.textContent).toContain("1/2 个任务");
    expect(container.textContent).toContain("任务 1");
    expect(container.textContent).toContain("Agent 1");
    expect(container.textContent).toContain("活动 2");
  });

  it("keeps teardown behind explicit confirmation and describes non-force semantics", async () => {
    const teardownKimiCodeTower = vi.fn(async () => ({ success: true, data: undefined }));
    (window as unknown as { api: unknown }).api = {
      getKimiCodeTowerSnapshot: vi.fn(async () => ({ success: true, data: towerSnapshot })),
      teardownKimiCodeTower,
    };
    const container = await render();
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "清理 Tower 工作树");
    await act(async () => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain("不会强制删除任何内容");
    expect(teardownKimiCodeTower).not.toHaveBeenCalled();
  });
});
