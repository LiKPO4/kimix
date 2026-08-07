import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StatusNotificationDetail, TimelineEvent } from "@/types/ui";
import { NotificationCard, NotificationGroupCard, notificationHeadline, notificationStatusLabel } from "../NotificationCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type StatusUpdateEvent = Extract<TimelineEvent, { type: "status_update" }>;

function makeDetail(overrides: Partial<StatusNotificationDetail> = {}): StatusNotificationDetail {
  return {
    kind: "notification",
    type: "task.completed",
    category: "task",
    sourceKind: "background_task",
    sourceId: "bash-33vs0s7e",
    title: "Background process completed",
    severity: "info",
    body: "阶段1收尾全量 vitest completed.",
    raw: '<notification type="task.completed">...</notification>',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<StatusUpdateEvent> = {}): StatusUpdateEvent {
  return {
    id: "n1",
    type: "status_update",
    timestamp: Date.parse("2026-08-07T10:33:00"),
    message: "后台任务已完成：阶段1收尾全量 vitest",
    source: "runtime",
    tone: "success",
    notification: makeDetail(),
    ...overrides,
  };
}

describe("NotificationCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderCard(event: StatusUpdateEvent, embedded = false) {
    act(() => {
      root.render(createElement(NotificationCard, { event, embedded }));
    });
  }

  it("折叠态显示中文标题/英文副标题/状态·时间，点击展开结构化字段与原始 payload", () => {
    renderCard(makeEvent());
    expect(container.textContent).toContain("后台任务完成");
    expect(container.textContent).toContain("Background process completed");
    expect(container.textContent).toContain("完成 · 10:33");
    // 折叠态不显示详情字段
    expect(container.textContent).not.toContain("task.completed");
    expect(container.textContent).not.toContain("原始 payload");

    const button = container.querySelector("button");
    act(() => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("task.completed");
    expect(container.textContent).toContain("background_task · bash-33vs0s7e");
    expect(container.textContent).toContain("info");
    expect(container.textContent).toContain("阶段1收尾全量 vitest completed.");
    expect(container.textContent).toContain("原始 payload");
  });

  it("缺失 notification 字段（旧持久化数据）不渲染", () => {
    renderCard(makeEvent({ notification: undefined }));
    expect(container.innerHTML).toBe("");
  });

  it("标题与状态文案按类型映射", () => {
    expect(notificationHeadline(makeDetail())).toBe("后台任务完成");
    expect(notificationStatusLabel(makeDetail())).toBe("完成");
    expect(notificationHeadline(makeDetail({ type: "task.lost" }))).toBe("后台任务丢失");
    expect(notificationStatusLabel(makeDetail({ type: "task.lost" }))).toBe("丢失");
    expect(notificationHeadline(makeDetail({ kind: "cron-fire", type: "cron.fire" }))).toBe("定时任务触发");
    expect(notificationStatusLabel(makeDetail({ kind: "cron-fire", type: "cron.fire" }))).toBe("触发");
    expect(notificationHeadline(makeDetail({ type: "task.other" }))).toBe("后台任务通知");
  });
});

describe("NotificationGroupCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("折叠态显示「N 条通知」与摘要行，展开后逐条渲染嵌入卡", () => {
    const events = [1, 2, 3, 4].map((index) => makeEvent({
      id: `n${index}`,
      timestamp: Date.parse(`2026-08-07T11:0${index}:00`),
      notification: makeDetail({ title: "Background agent completed" }),
    }));
    act(() => {
      root.render(createElement(NotificationGroupCard, { events }));
    });
    expect(container.textContent).toContain("4 条通知");
    expect(container.textContent).toContain("Background agent completed · Background agent completed");
    // 折叠态不渲染逐条卡片
    expect(container.querySelectorAll("[aria-expanded]").length).toBe(1);

    const button = container.querySelector("button");
    act(() => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // 展开后摘要行收起，出现 4 张嵌入卡（各自可再展开详情）
    expect(container.textContent).not.toContain("Background agent completed · Background agent completed");
    const headlines = Array.from(container.querySelectorAll("span")).filter((el) => el.textContent === "后台任务完成");
    expect(headlines.length).toBe(4);
  });
});
