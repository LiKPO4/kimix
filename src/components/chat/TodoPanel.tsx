import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, ClipboardList, Loader2 } from "lucide-react";
import type { TimelineEvent, TodoItem } from "@/types/ui";

interface TodoPanelProps {
  events: TimelineEvent[];
}

function isTodoStatus(value: unknown): value is TodoItem["status"] {
  return value === "pending" || value === "in_progress" || value === "done";
}

function todoItemsFromTool(event: Extract<TimelineEvent, { type: "tool_call" }>): TodoItem[] {
  if (!/todo/i.test(event.toolName)) return [];
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

function getLatestTodos(events: TimelineEvent[]): TodoItem[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "todo" && event.items.length > 0) return event.items;
    if (event.type === "tool_call") {
      const items = todoItemsFromTool(event);
      if (items.length > 0) return items;
    }
  }
  return [];
}

export function TodoPanel({ events }: TodoPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const items = useMemo(() => getLatestTodos(events), [events]);
  if (items.length === 0) return null;

  const doneCount = items.filter((item) => item.status === "done").length;
  const activeCount = items.filter((item) => item.status === "in_progress").length;

  return (
    <div
      className="overflow-hidden rounded-[16px] border border-[#e1dcd3] bg-white/95 text-[14.5px] shadow-[0_3px_12px_rgba(25,23,20,0.05)]"
      style={{ marginBottom: 8 }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className={`no-focus-outline flex h-11 w-full items-center border-[#eeeae3] text-left text-[#7c756c] transition-colors hover:bg-[#faf8f4] focus:outline-none focus-visible:outline-none ${collapsed ? "" : "border-b"}`}
        style={{ gap: 11, paddingLeft: 24, paddingRight: 26 }}
      >
        {collapsed ? <ChevronRight size={17} className="shrink-0" /> : <ChevronDown size={17} className="shrink-0" />}
        <ClipboardList size={17} className="shrink-0 text-[#8f887e]" />
        <span className="min-w-0 flex-1 truncate">TodoList</span>
        {activeCount > 0 && <span className="shrink-0 text-[#8f887e]">{activeCount} 项进行中</span>}
        <span className="shrink-0 text-[#8f887e]">{doneCount}/{items.length}</span>
      </button>
      {!collapsed && (
        <div className="max-h-44 overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex min-h-[42px] min-w-0 items-center border-b border-[#f0ede7] text-[14.5px] leading-6 text-[#5e5850] last:border-b-0"
              style={{ gap: 12, paddingLeft: 26, paddingRight: 26 }}
            >
              {item.status === "done" ? (
                <CheckCircle2 size={17} className="shrink-0 text-[#2f8f46]" />
              ) : item.status === "in_progress" ? (
                <Loader2 size={17} className="shrink-0 animate-spin text-[#b7791f]" />
              ) : (
                <Circle size={17} className="shrink-0 text-[#aaa49a]" />
              )}
              <span className={`min-w-0 flex-1 truncate ${item.status === "done" ? "text-[#8f887e] line-through" : ""}`}>
                {item.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
