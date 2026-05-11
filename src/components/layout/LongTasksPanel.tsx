import { CalendarClock, Clock, Play, Settings2, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";

const futureItems = [
  { icon: Play, title: "后台执行", desc: "让长程任务在独立会话中持续运行，并把阶段结果回写当前项目。" },
  { icon: CalendarClock, title: "定时检查", desc: "按小时、每天或每周触发项目检查、构建、巡检和报告。" },
  { icon: Settings2, title: "任务模板", desc: "保存常用提示词、工作目录、权限模式和完成后的通知策略。" },
];

export function LongTasksPanel() {
  const open = useAppStore((s) => s.longTasksOpen);
  const setOpen = useAppStore((s) => s.setLongTasksOpen);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="long-tasks-title"
    >
      <div className="w-full max-w-[560px] rounded-[18px] border border-[#dedad2] bg-white shadow-[0_28px_90px_rgba(25,23,20,0.22)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#ebe7df]" style={{ padding: "18px 22px" }}>
          <div className="flex min-w-0 items-center gap-2.5">
            <Clock size={18} className="shrink-0 text-[#8f887e]" />
            <h2 id="long-tasks-title" className="text-[18px] font-semibold leading-6 text-[#24211d]">长程任务</h2>
          </div>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8f887e] hover:bg-[#f1eee8] hover:text-[#24211d]" onClick={() => setOpen(false)} aria-label="关闭长程任务">
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 24 }}>
          <div className="rounded-xl border border-[#e7e2d8] bg-[#fbfaf7] text-[14.5px] leading-6 text-[#625d55]" style={{ padding: "14px 16px" }}>
            这里会用于配置长程任务执行方式。当前先作为入口占位，后续会接入后台运行、定时触发、任务模板和结果通知。
          </div>
          <div className="mt-5 flex flex-col" style={{ gap: 14 }}>
            {futureItems.map((item) => (
              <div key={item.title} className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-start rounded-xl border border-[#e7e2d8] bg-white" style={{ columnGap: 14, rowGap: 8, padding: "16px 18px" }}>
                <item.icon size={18} className="mt-0.5 shrink-0 text-[#8f887e]" />
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-medium leading-5 text-[#302d28]">{item.title}</div>
                  <div className="mt-1 text-[13px] leading-5 text-[#7c756c]">{item.desc}</div>
                </div>
                <span className="shrink-0 self-center rounded-full bg-[#f1eee8] text-[12px] leading-5 text-[#9a948b]" style={{ padding: "4px 10px" }}>
                  待实现
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
