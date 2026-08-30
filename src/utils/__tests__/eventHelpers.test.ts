import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import { formatKimiSkillActivationCommand, hasLocalFailedSendAttempt, hasLocalOrphanUserSendAttempt, hasMalformedAssistantMarkdown, hasOfficialTurnEvidenceAfterUser, hasTurnReceivedBody, normalizeCompactionDisplay, officialHistoryHasUserMessageAsLatest, isLatestUserInputEvent, parseKimiGoalContinuation, removeLocalUserSendAttempt, repairStableAssistantOrder, sanitizeKimiSkillActivationTitle, sanitizePersistedEvents, settleFailedEvents, settleHistoricalQuestions, settleInactiveEvents, truncateLatestUserTurn } from "../eventHelpers";

describe("eventHelpers", () => {
  it("keeps assistant messages that only have thinking parts when settling", () => {
    const events: TimelineEvent[] = [{
      id: "assistant-1",
      type: "assistant_message",
      timestamp: 1,
      content: "",
      thinkingParts: [{ id: "think-1", timestamp: 1, text: "分析项目结构" }],
      isThinking: true,
      isComplete: false,
    }];

    const settled = settleInactiveEvents(events);
    expect(settled).toHaveLength(1);
    const assistant = settled[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.isComplete).toBe(true);
    expect(assistant.isThinking).toBe(false);
    expect(assistant.thinkingParts?.[0]?.text).toBe("分析项目结构");
  });

  it("settles stale running tools as interrupted without inventing a duration", () => {
    const now = 10 * 60 * 1000;
    const events: TimelineEvent[] = [{
      id: "tool-1",
      type: "tool_call",
      timestamp: 1,
      toolCallId: "tc-1",
      toolName: "bash",
      status: "running",
      arguments: { command: "ls" },
    }];

    const settled = settleInactiveEvents(events, now);
    expect(settled).toHaveLength(1);
    const tool = settled[0] as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(tool.status).toBe("error");
    expect(tool.durationMs).toBeUndefined();
    expect(tool.result).toContain("中断");
  });

  it("keeps recently running tools unchanged", () => {
    const now = 10 * 60 * 1000;
    const events: TimelineEvent[] = [{
      id: "tool-1",
      type: "tool_call",
      timestamp: now - 30_000,
      toolCallId: "tc-1",
      toolName: "bash",
      status: "running",
      arguments: { command: "ls" },
    }];

    const settled = settleInactiveEvents(events, now);
    expect(settled).toHaveLength(1);
    const tool = settled[0] as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(tool.status).toBe("running");
    expect(tool.durationMs).toBeUndefined();
  });

  it("settles all open work as failed when the runtime errors", () => {
    const events: TimelineEvent[] = [
      { id: "agent-1", type: "subagent", timestamp: 10, agentName: "worker", status: "running", events: [] },
      { id: "tool-1", type: "tool_call", timestamp: 20, toolCallId: "tc-1", toolName: "bash", status: "running", arguments: {} },
      { id: "assistant-1", type: "assistant_message", timestamp: 30, content: "已有部分输出", isThinking: true, isComplete: false },
    ];

    const settled = settleFailedEvents(events, "额度不足。", 100);
    expect(settled[0]).toMatchObject({ type: "subagent", status: "error", error: "额度不足。" });
    expect(settled[1]).toMatchObject({ type: "tool_call", status: "error", result: "额度不足。", durationMs: 80 });
    expect(settled[2]).toMatchObject({ type: "assistant_message", isThinking: false, isComplete: true, content: "已有部分输出" });
  });

  it("preserves an empty assistant placeholder when preserveEmptyAssistant is set", () => {
    // A premature terminal report (0.27 Server idle before body streams) must
    // not delete the optimistic placeholder. It is kept as isComplete=false so
    // the message header stays visible and the turn is not settled.
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
      { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "", isThinking: false, isComplete: false },
    ];

    const settled = settleInactiveEvents(events, 100, true);
    const assistant = settled.find((event) => event.type === "assistant_message") as Extract<TimelineEvent, { type: "assistant_message" }> | undefined;
    expect(assistant).toBeDefined();
    expect(assistant?.isComplete).toBe(false);
    expect(assistant?.content).toBe("");
  });

  it("deletes an empty assistant placeholder when preserveEmptyAssistant is not set", () => {
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
      { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "", isThinking: false, isComplete: false },
    ];

    const settled = settleInactiveEvents(events, 100);
    expect(settled.find((event) => event.type === "assistant_message")).toBeUndefined();
  });

  it("guarded settle keeps open assistants and placeholders while the timeline is still active", () => {
    const now = 10 * 60 * 1000;
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: now - 50_000, content: "继续" },
      { id: "assistant-open", type: "assistant_message", timestamp: now - 40_000, content: "写了一半", isThinking: false, isComplete: false },
      { id: "assistant-empty", type: "assistant_message", timestamp: now - 30_000, content: "", isThinking: false, isComplete: false },
    ];

    const settled = settleInactiveEvents(events, now, false, true);
    const open = settled.find((event) => event.id === "assistant-open") as Extract<TimelineEvent, { type: "assistant_message" }> | undefined;
    const empty = settled.find((event) => event.id === "assistant-empty") as Extract<TimelineEvent, { type: "assistant_message" }> | undefined;
    expect(open?.isComplete).toBe(false);
    expect(empty).toBeDefined();
    expect(empty?.isComplete).toBe(false);
  });

  it("guarded settle closes open work once the whole timeline is stale", () => {
    const now = 10 * 60 * 1000;
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: now - 400_000, content: "继续" },
      { id: "assistant-open", type: "assistant_message", timestamp: now - 300_000, content: "写了一半", isThinking: false, isComplete: false },
      { id: "assistant-empty", type: "assistant_message", timestamp: now - 250_000, content: "", isThinking: false, isComplete: false },
    ];

    const settled = settleInactiveEvents(events, now, false, true);
    const open = settled.find((event) => event.id === "assistant-open") as Extract<TimelineEvent, { type: "assistant_message" }> | undefined;
    expect(open?.isComplete).toBe(true);
    expect(settled.find((event) => event.id === "assistant-empty")).toBeUndefined();
  });

  it("immediate settle still force-completes recent open assistants (authoritative path unchanged)", () => {
    const now = 10 * 60 * 1000;
    const events: TimelineEvent[] = [
      { id: "assistant-open", type: "assistant_message", timestamp: now - 5_000, content: "写了一半", isThinking: true, isComplete: false },
    ];

    const settled = settleInactiveEvents(events, now);
    const open = settled[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(open.isComplete).toBe(true);
    expect(open.isThinking).toBe(false);
  });

  it("removes a local failed send attempt with its status, empty placeholder, and error", () => {
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "卡住了吗" },
      { id: "status-1", type: "status_update", timestamp: 2, message: "消息发送中", parentEventId: "user-1", source: "ipc" },
      { id: "assistant-empty", type: "assistant_message", timestamp: 3, content: "", isThinking: false, isComplete: true },
      { id: "error-1", type: "error", timestamp: 4, message: "Cannot launch a new turn while another turn is active", source: "ipc" },
      { id: "user-2", type: "user_message", timestamp: 5, content: "下一条" },
    ];

    expect(removeLocalUserSendAttempt(events, "user-1").map((event) => event.id))
      .toEqual(["user-2"]);
  });

  it("marks only local failed send attempts as deletable", () => {
    const failedEvents: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "卡住了吗" },
      { id: "status-1", type: "status_update", timestamp: 2, message: "消息发送中", parentEventId: "user-1", source: "ipc" },
      { id: "error-1", type: "error", timestamp: 3, message: "Cannot launch a new turn while another turn is active", source: "ipc" },
    ];
    const completedEvents: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
      { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "你好，有什么可以帮你？", isThinking: false, isComplete: true },
      { id: "error-later", type: "error", timestamp: 3, message: "unrelated", source: "ipc" },
    ];

    expect(hasLocalFailedSendAttempt(failedEvents, "user-1")).toBe(true);
    expect(hasLocalFailedSendAttempt(completedEvents, "user-1")).toBe(false);
  });

  it("marks a trailing user message without real output as a local orphan attempt", () => {
    const events: TimelineEvent[] = [
      { id: "assistant-1", type: "assistant_message", timestamp: 1, content: "继续说。", isThinking: false, isComplete: true },
      { id: "user-1", type: "user_message", timestamp: 2, content: "卡住了吗" },
    ];

    expect(hasLocalOrphanUserSendAttempt(events, "user-1")).toBe(true);
  });

  it("does not mark a user message with real assistant output as an orphan attempt", () => {
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
      { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "你好。", isThinking: false, isComplete: true },
    ];

    expect(hasLocalOrphanUserSendAttempt(events, "user-1")).toBe(false);
  });

  it("removes the latest user turn and all of its output for withdraw-to-draft", () => {
    const events: TimelineEvent[] = [
      { id: "user-0", type: "user_message", timestamp: 1, content: "上一轮" },
      { id: "assistant-0", type: "assistant_message", timestamp: 2, content: "上一轮回复", isThinking: false, isComplete: true },
      { id: "user-1", type: "user_message", timestamp: 3, content: "重发这一轮" },
      { id: "tool-1", type: "tool_call", timestamp: 4, toolCallId: "call-1", toolName: "Read", status: "success", arguments: {} },
      { id: "assistant-1", type: "assistant_message", timestamp: 5, content: "旧回复", isThinking: false, isComplete: true },
    ];
    expect(isLatestUserInputEvent(events, "user-1")).toBe(true);
    expect(truncateLatestUserTurn(events, "user-1").map((event) => event.id))
      .toEqual(["user-0", "assistant-0"]);
  });

  it("refuses to replace a non-latest user turn", () => {
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "旧消息" },
      { id: "user-2", type: "user_message", timestamp: 2, content: "最新消息" },
    ];

    expect(isLatestUserInputEvent(events, "user-1")).toBe(false);
    expect(truncateLatestUserTurn(events, "user-1")).toBe(events);
  });

  it("distinguishes official turn evidence from a local-only failed send", () => {
    const officialErrorEvents: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "触发官方错误" },
      { id: "error-1", type: "error", timestamp: 2, message: "filtered", source: "sdk" },
    ];
    const localFailureEvents: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "本地发送失败" },
      { id: "status-1", type: "status_update", timestamp: 2, message: "消息发送失败", source: "ipc", parentEventId: "user-1" },
      { id: "error-1", type: "error", timestamp: 3, message: "session unavailable", source: "ipc" },
    ];

    expect(hasOfficialTurnEvidenceAfterUser(officialErrorEvents, "user-1")).toBe(true);
    expect(hasOfficialTurnEvidenceAfterUser(localFailureEvents, "user-1")).toBe(false);
  });

  it("does not remove real assistant content after deleting a user message", () => {
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
      { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "你好，有什么可以帮你？", isThinking: false, isComplete: true },
      { id: "error-later", type: "error", timestamp: 3, message: "unrelated", source: "ipc" },
    ];

    expect(removeLocalUserSendAttempt(events, "user-1").map((event) => event.id))
      .toEqual(["assistant-1", "error-later"]);
  });
});

describe("sanitizePersistedEvents", () => {
  it("removes internal Skill instructions from cached user messages", () => {
    const events: TimelineEvent[] = [{
      id: "skill-1",
      type: "user_message",
      timestamp: 1,
      content: 'User activated the skill "find-skills".\n\n<kimi-skill-loaded name="find-skills" trigger="user-slash" args="查找游戏 Skill">\ninternal\n</kimi-skill-loaded>',
    }];

    expect(sanitizePersistedEvents(events)).toMatchObject([{
      type: "user_message",
      content: "/skill:find-skills 查找游戏 Skill",
    }]);
  });

  it("keeps model-triggered Skill payloads out of cached user bubbles", () => {
    const events: TimelineEvent[] = [{
      id: "skill-2",
      type: "user_message",
      timestamp: 2,
      content: '<kimi-skill-loaded name="game-development/game-design" trigger="model-tool" args="">\ninternal\n</kimi-skill-loaded>',
    }];

    expect(sanitizePersistedEvents(events)).toMatchObject([{
      type: "status_update",
      message: "已调用 Skill：game-development/game-design",
    }]);
  });

  it("collapses background-task notification envelopes into status summaries", () => {
    const events: TimelineEvent[] = [{
      id: "notif-1",
      type: "user_message",
      timestamp: 3,
      content: '<notification id="task:bash-hbcvffrs:completed" category="task" type="task.completed" source_kind="background_task" source_id="bash-hbcvffrs">\nTitle: Background process completed\nSeverity: info\n全量 flutter test（十方杀机包） completed.\n<output-file path="C:/Users/x/output.log" bytes="533">\nRead the output file to retrieve the result\n</output-file>\n</notification>',
    }];

    expect(sanitizePersistedEvents(events)).toMatchObject([{
      type: "status_update",
      message: "后台任务已完成：全量 flutter test（十方杀机包）",
      tone: "success",
      notification: {
        kind: "notification",
        type: "task.completed",
        category: "task",
        sourceKind: "background_task",
        sourceId: "bash-hbcvffrs",
        title: "Background process completed",
        severity: "info",
        body: "全量 flutter test（十方杀机包） completed.",
      },
    }]);
    // 原始 payload 完整保留，供详情卡「原始 payload」折叠展示
    const sanitized = sanitizePersistedEvents(events);
    const detail = sanitized[0].type === "status_update" ? sanitized[0].notification : undefined;
    expect(detail?.raw).toContain('<notification id="task:bash-hbcvffrs:completed"');
    expect(detail?.raw).toContain('</notification>');
    // <output-file> 解析为结构化输出文件（对齐官方后台任务卡的输出文件行）
    expect(detail?.outputFile).toEqual({ path: "C:/Users/x/output.log", bytes: 533 });
  });

  it("collapses subagent notification envelopes with 子代理 attribution", () => {
    const events: TimelineEvent[] = [{
      id: "notif-sub",
      type: "user_message",
      timestamp: 3,
      content: '<notification id="task:agent-bxryd4pv:completed" category="task" type="task.completed" severity="info" source_kind="subagent" source_id="agent-bxryd4pv" agent_id="agent-4">\nTitle: Background agent completed\nSeverity: info\n查官方压缩摘要渲染逻辑 completed.\n</notification>',
    }];

    expect(sanitizePersistedEvents(events)).toMatchObject([{
      type: "status_update",
      message: "子代理已完成：查官方压缩摘要渲染逻辑",
      tone: "success",
      notification: {
        kind: "notification",
        type: "task.completed",
        sourceKind: "subagent",
        sourceId: "agent-bxryd4pv",
        agentId: "agent-4",
        title: "Background agent completed",
      },
    }]);
  });

  it("collapses failed/timed_out/killed notifications with warning tone", () => {
    for (const [type, summary] of [
      ["task.failed", "后台任务已失败：跑测试"],
      ["task.timed_out", "后台任务已超时：跑测试"],
      ["task.killed", "后台任务已终止：跑测试"],
    ] as const) {
      const events: TimelineEvent[] = [{
        id: `notif-${type}`,
        type: "user_message",
        timestamp: 3,
        content: `<notification type="${type}" source_kind="background_task" source_id="bash-x">\nTitle: t\nSeverity: warning\n跑测试\n</notification>`,
      }];
      expect(sanitizePersistedEvents(events)).toMatchObject([{ type: "status_update", message: summary, tone: "warning" }]);
    }
  });

  it("collapses lost-task notification envelopes with warning tone", () => {
    const events: TimelineEvent[] = [{
      id: "notif-2",
      type: "user_message",
      timestamp: 4,
      content: '<notification id="task:bash-v:lost" category="task" type="task.lost" source_kind="background_task" source_id="bash-v">\nTitle: Background process lost\nSeverity: warning\n发布 1.4.482：构建 APK 并上传 8084 lost.\n</notification>',
    }];

    expect(sanitizePersistedEvents(events)).toMatchObject([{
      type: "status_update",
      message: "后台任务已丢失：发布 1.4.482：构建 APK 并上传 8084",
      tone: "warning",
      notification: {
        kind: "notification",
        type: "task.lost",
        sourceKind: "background_task",
        sourceId: "bash-v",
        title: "Background process lost",
        severity: "warning",
      },
    }]);
  });

  it("collapses cron-fire envelopes into status summaries", () => {
    const events: TimelineEvent[] = [{
      id: "cron-1",
      type: "user_message",
      timestamp: 5,
      content: '<cron-fire jobId="j1" cron="*/5 * * * *" recurring="true" coalescedCount="1" stale="false">\n<prompt>\n检查构建状态并汇报\n</prompt>\n</cron-fire>',
    }];

    expect(sanitizePersistedEvents(events)).toMatchObject([{
      type: "status_update",
      message: "定时任务触发：检查构建状态并汇报",
      tone: "info",
      notification: {
        kind: "cron-fire",
        type: "cron.fire",
        sourceKind: "cron",
        sourceId: "j1",
        body: "检查构建状态并汇报",
      },
    }]);
  });

  it("keeps ordinary user messages untouched by envelope sanitizing", () => {
    const events: TimelineEvent[] = [{
      id: "user-1",
      type: "user_message",
      timestamp: 6,
      content: "帮我看下 <notification> 这个标签怎么用",
    }];

    expect(sanitizePersistedEvents(events)).toMatchObject([{
      type: "user_message",
      content: "帮我看下 <notification> 这个标签怎么用",
    }]);
  });

  it("collapses goal-continuation user messages into status summaries", () => {
    const events: TimelineEvent[] = [{
      id: "goal-1",
      type: "user_message",
      timestamp: 7,
      content: "Continue working toward the active goal.",
    }, {
      id: "goal-2",
      type: "user_message",
      timestamp: 8,
      content: "The previous goal turn reached the per-turn step limit. Continue the goal execution; the goal is unchanged.",
    }];

    expect(sanitizePersistedEvents(events)).toMatchObject([
      { type: "status_update", message: "目标续跑", source: "runtime", tone: "info", id: "goal-1" },
      { type: "status_update", message: "目标续跑", source: "runtime", tone: "info", id: "goal-2" },
    ]);
  });

  it("keeps Resume-the-goal and ordinary user messages untouched by goal sanitizing", () => {
    const events: TimelineEvent[] = [{
      id: "resume-1",
      type: "user_message",
      timestamp: 9,
      content: "Resume the active goal.",
    }, {
      id: "plain-1",
      type: "user_message",
      timestamp: 10,
      content: "Continue working on this task.",
    }];

    expect(sanitizePersistedEvents(events)).toMatchObject([
      { type: "user_message", content: "Resume the active goal." },
      { type: "user_message", content: "Continue working on this task." },
    ]);
  });

  it("sanitizes cached official Skill activation titles", () => {
    expect(sanitizeKimiSkillActivationTitle('User activated the skill "find-skills".'))
      .toBe("使用 find-skills");
  });

  it("preserves built-in Skill command names while keeping external Skills namespaced", () => {
    expect(formatKimiSkillActivationCommand("custom-theme", "做一套暗色主题"))
      .toBe("/custom-theme 做一套暗色主题");
    expect(formatKimiSkillActivationCommand("find-skills", "查找主题 Skill"))
      .toBe("/skill:find-skills 查找主题 Skill");
  });
});

describe("parseKimiGoalContinuation", () => {
  const GOAL_ORIGIN = { kind: "system_trigger", name: "goal_continuation" };

  it("matches both official goal-continuation text prefixes", () => {
    expect(parseKimiGoalContinuation("Continue working toward the active goal.")).not.toBeNull();
    expect(parseKimiGoalContinuation("Continue working toward the active goal.  \n\n请继续执行。")).not.toBeNull();
    expect(parseKimiGoalContinuation("The previous goal turn reached the per-turn step limit. 继续执行当前目标。")).not.toBeNull();
    expect(parseKimiGoalContinuation("  The previous goal turn reached the per-turn step limit; the goal is unchanged.  ")).not.toBeNull();
  });

  it("matches the structured system_trigger origin regardless of text", () => {
    expect(parseKimiGoalContinuation("任意文本", GOAL_ORIGIN)).not.toBeNull();
    expect(parseKimiGoalContinuation("", GOAL_ORIGIN)).not.toBeNull();
  });

  it("does not match Resume-the-goal or ordinary user messages", () => {
    expect(parseKimiGoalContinuation("Resume the active goal.")).toBeNull();
    expect(parseKimiGoalContinuation("Continue working on this task.")).toBeNull();
    expect(parseKimiGoalContinuation("帮我继续完成这个任务")).toBeNull();
    expect(parseKimiGoalContinuation("", undefined)).toBeNull();
  });

  it("does not match origins with different kind or name", () => {
    expect(parseKimiGoalContinuation("普通消息文本", { kind: "system_trigger", name: "skill_invocation" })).toBeNull();
    expect(parseKimiGoalContinuation("普通消息文本", { kind: "user", name: "goal_continuation" })).toBeNull();
    expect(parseKimiGoalContinuation("普通消息文本", { name: "goal_continuation" })).toBeNull();
    expect(parseKimiGoalContinuation("普通消息文本", "goal_continuation")).toBeNull();
  });
});

describe("hasMalformedAssistantMarkdown", () => {
  it("detects a bold marker split onto its own line", () => {
    const malformed: TimelineEvent[] = [{
      id: "assistant-2",
      type: "assistant_message",
      timestamp: 1,
      content: "- **Achiever**：图鉴\n- **\n\nExplorer**：骰子组合",
      isThinking: false,
      isComplete: true,
    }];
    const canonical: TimelineEvent[] = [{
      ...(malformed[0] as Extract<TimelineEvent, { type: "assistant_message" }>),
      type: "assistant_message",
      content: "- **Achiever**：图鉴\n- **Explorer**：骰子组合",
    }];

    expect(hasMalformedAssistantMarkdown(malformed)).toBe(true);
    expect(hasMalformedAssistantMarkdown(canonical)).toBe(false);
  });

  describe("officialHistoryHasUserMessageAsLatest", () => {
    const user = (id: string, content: string, timestamp = 1): TimelineEvent => ({
      id, type: "user_message", timestamp, content,
    });

    it("matches by official user event id", () => {
      const events = [user("msg-official-1", "改一下"), user("msg-official-2", "最新问题")];
      expect(officialHistoryHasUserMessageAsLatest(events, { content: "别的内容", officialUserEventId: "msg-official-2" })).toBe(true);
      expect(officialHistoryHasUserMessageAsLatest(events, { content: "改一下", officialUserEventId: "msg-official-1" })).toBe(false);
    });

    it("matches by content echo against the latest official user message", () => {
      const events = [user("u1", "之前的消息"), user("u2", "改一下：\n\n[start] 旁白：山路旁……")];
      // Whitespace differences between the local display copy and the official
      // prompt copy must not break the echo match.
      expect(officialHistoryHasUserMessageAsLatest(events, { content: "改一下： [start] 旁白：山路旁……" })).toBe(true);
      expect(officialHistoryHasUserMessageAsLatest(events, { content: "改一下：\n[start] 旁白：山路旁……", officialUserEventId: "u1" })).toBe(true);
      expect(officialHistoryHasUserMessageAsLatest(events, { content: "完全不同的问题" })).toBe(false);
    });

    it("returns false when the matching message is not the latest user turn", () => {
      const events = [user("u1", "被撤回的消息"), user("u2", "更新的问题")];
      expect(officialHistoryHasUserMessageAsLatest(events, { content: "被撤回的消息" })).toBe(false);
    });

    it("returns false when there is no official user message or content is empty", () => {
      expect(officialHistoryHasUserMessageAsLatest([], { content: "任意" })).toBe(false);
      expect(officialHistoryHasUserMessageAsLatest([user("u1", "任意")], { content: "  " })).toBe(false);
    });
  });

  describe("hasTurnReceivedBody", () => {
    it("returns false when the latest turn has only an empty assistant placeholder", () => {
      const events: TimelineEvent[] = [
        { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
        { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "", isThinking: false, isComplete: false },
      ];
      expect(hasTurnReceivedBody(events)).toBe(false);
    });

    it("returns true when the latest turn has an assistant with content", () => {
      const events: TimelineEvent[] = [
        { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
        { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "你好，有什么需要？", isThinking: false, isComplete: false },
      ];
      expect(hasTurnReceivedBody(events)).toBe(true);
    });

    it("returns true when the latest turn has an assistant with thinking", () => {
      const events: TimelineEvent[] = [
        { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
        { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "", thinking: "正在思考", isThinking: true, isComplete: false },
      ];
      expect(hasTurnReceivedBody(events)).toBe(true);
    });

    it("returns true when the latest turn has thinking parts", () => {
      const events: TimelineEvent[] = [
        { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
        { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "", thinkingParts: [{ id: "tp-1", timestamp: 2, text: "分析中" }], isThinking: true, isComplete: false },
      ];
      expect(hasTurnReceivedBody(events)).toBe(true);
    });

    it("returns true when the latest turn has a tool_call", () => {
      const events: TimelineEvent[] = [
        { id: "user-1", type: "user_message", timestamp: 1, content: "列出文件" },
        { id: "tool-1", type: "tool_call", timestamp: 2, toolCallId: "tc-1", toolName: "bash", status: "running", arguments: {} },
      ];
      expect(hasTurnReceivedBody(events)).toBe(true);
    });

    it("returns true when the latest turn has an error event", () => {
      const events: TimelineEvent[] = [
        { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
        { id: "error-1", type: "error", timestamp: 2, message: "额度不足", canDismiss: true },
      ];
      expect(hasTurnReceivedBody(events)).toBe(true);
    });

    it("returns false when the latest turn has only a status_update", () => {
      // A status_update (e.g. "Context: 13.87%") is not Assistant body.
      const events: TimelineEvent[] = [
        { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
        { id: "status-1", type: "status_update", timestamp: 2, contextSize: 35000, message: "Context: 13.87%" },
      ];
      expect(hasTurnReceivedBody(events)).toBe(false);
    });

    it("returns false when there are no events after the latest user message", () => {
      const events: TimelineEvent[] = [
        { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
      ];
      expect(hasTurnReceivedBody(events)).toBe(false);
    });

    it("returns false when there is no user message", () => {
      const events: TimelineEvent[] = [
        { id: "assistant-1", type: "assistant_message", timestamp: 1, content: "你好", isThinking: false, isComplete: false },
      ];
      expect(hasTurnReceivedBody(events)).toBe(false);
    });

    it("only checks the latest turn, not older turns", () => {
      // An older turn with body should not satisfy the guard for the current
      // turn that has only an empty placeholder.
      const events: TimelineEvent[] = [
        { id: "user-old", type: "user_message", timestamp: 1, content: "旧问题" },
        { id: "assistant-old", type: "assistant_message", timestamp: 2, content: "旧回复", isThinking: false, isComplete: true },
        { id: "user-new", type: "user_message", timestamp: 3, content: "新问题" },
        { id: "assistant-new", type: "assistant_message", timestamp: 4, content: "", isThinking: false, isComplete: false },
      ];
      expect(hasTurnReceivedBody(events)).toBe(false);
    });
  });
});

describe("repairStableAssistantOrder", () => {
  function assistant(content: string, sid: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
    return { id: `a-${content.slice(0, 6)}`, type: "assistant_message" as const, timestamp: 1,
      content, isThinking: false, isComplete: true, snapshotMessageId: sid, snapshotMessageIdStable: true,
      ...overrides } as TimelineEvent;
  }

  it("reorders out-of-sequence stable events within a turn", () => {
    // Real scenario: summary(sid=f_000010, ts=user+40ms) before preview(sid=f_000008, ts=user+30s).
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message" as const, timestamp: 100, content: "hi" },
      assistant("完整汇总996字符", "87f_000010"),
      { id: "tool-1", type: "tool_call" as const, timestamp: 200, toolCallId: "c1", toolName: "Read", status: "success" as const, arguments: {} },
      assistant("33字符预告", "87f_000008"),
    ];
    const result = repairStableAssistantOrder(events);
    const texts = result.filter((e) => e.type === "assistant_message").map((e) => e.content);
    expect(texts).toEqual(["33字符预告", "完整汇总996字符"]);
  });

  it("idempotent: correctly ordered events are unchanged", () => {
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message" as const, timestamp: 100, content: "hi" },
      assistant("预告33字符", "87f_000008"),
      assistant("完整汇总996字符", "87f_000010"),
    ];
    const result = repairStableAssistantOrder(events);
    const texts = result.filter((e) => e.type === "assistant_message").map((e) => e.content);
    expect(texts).toEqual(["预告33字符", "完整汇总996字符"]);
    expect(result).toBe(events); // same reference when no change
  });

  it("ignores events without stable sid or numeric tail", () => {
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message" as const, timestamp: 100, content: "hi" },
      { id: "a1", type: "assistant_message" as const, timestamp: 200, content: "无sid", isThinking: false, isComplete: true },
      { id: "a2", type: "assistant_message" as const, timestamp: 300, content: "stable无数字", isThinking: false, isComplete: true,
        snapshotMessageIdStable: true, snapshotMessageId: "no_number_suffix" },
    ];
    const result = repairStableAssistantOrder(events);
    expect(result).toBe(events);
  });

  it("handles multiple turns with different prefixes", () => {
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message" as const, timestamp: 100, content: "第一轮" },
      assistant("第一轮汇总", "step1_000010"),
      assistant("第一轮预告", "step1_000008"),
      { id: "user-2", type: "user_message" as const, timestamp: 500, content: "第二轮" },
      assistant("第二轮总结", "step2_000020"),
      assistant("第二轮预览", "step2_000015"),
    ];
    const result = repairStableAssistantOrder(events);
    const texts = result.filter((e) => e.type === "assistant_message").map((e) => e.content);
    expect(texts).toEqual(["第一轮预告", "第一轮汇总", "第二轮预览", "第二轮总结"]);
  });

  it("settles pending questions to answered when session is not waiting for a question", () => {
    const events: TimelineEvent[] = [{
      id: "q1",
      type: "question_request",
      timestamp: 100,
      requestId: "req-1",
      rpcRequestId: "req-1",
      toolCallId: "tool-1",
      questions: [{ id: "qq-1", question: "继续？", options: [] }],
      status: "pending",
    }];
    const result = settleHistoricalQuestions(events, { isWaitingQuestion: false });
    expect(result[0]).toMatchObject({ status: "answered" });
  });

  it("keeps pending questions when the session is currently waiting for a question", () => {
    const events: TimelineEvent[] = [{
      id: "q1",
      type: "question_request",
      timestamp: 100,
      requestId: "req-1",
      rpcRequestId: "req-1",
      toolCallId: "tool-1",
      questions: [{ id: "qq-1", question: "继续？", options: [] }],
      status: "pending",
    }];
    const result = settleHistoricalQuestions(events, { isWaitingQuestion: true });
    expect(result[0]).toMatchObject({ status: "pending" });
  });

  it("returns the same array reference when nothing changes", () => {
    const events: TimelineEvent[] = [{
      id: "u1",
      type: "user_message",
      timestamp: 100,
      content: "hi",
    }];
    expect(settleHistoricalQuestions(events)).toBe(events);
  });

  it("keeps pending questions when the waiting status is unknown (getStatus failed)", () => {
    const events: TimelineEvent[] = [{
      id: "q1",
      type: "question_request",
      timestamp: 100,
      requestId: "req-1",
      rpcRequestId: "req-1",
      toolCallId: "tool-1",
      questions: [{ id: "qq-1", question: "继续？", options: [] }],
      status: "pending",
    }];
    const result = settleHistoricalQuestions(events, { isWaitingQuestion: undefined });
    expect(result[0]).toMatchObject({ status: "pending" });
  });
});
describe("normalizeCompactionDisplay", () => {
  const compaction = (
    id: string,
    phase: "begin" | "end",
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    type: "compaction",
    timestamp: 1,
    phase,
    ...extra,
  }) as TimelineEvent;
  const status = (id: string) => ({
    id,
    type: "status_update",
    timestamp: 1,
    message: "状态",
  }) as TimelineEvent;

  it("keeps only the summary end for a nested duplicate compaction cluster (b,b,b,e,e)", () => {
    // 实机回归（图2）：一次压缩从多个通道各发一对 begin/end，时间线堆出
    // 「耗时较长」x2 + 无摘要「压缩完成」+ 摘要行；旧折叠只删下一条恰好是
    // end 的 begin，嵌套序列漏掉中间 begin。归一后只留带摘要的 end。
    const events = [
      compaction("b1", "begin"),
      compaction("b2", "begin"),
      compaction("b3", "begin"),
      compaction("e1", "end"),
      compaction("e2", "end", { summary: "摘要正文" }),
    ];
    expect(normalizeCompactionDisplay(events)).toEqual([
      compaction("e2", "end", { summary: "摘要正文" }),
    ]);
  });

  it("keeps only the latest begin while compaction is still running", () => {
    // 实机回归（图1）：两个「压缩中」气泡同时存在，归一后只剩一个。
    const events = [compaction("b1", "begin"), compaction("b2", "begin")];
    expect(normalizeCompactionDisplay(events)).toEqual([compaction("b2", "begin")]);
  });

  it("keeps the single end of a simple begin/end pair", () => {
    const events = [compaction("b", "begin"), compaction("e", "end", { summary: "摘要" })];
    expect(normalizeCompactionDisplay(events)).toEqual([
      compaction("e", "end", { summary: "摘要" }),
    ]);
  });

  it("keeps a new unmatched begin that starts after a completed cluster", () => {
    const events = [
      compaction("b1", "begin"),
      compaction("e1", "end", { summary: "摘要" }),
      compaction("b2", "begin"),
    ];
    expect(normalizeCompactionDisplay(events)).toEqual([
      compaction("e1", "end", { summary: "摘要" }),
      compaction("b2", "begin"),
    ]);
  });

  it("normalizes separated clusters independently and leaves other events untouched", () => {
    const events = [
      compaction("b1", "begin"),
      compaction("e1", "end"),
      status("s1"),
      compaction("b2", "begin"),
      compaction("b3", "begin"),
    ];
    expect(normalizeCompactionDisplay(events)).toEqual([
      compaction("e1", "end"),
      status("s1"),
      compaction("b3", "begin"),
    ]);
  });
});
