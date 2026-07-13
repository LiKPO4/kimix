import { describe, expect, it } from "vitest";
import { sessionToMarkdown } from "../markdownExport";
import type { Session } from "@/types/ui";
import { createCollaborationStateFromSession } from "../collaborationRooms";

describe("sessionToMarkdown", () => {
  it("restores paragraphs for flattened assistant progress summaries", () => {
    const session: Session = {
      id: "s1",
      title: "导出测试",
      projectPath: "D:/project",
      createdAt: 1,
      updatedAt: 2,
      isLoading: false,
      events: [
        {
          id: "a1",
          type: "assistant_message",
          timestamp: 1,
          content: "本轮开始执行 P0/P1 修复 + 云端发布。先读取关键文件确认当前代码状态，然后按优先级批次修复。现在开始并行修复批次1的安全类P0问题：批次2完成。现在运行 flutter analyze 检查当前代码状态，同时继续修复关键P1问题：flutter analyze 通过！现在进入版本号递增 + 构建阶段。",
          isThinking: false,
          isComplete: true,
        },
      ],
    };

    const markdown = sessionToMarkdown(session);
    expect(markdown).toContain("云端发布。\n\n先读取关键文件");
    expect(markdown).toContain("批次2完成。\n\n现在运行");
  });

  it("restores paragraphs for long flattened narrative without explicit boundary words", () => {
    const session: Session = {
      id: "s2",
      title: "叙事段落测试",
      projectPath: "D:/project",
      createdAt: 1,
      updatedAt: 2,
      isLoading: false,
      events: [
        {
          id: "a2",
          type: "assistant_message",
          timestamp: 1,
          content: "好的，我先全面审查所有新代码，然后走 TapTap 流程。先让我检查完整数据和测试。发现一个问题——龙象劲的日志不够准确，升级版说\"耗尽\"不对。测试失败是因为新加了 5 枚骰子，图鉴滚动页数不够了。增大滚动次数。问题找到了——'百花剑·全谱'被找到但在 y=618，比屏幕 600px 矮一点。加大滚动距离。",
          isThinking: false,
          isComplete: true,
        },
      ],
    };

    const markdown = sessionToMarkdown(session);
    expect(markdown).toContain("流程。\n\n先让我检查");
    expect(markdown).toContain("不对。\n\n测试失败");
    expect(markdown).toContain("不够了。\n\n增大滚动");
  });

  it("repairs markdown table separators split across streamed lines", () => {
    const session: Session = {
      id: "s1",
      title: "表格测试",
      projectPath: "D:/project",
      createdAt: 1,
      updatedAt: 2,
      isLoading: false,
      events: [
        {
          id: "a1",
          type: "assistant_message",
          timestamp: 1,
          content: [
            "### 方案 A（推荐）：倍速播放 + 定时关闭",
            "",
            "| 功能 | 实现方式 | 价值 |",
            "|------",
            "",
            "|---------|------|",
            "| **倍速播放** | JS bridge 控制 `video.playbackRate` | 高频刚需 |",
          ].join("\n"),
          isThinking: false,
          isComplete: true,
        },
      ],
    };

    const markdown = sessionToMarkdown(session);
    expect(markdown).toContain("|------|---------|------|");
    expect(markdown).not.toContain("|------\n\n|---------|------|");
  });

  it("repairs markdown table separators split into several streamed fragments", () => {
    const session: Session = {
      id: "s1",
      title: "表格测试",
      projectPath: "D:/project",
      createdAt: 1,
      updatedAt: 2,
      isLoading: false,
      events: [
        {
          id: "a1",
          type: "assistant_message",
          timestamp: 1,
          content: [
            "| 文件路径:行号 | 调用类型 | 所在类/函数 | 备注 |",
            "|---|---",
            "",
            "|---",
            "",
            "|---|",
            "| lib/main_editor.dart:108 | Navigator.push | build | PageRoute 全屏页面跳转 |",
          ].join("\n"),
          isThinking: false,
          isComplete: true,
        },
      ],
    };

    const markdown = sessionToMarkdown(session);
    expect(markdown).toContain("|---|---|---|---|");
    expect(markdown).not.toContain("|---|---\n\n|---");
  });

  it("repairs markdown table rows split across streamed lines", () => {
    const session: Session = {
      id: "s1",
      title: "表格测试",
      projectPath: "D:/project",
      createdAt: 1,
      updatedAt: 2,
      isLoading: false,
      events: [
        {
          id: "a1",
          type: "assistant_message",
          timestamp: 1,
          content: [
            "| 文件路径:行号 | 调用类型 | 所在类/函数 | 备注 |",
            "|---|---|---|---|",
            "| lib",
            "",
            "/features/run/p",
            "",
            "resentation/run_page.dart:410 |",
            "",
            " Navigator.pushNamed | _TutorialCoachCopy.setState | PageRoute 全屏页面跳转 |",
          ].join("\n"),
          isThinking: false,
          isComplete: true,
        },
      ],
    };

    const markdown = sessionToMarkdown(session);
    expect(markdown).toContain("| lib/features/run/presentation/run_page.dart:410 | Navigator.pushNamed | _TutorialCoachCopy.setState | PageRoute 全屏页面跳转 |");
    expect(markdown).not.toContain("| lib\n\n/features/run/p");
  });

  it("exports a collaboration room with recipients and Agent model ownership", () => {
    const base: Session = {
      id: "room-1",
      title: "交叉审查",
      projectPath: "D:/project",
      createdAt: 1,
      updatedAt: 5,
      isLoading: false,
      events: [],
      model: "kimi-code/k2.5",
    };
    const collaboration = createCollaborationStateFromSession(base);
    const primaryId = collaboration.primaryAgentId;
    const reviewerId = "agent-reviewer";
    const room: Session = {
      ...base,
      collaboration: {
        ...collaboration,
        agents: [
          { ...collaboration.agents[0], displayName: "Implementer", modelLabelSnapshot: "K2.5", providerLabelSnapshot: "Kimi" },
          {
            id: reviewerId,
            displayName: "Reviewer",
            mentionName: "reviewer",
            modelAlias: "openai/gpt-5",
            modelLabelSnapshot: "GPT-5",
            providerLabelSnapshot: "OpenAI",
            permissionMode: "manual",
            createdAt: 2,
          },
        ],
        messages: [{
          id: "message-1",
          content: "请分别实施和审查",
          timestamp: 3,
          recipientAgentIds: [primaryId, reviewerId],
          deliveries: {
            [primaryId]: { status: "completed", agentTurnId: "turn-primary" },
            [reviewerId]: { status: "completed", agentTurnId: "turn-reviewer" },
          },
        }],
        agentEvents: {
          [primaryId]: [{
            id: "assistant-primary",
            type: "assistant_message",
            timestamp: 4,
            content: "实施完成",
            isThinking: false,
            isComplete: true,
            roomAgentId: primaryId,
            roomMessageId: "message-1",
            agentTurnId: "turn-primary",
          }],
          [reviewerId]: [{
            id: "assistant-reviewer",
            type: "assistant_message",
            timestamp: 5,
            content: "审查通过",
            isThinking: false,
            isComplete: true,
            roomAgentId: reviewerId,
            roomMessageId: "message-1",
            agentTurnId: "turn-reviewer",
          }],
        },
      },
    };

    const markdown = sessionToMarkdown(room);
    expect(markdown).toContain("| Implementer | @k2.5 | Kimi | K2.5 | 活跃 |");
    expect(markdown).toContain("| Reviewer | @reviewer | OpenAI | GPT-5 | 活跃 |");
    expect(markdown).toContain("## 用户 → Implementer、Reviewer");
    expect(markdown).toContain("## Implementer · K2.5\n\n实施完成");
    expect(markdown).toContain("## Reviewer · GPT-5\n\n审查通过");
    expect(markdown.indexOf("实施完成")).toBeLessThan(markdown.indexOf("审查通过"));
  });
});
