import { useEffect, useRef, useState } from "react";
import { BarChart3, ChevronDown, Download, FolderOpen, GitBranch, Loader2 } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { KimiUsageResponse, UsagePeriod } from "../../../electron/types/ipc";

type UsageData = Extract<KimiUsageResponse, { success: true }>["data"];

function formatUsage(period: UsagePeriod) {
  if (!period.available || period.used === undefined || period.limit === undefined) {
    return period.message ?? "暂无官方数据";
  }
  const remaining = Math.max(0, period.limit - period.used);
  return `已用 ${period.used}/${period.limit}，剩余 ${remaining}`;
}

function UsageProgress({ period }: { period: UsagePeriod }) {
  const percent = Math.max(0, Math.min(100, period.percent ?? 0));
  return (
    <div style={{ paddingTop: 2, paddingBottom: 3 }}>
      <div className="flex items-center justify-between gap-5 text-[14px] leading-5">
        <span className="font-medium text-[#5f5a52]">{period.label}</span>
        <span className="shrink-0 text-[#9a948b]">{period.available ? `已用 ${percent.toFixed(0)}%` : "0%"}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#ece8df]">
        <div
          className="h-full rounded-full bg-[#8f887d]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 text-[13px] leading-5 text-[#aaa49a]">{formatUsage(period)}</div>
    </div>
  );
}

function showPendingToast() {
  window.dispatchEvent(new CustomEvent("kimix:toast", { detail: "待实现" }));
}

export function ContextBar() {
  const project = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === currentSession?.id));
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const usageMenuRef = useRef<HTMLDivElement>(null);

  const handleExport = () => {
    if (!session) return;
    let md = `# ${session.title}\n\n`;
    for (const ev of session.events) {
      if (ev.type === "user_message") {
        md += `## User\n\n${ev.content}\n\n`;
      } else if (ev.type === "assistant_message") {
        md += `## Assistant\n\n${ev.content}\n\n`;
        if (ev.thinking) {
          md += `> **Thinking**\n> ${ev.thinking.replace(/\n/g, "\n> ")}\n\n`;
        }
      } else if (ev.type === "tool_call") {
        md += `> **Tool**: ${ev.toolName}\n\n`;
      } else if (ev.type === "error") {
        md += `> **Error**: ${ev.message}\n\n`;
      }
    }
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const loadUsage = async () => {
    setUsageLoading(true);
    try {
      const res = await window.api.getKimiUsage();
      if (res.success) {
        setUsageData(res.data);
      } else {
        setUsageData({
          available: false,
          updatedAt: Date.now(),
          source: "Kimi Code 官方用量接口",
          message: res.error,
          periods: [
            { label: "5小时", available: false, percent: 0, message: "获取失败" },
            { label: "本周", available: false, percent: 0, message: "获取失败" },
            { label: "本月", available: false, percent: 0, message: "获取失败" },
          ],
        });
      }
    } catch (err) {
      setUsageData({
        available: false,
        updatedAt: Date.now(),
        source: "Kimi Code 官方用量接口",
        message: err instanceof Error ? err.message : "获取失败",
        periods: [
          { label: "5小时", available: false, percent: 0, message: "获取失败" },
          { label: "本周", available: false, percent: 0, message: "获取失败" },
          { label: "本月", available: false, percent: 0, message: "获取失败" },
        ],
      });
    } finally {
      setUsageLoading(false);
    }
  };

  const toggleUsage = () => {
    const next = !usageOpen;
    setUsageOpen(next);
    if (next && !usageData) {
      void loadUsage();
    }
  };

  useEffect(() => {
    setGitBranch(null);
    if (!project?.path) return;
    let cancelled = false;
    window.api.getGitInfo(project.path).then((res) => {
      if (cancelled) return;
      setGitBranch(res.success && res.data.branch ? res.data.branch : null);
    }).catch(() => {
      if (!cancelled) setGitBranch(null);
    });
    return () => {
      cancelled = true;
    };
  }, [project?.path, project?.gitBranch]);

  useEffect(() => {
    if (!usageOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!usageMenuRef.current?.contains(event.target as Node)) {
        setUsageOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [usageOpen]);

  return (
    <div className="flex h-[34px] w-full items-center justify-between gap-3 px-1 text-[14px] leading-none text-[#7c756c]">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          onClick={showPendingToast}
          className="flex min-h-8 min-w-0 items-center rounded-lg text-[#7c756c] transition-colors hover:bg-[#f1eee8] hover:text-[#3a362f]"
          style={{ gap: 8, paddingLeft: 12, paddingRight: 12 }}
          title={project?.path ?? "当前项目"}
          aria-label={project?.name ? `当前项目：${project.name}` : "当前项目"}
        >
          <FolderOpen size={16} className="shrink-0" />
          <span className="max-w-[220px] truncate">{project?.name ?? "未选择项目"}</span>
        </button>
        <div ref={usageMenuRef} className="relative hidden min-w-0 sm:block">
          <button
            type="button"
            onClick={toggleUsage}
            className="kimix-icon-text-button is-compact min-w-0 hover:bg-[#f1eee8] hover:text-[#3a362f]"
            title="套餐用量"
            aria-label="套餐用量"
          >
            <BarChart3 size={16} className="shrink-0" />
            <span className="truncate">套餐用量</span>
            <ChevronDown size={14} className="shrink-0 text-[#aaa49a]" />
          </button>
          {usageOpen && (
            <div
              className="absolute bottom-10 left-0 z-40 w-[330px] rounded-xl border border-[#ded9cf] bg-white shadow-[0_16px_36px_rgba(38,34,28,0.14)]"
              style={{ paddingLeft: 22, paddingRight: 22, paddingTop: 20, paddingBottom: 21 }}
            >
              <div className="flex items-start justify-between gap-4" style={{ marginBottom: 18 }}>
                <div className="min-w-0">
                  <div className="text-[16px] font-medium leading-5 text-[#3a362f]">套餐用量</div>
                  <div className="mt-1.5 text-[13px] leading-5 text-[#aaa49a]">{usageData?.source ?? "Kimi Code 官方用量接口"}</div>
                </div>
                <button
                  type="button"
                  onClick={loadUsage}
                  className="kimix-icon-text-button is-compact shrink-0 text-[#7c756c] hover:bg-[#f1eee8] hover:text-[#3a362f]"
                >
                  {usageLoading ? <Loader2 size={14} className="animate-spin" /> : "刷新"}
                </button>
              </div>
              <div className="flex flex-col" style={{ gap: 15 }}>
                {(usageData?.periods ?? [
                  { label: "5小时", available: false, percent: 0, message: "正在获取" },
                  { label: "本周", available: false, percent: 0, message: "正在获取" },
                  { label: "本月", available: false, percent: 0, message: "正在获取" },
                ]).map((period) => (
                  <UsageProgress key={period.label} period={period} />
                ))}
              </div>
              {usageData?.message && (
                <div className="mt-3 rounded-lg bg-[#f6f4ef] text-[12.5px] leading-relaxed text-[#8a847a]" style={{ padding: 10 }}>
                  {usageData.message}
                </div>
              )}
            </div>
          )}
        </div>
        {gitBranch && (
          <button
            type="button"
            onClick={showPendingToast}
            className="hidden min-h-8 min-w-0 items-center rounded-lg text-[#7c756c] transition-colors hover:bg-[#f1eee8] hover:text-[#3a362f] md:flex"
            style={{ gap: 8, paddingLeft: 12, paddingRight: 12 }}
            title={gitBranch}
            aria-label={`当前分支：${gitBranch}`}
          >
            <GitBranch size={16} className="shrink-0" />
            <span className="max-w-[150px] truncate">{gitBranch}</span>
          </button>
        )}
      </div>

      {session && (
        <button
          onClick={handleExport}
          className="kimix-icon-text-button is-compact shrink-0 hover:bg-[#f1eee8] hover:text-[#3a362f]"
          title="导出聊天记录"
          aria-label="导出聊天记录"
        >
          <Download size={16} />
          <span>导出</span>
        </button>
      )}
    </div>
  );
}
