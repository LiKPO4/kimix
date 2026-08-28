import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, Bot, CheckCircle2, Loader2, RadioTower, RefreshCw, Trash2 } from "lucide-react";
import { normalizeTowerSnapshot, towerStatusLabel, type TowerSnapshotView } from "@/utils/tower";

type TowerInspectorProps = {
  open: boolean;
  runtimeSessionId?: string | null;
  workDir?: string | null;
  towerMode: boolean;
  onSnapshotChange?: (snapshot: TowerSnapshotView | null) => void;
  showToast: (message: string) => void;
};

type TowerTab = "missions" | "agents" | "activity";

function missionTone(status: string, blocked: boolean) {
  if (blocked || /blocked|failed/i.test(status)) return "text-accent-danger";
  if (/merged|complete/i.test(status)) return "text-accent-success";
  if (/running|active|working/i.test(status)) return "text-accent-primary";
  return "text-text-muted";
}

function missionDotClass(status: string, blocked: boolean) {
  if (blocked || /blocked|failed/i.test(status)) return "bg-accent-danger";
  if (/merged|complete/i.test(status)) return "bg-accent-success";
  if (/running|active|working/i.test(status)) return "bg-accent-primary";
  return "bg-[var(--kimix-panel-text-muted)]";
}

export function TowerInspector({ open, runtimeSessionId, workDir, towerMode, onSnapshotChange, showToast }: TowerInspectorProps) {
  const [tab, setTab] = useState<TowerTab>("missions");
  const [snapshot, setSnapshot] = useState<TowerSnapshotView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teardownConfirmOpen, setTeardownConfirmOpen] = useState(false);
  const [teardownBusy, setTeardownBusy] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!runtimeSessionId) {
      setSnapshot(null);
      onSnapshotChange?.(null);
      return;
    }
    if (!silent) setLoading(true);
    const response = await window.api.getKimiCodeTowerSnapshot({ sessionId: runtimeSessionId });
    if (!response.success) {
      if (!silent) setError(response.error);
      setLoading(false);
      return;
    }
    const next = normalizeTowerSnapshot(response.data);
    setSnapshot(next);
    setError(null);
    setLoading(false);
    onSnapshotChange?.(next);
  }, [onSnapshotChange, runtimeSessionId, workDir]);

  useEffect(() => {
    if (!open || (!towerMode && !workDir)) return;
    void refresh();
  }, [open, refresh, towerMode, workDir]);

  useEffect(() => {
    if (!open || (!towerMode && !snapshot?.missions.length && !snapshot?.agents.length)) return;
    const timer = window.setInterval(() => void refresh(true), 2_000);
    return () => window.clearInterval(timer);
  }, [open, refresh, snapshot?.agents.length, snapshot?.missions.length, towerMode]);

  const teardown = async () => {
    if (!runtimeSessionId) {
      showToast("当前 Tower 尚未绑定官方会话，无法清理工作树。");
      return;
    }
    setTeardownBusy(true);
    const response = await window.api.teardownKimiCodeTower({ sessionId: runtimeSessionId });
    setTeardownBusy(false);
    if (!response.success) {
      showToast(`清理 Tower 工作树失败：${response.error}`);
      return;
    }
    setTeardownConfirmOpen(false);
    showToast("已派发 Tower 清理请求；请等待官方事件流完成，分支、审计记录和脏 worktree 会受保护保留。");
    void refresh();
  };

  if (!towerMode && !snapshot?.missions.length && !snapshot?.agents.length && !loading && !error) return null;

  const tabs: Array<{ id: TowerTab; label: string; count?: number }> = [
    { id: "missions", label: "任务", count: snapshot?.missions.length },
    { id: "agents", label: "Agent", count: snapshot?.agents.length },
    { id: "activity", label: "活动", count: snapshot?.activity.length },
  ];

  return (
    <section className="kimix-section-card" style={{ padding: "16px 16px 18px" }} aria-label="Tower 检查器">
      <div className="flex items-start justify-between" style={{ gap: 12 }}>
        <div className="flex min-w-0 items-center" style={{ gap: 9 }}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-primary-light text-accent-primary"><RadioTower size={15} /></span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium leading-5 text-text-primary">Tower</div>
            <div className="truncate text-[12px] leading-5 text-text-muted">{snapshot?.base ?? (towerMode ? "正在读取基础分支..." : "未启用")}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center" style={{ gap: 6 }}>
          <button type="button" disabled={loading} onClick={() => void refresh()} className="kimix-inline-icon-action is-roomy text-text-muted hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-55" aria-label="刷新 Tower 状态" title="刷新">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button type="button" disabled={!towerMode || teardownBusy} onClick={() => setTeardownConfirmOpen(true)} className="kimix-inline-icon-action is-roomy text-text-muted hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-55" aria-label="清理 Tower 工作树" title="清理工作树">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {snapshot && (
        <div className="grid text-[12px] leading-5 text-text-muted" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 12 }}>
          <span className="rounded-lg bg-[var(--kimix-panel-soft-bg)] text-center" style={{ padding: "6px 8px" }}>{snapshot.mergedCount}/{snapshot.totalCount} 合并</span>
          <span className="rounded-lg bg-[var(--kimix-panel-soft-bg)] text-center" style={{ padding: "6px 8px" }}>{snapshot.agents.length} Agent</span>
          <span className={`rounded-lg bg-[var(--kimix-panel-soft-bg)] text-center ${snapshot.blockedCount > 0 ? "text-accent-danger" : ""}`} style={{ padding: "6px 8px" }}>{snapshot.blockedCount} 受阻</span>
        </div>
      )}
      {error && <div className="rounded-lg bg-accent-warning-light text-[12.5px] leading-5 text-accent-warning" style={{ marginTop: 12, padding: "10px 12px" }}>读取 Tower 状态失败：{error}</div>}

      <div className="flex border-b border-border-subtle" style={{ gap: 4, marginTop: 14 }} role="tablist" aria-label="Tower 信息">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`kimix-style-exempt text-[12.5px] leading-5 ${tab === item.id ? "border-b-2 border-accent-primary text-accent-primary" : "text-text-muted hover:text-text-primary"}`} style={{ minHeight: 34, paddingLeft: 10, paddingRight: 10 }}>
            {item.label}{typeof item.count === "number" ? ` ${item.count}` : ""}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 12 }} role="tabpanel">
        {tab === "missions" && (snapshot?.missions.length ? (
          <div className="flex flex-col" style={{ gap: 8 }}>
            {snapshot.missions.map((mission) => (
              <div key={mission.id} className="grid items-start border-b border-border-subtle last:border-b-0" style={{ gridTemplateColumns: "8px minmax(0, 1fr)", gap: 10, padding: "8px 0" }}>
                <span className={`mt-1.5 h-2 w-2 rounded-full ${missionDotClass(mission.status, Boolean(mission.blocker))}`} aria-hidden="true" />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center justify-between" style={{ gap: 10 }}><span className="truncate text-[13px] font-medium leading-5 text-text-primary">{mission.title}</span><span className={`shrink-0 text-[12px] leading-5 ${missionTone(mission.status, Boolean(mission.blocker))}`}>{towerStatusLabel(mission.status)}</span></div>
                  <div className="truncate text-[12px] leading-5 text-text-muted">{mission.id}{mission.branch ? ` · ${mission.branch}` : ""}{mission.owner ? ` · ${mission.owner}` : ""}</div>
                  {(mission.totalTasks ?? 0) > 0 && <div className="text-[12px] leading-5 text-text-muted">{mission.completedTasks ?? 0}/{mission.totalTasks} 个任务</div>}
                  {mission.blocker && <div className="text-[12px] leading-5 text-accent-danger">受阻：{mission.blocker}</div>}
                </div>
              </div>
            ))}
          </div>
        ) : <div className="rounded-lg bg-[var(--kimix-panel-soft-bg)] text-[12.5px] leading-5 text-text-muted" style={{ padding: "12px 14px" }}>当前没有可显示的 Tower 任务。</div>)}
        {tab === "agents" && (snapshot?.agents.length ? (
          <div className="flex flex-col" style={{ gap: 8 }}>
            {snapshot.agents.map((agent) => <div key={agent.id} className="grid items-center border-b border-border-subtle last:border-b-0" style={{ gridTemplateColumns: "auto minmax(0, 1fr) auto", gap: 10, padding: "8px 0" }}><Bot size={14} className="text-text-muted" /><div className="min-w-0"><div className="truncate text-[13px] font-medium leading-5 text-text-primary">{agent.name ?? agent.kind}</div><div className="truncate text-[12px] leading-5 text-text-muted">{agent.kind} · {agent.mission ?? agent.id}{agent.branch ? ` · ${agent.branch}` : ""}</div></div><span className="text-[12px] leading-5 text-text-muted">{agent.status ?? ""}</span></div>)}
          </div>
        ) : <div className="rounded-lg bg-[var(--kimix-panel-soft-bg)] text-[12.5px] leading-5 text-text-muted" style={{ padding: "12px 14px" }}>Tower 派生 Agent 后会显示在这里。</div>)}
        {tab === "activity" && (snapshot?.activity.length ? (
          <div className="flex flex-col" style={{ gap: 8 }}>
            {snapshot.activity.slice(-30).reverse().map((entry) => <div key={entry.id} className="grid border-b border-border-subtle last:border-b-0" style={{ gridTemplateColumns: "auto minmax(0, 1fr)", gap: 9, padding: "8px 0" }}><Activity size={13} className="mt-1 text-text-muted" /><div className="min-w-0 text-[12.5px] leading-5 text-text-secondary">{entry.message}</div></div>)}
          </div>
        ) : <div className="rounded-lg bg-[var(--kimix-panel-soft-bg)] text-[12.5px] leading-5 text-text-muted" style={{ padding: "12px 14px" }}>最近没有 Tower 活动。</div>)}
      </div>

      {teardownConfirmOpen && (
        <div className="rounded-xl bg-[var(--kimix-panel-soft-bg)]" style={{ marginTop: 14, padding: "14px 14px" }}>
          <div className="flex items-start" style={{ gap: 8 }}><AlertTriangle size={15} className="mt-0.5 shrink-0 text-accent-warning" /><div className="text-[13px] font-medium leading-5 text-text-primary">清理 Tower 工作树？</div></div>
          <div className="text-[12.5px] leading-5 text-text-muted" style={{ marginTop: 8 }}>将派发官方非强制 Teardown。分支、审计记录和含未提交改动的 worktree 会保留；不会强制删除任何内容。</div>
          <div className="flex justify-end" style={{ gap: 10, marginTop: 12 }}><button type="button" disabled={teardownBusy} onClick={() => setTeardownConfirmOpen(false)} className="kimix-icon-text-button kimix-inspector-action is-compact text-text-muted">取消</button><button type="button" disabled={teardownBusy} onClick={() => void teardown()} className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-not-allowed disabled:opacity-55">{teardownBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}派发清理</button></div>
        </div>
      )}
    </section>
  );
}
