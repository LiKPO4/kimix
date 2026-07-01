import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import { getVisibleTodos } from "../TodoPanel";

describe("getVisibleTodos", () => {
  it("clears older todos when the latest todo event is empty", () => {
    const events: TimelineEvent[] = [
      { id: "todo-1", type: "todo", timestamp: 1, items: [{ id: "1", content: "旧任务", status: "in_progress" }] },
      { id: "todo-2", type: "todo", timestamp: 2, items: [] },
    ];

    expect(getVisibleTodos(events)).toEqual([]);
  });

  it("clears older todos after a successful empty TodoList query", () => {
    const events: TimelineEvent[] = [
      { id: "todo-1", type: "todo", timestamp: 1, items: [{ id: "1", content: "旧任务", status: "in_progress" }] },
      {
        id: "tool-1",
        type: "tool_call",
        timestamp: 2,
        toolCallId: "tool-1",
        toolName: "TodoList",
        status: "success",
        arguments: {},
        result: "Todo list is empty.",
      },
    ];

    expect(getVisibleTodos(events)).toEqual([]);
  });

  it("clears older todos when the latest todo tool returns an empty list", () => {
    const events: TimelineEvent[] = [
      { id: "todo-1", type: "todo", timestamp: 1, items: [{ id: "1", content: "旧任务", status: "in_progress" }] },
      {
        id: "tool-1",
        type: "tool_call",
        timestamp: 2,
        toolCallId: "tool-1",
        toolName: "todo",
        status: "success",
        arguments: { todos: [] },
        result: "ok",
      },
    ];

    expect(getVisibleTodos(events)).toEqual([]);
  });

  it("clears older todos when the latest todo tool reports cleared in Chinese", () => {
    const events: TimelineEvent[] = [
      { id: "todo-1", type: "todo", timestamp: 1, items: [{ id: "1", content: "旧任务", status: "in_progress" }] },
      {
        id: "tool-1",
        type: "tool_call",
        timestamp: 2,
        toolCallId: "tool-1",
        toolName: "todo",
        status: "success",
        arguments: { action: "clear" },
        result: "已清空待办事项",
      },
    ];

    expect(getVisibleTodos(events)).toEqual([]);
  });
});
