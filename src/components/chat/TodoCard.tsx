import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { TimelineEvent } from "@/types/ui";

interface TodoCardProps {
  event: Extract<TimelineEvent, { type: "todo" }>;
}

export function TodoCard({ event }: TodoCardProps) {
  const doneCount = event.items.filter((i) => i.status === "done").length;
  const total = event.items.length;

  return (
    <div className="flex justify-start">
      <div className="w-full overflow-hidden rounded-[16px] border border-[#e1dcd3] bg-[#fbfaf7] text-[14.5px] shadow-[0_1px_2px_rgba(25,23,20,0.04)]">
        <div className="flex items-center justify-between border-b border-[#eeeae3] text-[#7c756c]" style={{ paddingLeft: 24, paddingRight: 26, paddingTop: 12, paddingBottom: 12 }}>
          <span className="font-medium">任务列表</span>
          <span>{doneCount}/{total}</span>
        </div>
        <div>
          {event.items.map((item) => (
            <div key={item.id} className="flex min-w-0 items-center border-b border-[#f0ede7] text-[#5e5850] last:border-b-0" style={{ gap: 12, paddingLeft: 26, paddingRight: 26, paddingTop: 9, paddingBottom: 9 }}>
              {item.status === "done" ? (
                <CheckCircle2 size={16} className="text-accent-green shrink-0" />
              ) : item.status === "in_progress" ? (
                <Loader2 size={16} className="text-accent-yellow shrink-0 animate-spin" />
              ) : (
                <Circle size={16} className="text-text-muted shrink-0" />
              )}
              <span className={`min-w-0 flex-1 truncate ${item.status === "done" ? "line-through text-[#8f887e]" : ""}`}>{item.content}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
