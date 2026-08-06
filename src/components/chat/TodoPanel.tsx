import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { TimelineEvent, TodoItem } from "@/types/ui";

function isTodoStatus(value: unknown): value is TodoItem["status"] {
  return value === "pending" || value === "in_progress" || value === "done";
}

function isTodoToolName(toolName: string) {
  return /todo/i.test(toolName);
}

function isEmptyTodoResult(result: unknown) {
  if (typeof result === "string") {
    const lower = result.toLowerCase();
    if (/todo\s+list\s+is\s+empty|todos?\s*(?:are|is)?\s*empty|空|cleared|clear\s*(?:ed|success)|已清|没有待办|无待办/.test(lower)) return true;
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) return parsed.length === 0;
      if (parsed && typeof parsed === "object") {
        return (
          (Array.isArray(parsed.todos) && parsed.todos.length === 0) ||
          (Array.isArray(parsed.items) && parsed.items.length === 0)
        );
      }
    } catch {
      // ignore parse errors
    }
    return false;
  }
  if (Array.isArray(result)) return result.length === 0;
  if (!result || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  return (
    (Array.isArray(record.todos) && record.todos.length === 0) ||
    (Array.isArray(record.items) && record.items.length === 0)
  );
}

function extractTodoItemsFromTool(event: Extract<TimelineEvent, { type: "tool_call" }>): TodoItem[] | null {
  if (!isTodoToolName(event.toolName)) return null;
  const hasTodoArgs = Array.isArray(event.arguments.todos) || Array.isArray(event.arguments.items);
  if (!hasTodoArgs) return null;
  const rawItems: unknown[] = Array.isArray(event.arguments.todos)
    ? event.arguments.todos
    : Array.isArray(event.arguments.items) ? event.arguments.items : [];

  return rawItems.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string"
      ? record.title
      : typeof record.content === "string"
        ? record.content
        : "";
    if (!title.trim()) return [];
    return [{
      id: typeof record.id === "string" ? record.id : `todo-${index}`,
      content: title,
      status: isTodoStatus(record.status) ? record.status : "pending",
    }];
  });
}

export function getLatestTodos(events: TimelineEvent[]): TodoItem[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "todo") return event.items;
    if (event.type === "tool_call" && isTodoToolName(event.toolName) && event.status === "success") {
      const items = extractTodoItemsFromTool(event);
      if (items !== null) return items;
      if (isEmptyTodoResult(event.result)) return [];
    }
  }
  return [];
}

export function getVisibleTodos(events: TimelineEvent[]): TodoItem[] {
  const items = getLatestTodos(events);
  return items.some((item) => item.status !== "done") ? items : [];
}

export function todoCounts(items: TodoItem[]) {
  return {
    doneCount: items.filter((item) => item.status === "done").length,
    activeCount: items.filter((item) => item.status === "in_progress").length,
  };
}

/** 待办列表体：输入区 dock 胶囊展开面板复用（原 TodoPanel 卡片外壳已并入 ComposerDockBar）。 */
export function TodoListItems({ items }: { items: TodoItem[] }) {
  return (
    <div className="flex flex-col" style={{ gap: 2 }}>
      {items.map((item) => (
        <div
          key={item.id}
          className="flex min-h-[38px] min-w-0 items-center text-[14px] leading-6 text-text-primary"
          style={{ gap: 12, paddingLeft: 14, paddingRight: 14 }}
        >
          {item.status === "done" ? (
            <CheckCircle2 size={16} className="shrink-0 text-accent-success" />
          ) : item.status === "in_progress" ? (
            <Loader2 size={16} className="shrink-0 animate-spin text-accent-warning" />
          ) : (
            <Circle size={16} className="shrink-0 text-text-muted" />
          )}
          <span className={`min-w-0 flex-1 truncate ${item.status === "done" ? "text-text-muted line-through" : ""}`}>
            {item.content}
          </span>
        </div>
      ))}
    </div>
  );
}
