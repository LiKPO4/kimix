import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import { formatFullToolArgumentsForDisplay, formatToolArgumentsForDisplay, toolArgumentPreview } from "../toolDisplay";

describe("toolDisplay", () => {
  it("summarizes large Write content instead of rendering the full body", () => {
    const content = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join("\n");
    const event: Extract<TimelineEvent, { type: "tool_call" }> = {
      id: "tool-1",
      type: "tool_call",
      timestamp: 1,
      toolCallId: "call-1",
      toolName: "Write",
      status: "running",
      arguments: {
        path: "D:/WORKS/Android Project/Project04/AGENTS.md",
        content,
      },
      rawArguments: JSON.stringify({
        path: "D:/WORKS/Android Project/Project04/AGENTS.md",
        content,
      }),
    };

    const detail = formatToolArgumentsForDisplay(event);
    expect(detail).toContain("D:/WORKS/Android Project/Project04/AGENTS.md");
    expect(detail).toContain("文本");
    expect(detail).toContain("120 行");
    expect(detail).toContain("已省略");
    expect(detail.length).toBeLessThan(1200);
    expect(formatFullToolArgumentsForDisplay(event)).toContain("line 120");
  });

  it("uses structured arguments for preview instead of duplicated raw json", () => {
    const event: Extract<TimelineEvent, { type: "tool_call" }> = {
      id: "tool-1",
      type: "tool_call",
      timestamp: 1,
      toolCallId: "call-1",
      toolName: "Write",
      status: "running",
      arguments: {
        path: "plans/next.md",
        content: "hello",
      },
      rawArguments: '{"path":"plans/next.md","content":"hello"}{"path":"plans/next.md","content":"hello"}',
    };

    expect(toolArgumentPreview(event)).toBe("plans/next.md");
    expect(formatToolArgumentsForDisplay(event)).not.toContain('"}{"path"');
  });
});
