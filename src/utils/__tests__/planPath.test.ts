import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import {
  canPreserveSessionPlanContent,
  findSessionPlanPath,
  findSessionPlanSignal,
  hasSessionPlanSignal,
  sessionPlanFallbackPolicy,
  sessionPlanTargetKey,
  SESSION_PLAN_MAX_RETRIES,
  shouldRetrySessionPlanRead,
} from "../planPath";

describe("planPath", () => {
  it("仅在官方计划会话尚未绑定时执行有上限的首次恢复重试", () => {
    expect(shouldRetrySessionPlanRead("__latest_kimi_plan__", true, 0)).toBe(true);
    expect(shouldRetrySessionPlanRead("__latest_kimi_plan__", true, SESSION_PLAN_MAX_RETRIES)).toBe(false);
    expect(shouldRetrySessionPlanRead("__latest_kimi_plan__", false, 0)).toBe(false);
    expect(shouldRetrySessionPlanRead(".kimi/plans/legacy.md", true, 0)).toBe(false);
  });

  it("只允许 SDK 会话回退到全局本地计划目录", () => {
    expect(sessionPlanFallbackPolicy("sdk")).toBe("local");
    expect(sessionPlanFallbackPolicy(null)).toBe("retry");
    expect(sessionPlanFallbackPolicy("server")).toBe("official_only");
  });

  it("从官方 ExitPlanMode 工具参数识别会话计划正文", () => {
    const events: TimelineEvent[] = [{
      id: "tool-1",
      type: "tool_call",
      timestamp: 1,
      toolCallId: "call-1",
      toolName: "ExitPlanMode",
      status: "running",
      arguments: { plan: "# 修复计划\n\n1. 定位问题\n2. 完成验证" },
    }];

    expect(findSessionPlanSignal(events)).toEqual({
      path: null,
      content: "# 修复计划\n\n1. 定位问题\n2. 完成验证",
      source: "exit_plan_mode",
    });
    expect(hasSessionPlanSignal(events)).toBe(true);
  });

  it("从官方 plan_review 审批显示数据识别正文和路径", () => {
    const events: TimelineEvent[] = [{
      id: "approval-1",
      type: "approval_request",
      timestamp: 1,
      requestId: "request-1",
      toolName: "ExitPlanMode",
      description: "审阅计划",
      details: "",
      riskLevel: "medium",
      status: "pending",
      display: {
        kind: "plan_review",
        plan: "# 官方计划",
        path: "C:\\Users\\tester\\.kimi\\plans\\official.md",
      },
    }];

    expect(findSessionPlanSignal(events)).toEqual({
      path: "C:\\Users\\tester\\.kimi\\plans\\official.md",
      content: "# 官方计划",
      source: "plan_review",
    });
    expect(findSessionPlanPath(events)).toBe("C:\\Users\\tester\\.kimi\\plans\\official.md");
  });

  it("兼容历史 change summary 中的计划文件", () => {
    const events: TimelineEvent[] = [{
      id: "changes-1",
      type: "change_summary",
      timestamp: 1,
      files: [{ path: ".kimi/plans/legacy.md" }],
      additions: 10,
      deletions: 0,
    }];

    expect(findSessionPlanSignal(events)).toEqual({
      path: ".kimi/plans/legacy.md",
      content: null,
      source: "plan_file",
    });
  });
});

describe("会话 Plan 刷新占位", () => {
  it("同一目标且已展示正文时保持静默，避免执行一步闪烁一次", () => {
    const target = sessionPlanTargetKey("session-1", "C:\\ws\\.kimi-code\\plans\\plan.md");
    expect(canPreserveSessionPlanContent({ target, hasContent: true }, target)).toBe(true);
    expect(canPreserveSessionPlanContent({ target, hasContent: false }, target)).toBe(false);
    expect(canPreserveSessionPlanContent(null, target)).toBe(false);
  });

  it("会话或捕获路径变化时不沿用旧正文", () => {
    const applied = { target: sessionPlanTargetKey("session-1", "__latest_kimi_plan__"), hasContent: true };
    expect(canPreserveSessionPlanContent(applied, sessionPlanTargetKey("session-2", "__latest_kimi_plan__"))).toBe(false);
    expect(canPreserveSessionPlanContent(applied, sessionPlanTargetKey("session-1", null))).toBe(false);
    expect(canPreserveSessionPlanContent(applied, sessionPlanTargetKey("session-1", ".kimi/plans/other.md"))).toBe(false);
  });

  it("目标键区分会话与路径，避免拼接歧义", () => {
    expect(sessionPlanTargetKey("s1", null)).not.toBe(sessionPlanTargetKey("s1", "__latest_kimi_plan__"));
    expect(sessionPlanTargetKey("s1|p", null)).not.toBe(sessionPlanTargetKey("s1", "p"));
  });
});
