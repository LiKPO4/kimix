import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, ClipboardList, Loader2, X } from "lucide-react";
import type { TimelineEvent, TodoItem } from "@/types/ui";

interface TodoPanelProps {
  events: TimelineEvent[];
  onDismiss?: () => void;
}

function isTodoStatus(value: unknown): value is TodoItem["status"] {
  return value === "pending" || value === "in_progress" || value === "done";
}

function isTodoToolName(toolName: string) {
  return /todo/i.test(toolName);
}

function isEmptyTodoResult(result: unknown) {
  if (typeof result === "string") return /todo\s+list\s+is\s+empty|todos?\s*(?:are|is)?\s*empty|空/.test(result.toLowerCase());
  if (Array.isArray(result)) return result.length === 0;
  if (!result || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  return (
    (Array.isArray(record.todos) && record.todos.length === 0) ||
    (Array.isArray(record.items) && record.items.length === 0)
  );
}

function todoItemsFromTool(event: Extract<TimelineEvent, { type: "tool_call" }>): TodoItem[] {
  if (!isTodoToolName(event.toolName)) return [];
  const rawItems = Array.isArray(event.arguments.todos)
    ? event.arguments.todos
    : Array.isArray(event.arguments.items)
      ? event.arguments.items
      : [];

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
    if (event.type === "tool_call") {
      const items = todoItemsFromTool(event);
      if (items.length > 0) return items;
      if (isTodoToolName(event.toolName) && event.status === "success" && isEmptyTodoResult(event.result)) return [];
    }
  }
  return [];
}

export function getVisibleTodos(events: TimelineEvent[]): TodoItem[] {
  const items = getLatestTodos(events);
  return items.some((item) => item.status !== "done") ? items : [];
}

export function TodoPanel({ events, onDismiss }: TodoPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const items = useMemo(() => getVisibleTodos(events), [events]);
  if (items.length === 0) return null;

  const doneCount = items.filter((item) => item.status === "done").length;
  const activeCount = items.filter((item) => item.status === "in_progress").length;

  return (
    <div
      className="overflow-hidden rounded-[16px] border border-border-subtle bg-surface-elevated text-[14.5px] shadow-hover-token"
      style={{ marginBottom: 14 }}
    >
      <div className={`flex h-11 items-center border-border-subtle text-text-secondary ${collapsed ? "" : "border-b"}`} style={{ paddingLeft: 24, paddingRight: 12 }}>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="no-focus-outline flex h-full min-w-0 flex-1 items-center text-left transition-colors hover:text-text-primary focus:outline-none focus-visible:outline-none"
          style={{ gap: 11, paddingRight: 10 }}
        >
          {collapsed ? <ChevronRight size={17} className="shrink-0" /> : <ChevronDown size={17} className="shrink-0" />}
          <ClipboardList size={17} className="shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1 truncate">TodoList</span>
          {activeCount > 0 && <span className="shrink-0 text-text-muted">{activeCount} 项进行中</span>}
          <span className="shrink-0 text-text-muted">{doneCount}/{items.length}</span>
        </button>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="kimix-muted-action flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            title="收起到侧栏"
            aria-label="收起 TodoList"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="max-h-44 overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex min-h-[42px] min-w-0 items-center border-b border-border-subtle text-[14.5px] leading-6 text-text-primary last:border-b-0"
              style={{ gap: 12, paddingLeft: 26, paddingRight: 26 }}
            >
              {item.status === "done" ? (
                <CheckCircle2 size={17} className="shrink-0 text-accent-success" />
              ) : item.status === "in_progress" ? (
                <Loader2 size={17} className="shrink-0 animate-spin text-accent-warning" />
              ) : (
                <Circle size={17} className="shrink-0 text-text-muted" />
              )}
              <span className={`min-w-0 flex-1 truncate ${item.status === "done" ? "text-text-muted line-through" : ""}`}>
                {item.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
