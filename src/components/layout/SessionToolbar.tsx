import { useEffect, useRef, useState } from "react";
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  Code2,
  Clipboard,
  ClipboardCopy,
  Ellipsis,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe2,
  History,
  Laptop,
  Link,
  MessageSquarePlus,
  PanelRight,
  Pencil,
  Pin,
  Play,
  Pause,
  RefreshCw,
  Square,
  SquareTerminal,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useLiveSession } from "@/hooks/useLiveSession";
import type { Session } from "@/types/ui";
import { mapHistoryEvents } from "@/utils/eventMapper";
import { settleInactiveEvents } from "@/utils/eventHelpers";
import { sessionToMarkdown } from "@/utils/markdownExport";
import { useArchiveSession } from "@/hooks/useArchiveSession";
import { persistLocalActiveContext, persistLocalConversationState } from "@/utils/persistence";
import { isRoomMutationOwnerRunning, resolveRoomMutationOwner, type RoomMutationOwner } from "@/utils/roomMutationOwner";
import { formatRoomLifecycleOutcomes } from "@/utils/sessionArchive";

export type SessionMenuEntry =
  | { type: "separator" }
  | { type?: "item"; label: string; hint?: string; icon: LucideIcon; disabled?: boolean; action: () => void | Promise<void> };

type LongTaskStage = "drafting" | "planning" | "ready" | "running" | "reviewing" | "paused" | "completed";
type LongTaskAgent = "executor" | "reviewer";

const longTaskStageLabels: Record<LongTaskStage, string> = {
  drafting: "澄清中",
  planning: "规划中",
  ready: "待执行",
  running: "执行中",
  reviewing: "已暂停",
  paused: "已暂停",
  completed: "已完成",
};

function longTaskRecoveryLabel(recovery?: NonNullable<Session["longTask"]>["recovery"]) {
  if (!recovery || recovery.status === "none") return "";
  if (recovery.status === "failed") return "可恢复 · 失败";
  if (recovery.status === "interrupted") return "可恢复 · 中断";
  if (recovery.status === "paused") return "可恢复 · 暂停";
  return "";
}

const longTaskAgentLabels: Record<LongTaskAgent, string> = {
  executor: "执行",
  reviewer: "执行",
};

interface SessionToolbarProps {
  title: string;
  longTaskMeta?: Session["longTask"];
  longTaskStatusTone: LongTaskAgent;
  isCurrentSessionRunning: boolean;
  onOpenLongTaskInspector: () => void;
  projectPath?: string;
  currentProject?: { path?: string } | null;
  diffPanelOpen: boolean;
  onToggleDiffPanel: () => void;
  longTaskInspectorOpen: boolean;
  onToggleLongTaskInspector: () => void;
  showToast: (message: string) => void;
  copyToClipboard: (text: string, successMessage?: string) => Promise<void>;
  onSetLaunchCommand: () => void;
}

export function SessionToolbar({
  title,
  longTaskMeta,
  isCurrentSessionRunning,
  onOpenLongTaskInspector,
  projectPath,
  currentProject,
  diffPanelOpen,
  onToggleDiffPanel,
  longTaskInspectorOpen,
  onToggleLongTaskInspector,
  showToast,
  copyToClipboard,
  onSetLaunchCommand,
}: SessionToolbarProps) {
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [launchMenuOpen, setLaunchMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const launchMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  const addSession = useSessionStore((s) => s.addSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const archiveSession = useArchiveSession();
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const currentSession = useAppStore((s) => s.currentSession);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const roomAgentActivities = useAppStore((s) => s.roomAgentActivities);
  const liveCurrentSessionFromHook = useLiveSession(currentSession?.id);
  const liveCurrentSession = liveCurrentSessionFromHook ?? currentSession;
  let mutationOwner: RoomMutationOwner | null = null;
  let mutationOwnerError = "";
  if (liveCurrentSession) {
    try {
      mutationOwner = resolveRoomMutationOwner(
        liveCurrentSession,
        liveCurrentSession.collaboration?.defaultRecipientIds,
        permissionMode,
      );
    } catch (error) {
      mutationOwnerError = error instanceof Error ? error.message : String(error);
    }
  }
  const mutationSessionView = mutationOwner?.sessionView;
  const isMutationOwnerRunning = liveCurrentSession
    ? isRoomMutationOwnerRunning(liveCurrentSession.id, mutationOwner, roomAgentActivities, runningSessionId)
    : false;

  useEffect(() => {
    if (!sessionMenuOpen && !launchMenuOpen && !projectMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (sessionMenuOpen && !sessionMenuRef.current?.contains(target)) setSessionMenuOpen(false);
      if (launchMenuOpen && !launchMenuRef.current?.contains(target)) setLaunchMenuOpen(false);
      if (projectMenuOpen && !projectMenuRef.current?.contains(target)) setProjectMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [sessionMenuOpen, launchMenuOpen, projectMenuOpen]);

  const openRenameDialog = () => {
    if (!liveCurrentSession) {
      showToast("当前没有对话");
      return;
    }
    if (liveCurrentSession.collaboration && !mutationOwner) {
      showToast(mutationOwnerError || "请先选择一个 Agent。");
      return;
    }
    setRenameDraft(liveCurrentSession.title);
    setRenameError(null);
    setRenameDialogOpen(true);
  };

  const submitRenameCurrentSession = async () => {
    if (!liveCurrentSession) {
      setRenameDialogOpen(false);
      showToast("当前没有对话");
      return;
    }
    const nextTitle = renameDraft.trim();
    if (!nextTitle || nextTitle === liveCurrentSession.title) return;
    setRenameBusy(true);
    setRenameError(null);
    if (liveCurrentSession.engine === "kimi-code") {
      if (!mutationOwner) {
        setRenameBusy(false);
        setRenameError(mutationOwnerError || "请先选择一个 Agent。");
        return;
      }
      const runtimeSessionId = mutationOwner.runtimeSessionId;
      if (!runtimeSessionId) {
        setRenameBusy(false);
        setRenameError("没有可重命名的官方会话");
        return;
      }
      const renamed = await window.api.renameKimiCodeSession({ sessionId: runtimeSessionId, title: nextTitle });
      if (!renamed.success) {
        setRenameBusy(false);
        setRenameError(`重命名失败：${renamed.error}`);
        return;
      }
    }
    const updatedAt = Date.now();
    updateSession(liveCurrentSession.id, (session) => ({ ...session, title: nextTitle, titleLocked: true, updatedAt }));
    setCurrentSession({ ...liveCurrentSession, title: nextTitle, titleLocked: true, updatedAt });
    setRenameBusy(false);
    setRenameDialogOpen(false);
    showToast(liveCurrentSession.collaboration && mutationOwner ? `${mutationOwner.displayName} · 已同步官方标题和房间标题` : "已重命名");
  };

  const archiveCurrentSession = async () => {
    if (!liveCurrentSession) {
      showToast("当前没有对话");
      return;
    }
    const result = await archiveSession(liveCurrentSession.id);
    if (result.outcomes?.length) {
      showToast(`房间${formatRoomLifecycleOutcomes("archive", result.outcomes)}`);
      if (!result.success) return;
    }
    if (!result.success) {
      showToast(`归档失败：${result.error}`);
      return;
    }
    setCurrentSession(null);
    if (!result.outcomes?.length) showToast("已归档对话");
  };

  const forkCurrentSession = async () => {
    if (!liveCurrentSession || liveCurrentSession.engine !== "kimi-code") {
      showToast("当前不是 Kimi Code 会话");
      return;
    }
    if (!mutationOwner || !mutationSessionView) {
      showToast(mutationOwnerError || "请先选择一个 Agent。");
      return;
    }
    if (isMutationOwnerRunning) {
      showToast(`${mutationOwner.displayName} 正在运行，稍后再派生`);
      return;
    }
    if (liveCurrentSession.longTask) {
      showToast("长程任务会话暂不支持直接派生");
      return;
    }
    const runtimeSessionId = mutationOwner.runtimeSessionId;
    if (!runtimeSessionId) {
      showToast("没有可派生的官方会话");
      return;
    }
    const workDir = liveCurrentSession.projectPath || projectPath || "";
    if (!workDir) {
      showToast("缺少工作目录，无法读取派生历史");
      return;
    }

    const titleBase = liveCurrentSession.title?.trim() || "新会话";
    const now = new Date();
    const timeLabel = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const forkTitle = `${titleBase.replace(/\s·\s分支(?:\s\d{2}:\d{2})?$/, "")} · 分支 ${timeLabel}`;
    const forkId = `fork-${crypto.randomUUID()}`;
    const forked = await window.api.forkKimiCodeSession({ sessionId: runtimeSessionId, forkId, title: forkTitle });
    if (!forked.success) {
      showToast(`派生失败：${forked.error}`);
      return;
    }

    const forkSessionId = forked.data.sessionId;
    if (forkSessionId === runtimeSessionId || forkSessionId === liveCurrentSession.id) {
      showToast("派生失败：官方返回了原会话 ID，已保留原对话不切换");
      return;
    }
    await window.api.cancelKimiCodeTurn({ sessionId: forkSessionId }).catch(() => undefined);
    const forkWorkDir = forked.data.workDir || workDir;
    const forkUiSessionId = `local-fork-${crypto.randomUUID()}`;
    const forkProjectPath = liveCurrentSession.projectPath || projectPath || forkWorkDir;
    const loaded = await window.api.loadKimiCodeSession({ workDir: forkWorkDir, sessionId: forkSessionId });
    const events = loaded.success
      ? settleInactiveEvents(mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []))
      : settleInactiveEvents(mutationSessionView.events);
    const updatedAt = Date.now();
    const nextSession: Session = {
      id: forkUiSessionId,
      engine: "kimi-code",
      runtimeSessionId: forkSessionId,
      officialSessionId: forkSessionId,
      model: mutationSessionView.model,
      permissionMode: mutationSessionView.permissionMode,
      planMode: mutationSessionView.planMode,
      title: forkTitle,
      titleLocked: true,
      projectPath: forkProjectPath,
      events,
      isLoading: false,
      createdAt: updatedAt,
      updatedAt,
    };
    addSession(nextSession);
    setCurrentSession(nextSession);
    showToast(loaded.success ? `已从 ${mutationOwner.displayName} 派生并切换到：${forkTitle}` : `已从 ${mutationOwner.displayName} 派生，但刷新历史失败：${loaded.error}`);
  };

  const canForkKimiSession = Boolean(
    liveCurrentSession?.engine === "kimi-code" &&
    !liveCurrentSession.longTask &&
    Boolean(mutationOwner) &&
    !isMutationOwnerRunning &&
    Boolean(mutationOwner?.runtimeSessionId)
  );

  const sessionMenuItems: SessionMenuEntry[] = [
    { label: "置顶对话", hint: "Ctrl+Alt+P", icon: Pin, disabled: true, action: () => undefined },
    { label: "重命名对话", hint: "Ctrl+Alt+R", icon: Pencil, action: openRenameDialog },
    { label: "归档对话", hint: "Ctrl+Shift+A", icon: Archive, action: archiveCurrentSession },
    { type: "separator" },
    { label: "复制工作目录", hint: "Ctrl+Shift+C", icon: ClipboardCopy, action: () => copyToClipboard(projectPath ?? liveCurrentSession?.projectPath ?? "", "已复制工作目录") },
    { label: "复制会话 ID", hint: "Ctrl+Alt+C", icon: Clipboard, action: () => copyToClipboard(liveCurrentSession?.id ?? "", "已复制会话 ID") },
    { label: "复制深度链接", hint: "Ctrl+Alt+L", icon: Link, action: () => copyToClipboard(`kimix://session/${liveCurrentSession?.id ?? ""}`, "已复制深度链接") },
    { label: "复制为 Markdown", icon: FileText, action: () => liveCurrentSession ? copyToClipboard(sessionToMarkdown(liveCurrentSession), "已复制 Markdown") : showToast("当前没有对话") },
    { type: "separator" },
    { label: "打开侧边聊天", icon: MessageSquarePlus, disabled: true, action: () => undefined },
    { label: "派生到本地", icon: Laptop, disabled: !canForkKimiSession, action: forkCurrentSession },
    { label: "会话可视化", icon: History, disabled: !liveCurrentSession || liveCurrentSession.engine !== "kimi-code" || !mutationOwner?.runtimeSessionId, action: openKimiVis },
    { label: "添加自动化...", icon: History, disabled: true, action: () => undefined },
    { type: "separator" },
    { label: "在新窗口中打开", icon: ExternalLink, disabled: true, action: () => undefined },
  ];

  const handleSessionMenuEntry = (entry: SessionMenuEntry) => {
    if (entry.type === "separator" || entry.disabled) return;
    void entry.action();
    setSessionMenuOpen(false);
  };

  const openProjectPath = async () => {
    if (projectPath) {
      const res = await window.api.openProjectPath({ path: projectPath });
      if (!res.success) showToast(`打开文件资源管理器失败：${res.error}`);
    }
    setProjectMenuOpen(false);
  };

  const openProjectEditor = async () => {
    if (projectPath) {
      const res = await window.api.openProjectEditor({ path: projectPath, editor: "vscode" });
      if (!res.success) showToast(`打开编辑器失败：${res.error}`);
    }
    setProjectMenuOpen(false);
  };

  const openProjectTerminal = async () => {
    if (projectPath) {
      const res = await window.api.openProjectTerminal({ path: projectPath });
      if (!res.success) showToast(`打开终端失败：${res.error}`);
    }
    setProjectMenuOpen(false);
  };

  const openCurrentSessionInKimiWeb = async () => {
    if (liveCurrentSession?.collaboration && !mutationOwner) {
      showToast(mutationOwnerError || "请先选择一个 Agent。");
      return;
    }
    const runtimeSessionId = liveCurrentSession?.engine === "kimi-code" ? mutationOwner?.runtimeSessionId : undefined;
    if (liveCurrentSession?.collaboration && !runtimeSessionId) {
      showToast(`${mutationOwner?.displayName ?? "当前 Agent"} 尚未绑定可打开的官方会话`);
      return;
    }
    const res = await window.api.openKimiCodeWebServer(runtimeSessionId ? { sessionId: runtimeSessionId } : undefined);
    if (!res.success) {
      showToast(`打开 Kimi Web 失败：${res.error}`);
      return;
    }
    showToast(runtimeSessionId && mutationOwner ? `已在 Kimi Web 打开 ${mutationOwner.displayName}` : "已打开 Kimi Web");
  };

  const launchExecutable = async () => {
    const res = await window.api.launchExecutable();
    if (!res.success) {
      showToast(`启动失败：${res.error}`);
    }
  };

  const chooseExecutable = async () => {
    const res = await window.api.chooseExecutable();
    showToast(res.success ? "已更新启动文件" : `选择失败：${res.error}`);
    setLaunchMenuOpen(false);
  };

  const launchSavedCommand = async () => {
    const res = await window.api.launchCommand({ cwd: projectPath ?? undefined });
    if (!res.success) {
      showToast(`启动失败：${res.error}`);
    }
  };

  async function openKimiVis() {
    if (!liveCurrentSession || liveCurrentSession.engine !== "kimi-code") {
      showToast("当前不是 Kimi Code 会话");
      return;
    }
    if (!mutationOwner) {
      showToast(mutationOwnerError || "请先选择一个 Agent。");
      return;
    }
    const runtimeSessionId = mutationOwner.runtimeSessionId;
    if (!runtimeSessionId) {
      showToast("当前会话没有可视化的官方 session");
      return;
    }
    const res = await window.api.startKimiCodeVis({ sessionId: runtimeSessionId });
    if (!res.success) {
      showToast(`打开可视化失败：${res.error}`);
    } else {
      showToast(`已打开 ${mutationOwner.displayName} 的 Kimi vis`);
    }
  }

  const reloadKimixWindow = () => {
    void persistLocalConversationState();
    persistLocalActiveContext();
    if (typeof window.api.reloadWindow === "function") {
      void window.api.reloadWindow();
      return;
    }
    window.location.reload();
  };

  return (
    <>
    <div
      className="kimix-app-shell-toolbar grid h-14 shrink-0 items-center border-b"
      style={{ gridTemplateColumns: "minmax(0, 1fr) auto", minWidth: 0, width: "100%", maxWidth: "100%", paddingLeft: 30, paddingRight: 12 }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="min-w-0 max-w-[300px] truncate text-[14px] font-medium text-[var(--kimix-panel-text)]" title={title}>
          {title}
        </div>
        <div ref={sessionMenuRef} className="relative shrink-0" onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => setSessionMenuOpen((open) => !open)}
            className={`kimix-muted-action flex h-8 w-8 items-center justify-center rounded-lg ${sessionMenuOpen ? "bg-[var(--kimix-panel-hover)] text-[var(--kimix-panel-text)]" : ""}`}
            title="更多"
            aria-label="更多"
          >
            <Ellipsis size={17} />
          </button>
          {sessionMenuOpen && (
            <div className="kimix-floating-menu absolute left-0 top-full z-[65] mt-2 w-[332px] overflow-hidden rounded-[15px] py-3 text-[14px] text-[var(--kimix-panel-text)]">
              {sessionMenuItems.map((item, index) => (
                item.type === "separator" ? (
                  <div key={`session-menu-separator-${index}`} className="my-2 border-t border-[var(--kimix-panel-divider)]" />
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    disabled={item.disabled}
                    onClick={() => handleSessionMenuEntry(item)}
                    className={`flex min-h-10 w-full items-center gap-3 text-left leading-none transition-colors ${
                      item.disabled
                        ? "cursor-not-allowed text-[var(--kimix-panel-text-muted)]"
                        : "text-[var(--kimix-panel-text)] hover:bg-[var(--kimix-panel-hover)]"
                    }`}
                    style={{ paddingLeft: 20, paddingRight: 20, paddingTop: 9, paddingBottom: 9 }}
                  >
                    <item.icon size={17} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint && <span className="shrink-0 text-[13px] text-[var(--kimix-panel-text-muted)]">{item.hint}</span>}
                  </button>
                )
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3.5 text-text-muted">
        {longTaskMeta ? (
          <button
            type="button"
            onClick={onOpenLongTaskInspector}
            className={`flex h-9 min-w-[148px] items-center rounded-xl border bg-surface-elevated text-left transition-colors ${
              longTaskMeta.recovery && longTaskMeta.recovery.status !== "none"
                ? "border-accent-warning text-accent-warning hover:bg-accent-warning-light"
                : "border-accent-primary-soft text-accent-primary hover:bg-accent-primary-light"
            }`}
            style={{ gap: 9, paddingLeft: 13, paddingRight: 14 }}
            title="查看长程任务状态"
            aria-label="查看长程任务状态"
          >
            {longTaskMeta.recovery && longTaskMeta.recovery.status !== "none" ? (
              <Pause size={15} className="shrink-0" />
            ) : longTaskMeta.stage === "completed" ? (
              <CheckCircle2 size={15} className="shrink-0" />
            ) : isCurrentSessionRunning ? (
              <Square size={13} className="shrink-0 fill-current" />
            ) : longTaskMeta.stage === "paused" ? (
              <Pause size={15} className="shrink-0" />
            ) : (
              <Play size={15} className="shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
              {longTaskRecoveryLabel(longTaskMeta.recovery) || `${longTaskAgentLabels[longTaskMeta.activeAgent]} · ${longTaskStageLabels[longTaskMeta.stage]}`}
            </span>
            <span className="shrink-0 rounded-full bg-surface-elevated/75 text-[12px] leading-5" style={{ paddingLeft: 8, paddingRight: 8 }}>
              {longTaskMeta.currentStep}{longTaskMeta.targetStep ? `/${longTaskMeta.targetStep}` : ""}
            </span>
          </button>
        ) : (
          <div ref={launchMenuRef} className="relative" onMouseDown={(e) => e.stopPropagation()}>
            <div className={`kimix-toolbar-button flex h-9 w-14 items-center rounded-xl border ${launchMenuOpen ? "border-accent-primary bg-accent-primary-light text-accent-primary" : "border-[var(--kimix-panel-border-soft)] text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-soft-bg)] hover:text-[var(--kimix-panel-text)]"}`}>
              <button
                onClick={() => void launchExecutable()}
                className="flex h-full flex-1 items-center justify-center"
                style={{ paddingLeft: 9, paddingRight: 4 }}
                title="启动当前启动文件"
                aria-label="启动"
              >
                <Play size={14} className="shrink-0" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLaunchMenuOpen((value) => !value);
                }}
                className="mr-0.5 flex h-8 w-6 items-center justify-center rounded-lg transition-colors hover:bg-[var(--kimix-panel-soft-bg)]"
                title="启动方式"
                aria-label="启动方式"
              >
                <ChevronDown size={13} />
              </button>
            </div>
            {launchMenuOpen && (
              <div className="kimix-floating-menu absolute right-0 top-full z-40 mt-3 w-[224px] overflow-hidden rounded-[14px] py-2.5 text-[14px] text-[var(--kimix-panel-text)]">
                <button
                  onClick={() => {
                    setLaunchMenuOpen(false);
                    void launchExecutable();
                  }}
                  style={{ paddingLeft: 18, paddingRight: 16 }}
                  className="flex h-10 w-full items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]"
                >
                  <Play size={15} className="w-6 shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate">启动文件</span>
                </button>
                <button
                  onClick={() => void chooseExecutable()}
                  style={{ paddingLeft: 18, paddingRight: 16 }}
                  className="flex h-10 w-full items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]"
                >
                  <FolderOpen size={15} className="w-6 shrink-0 text-accent-warning" />
                  <span className="min-w-0 flex-1 truncate">选择启动文件...</span>
                </button>
                <div className="my-1.5 border-t border-[var(--kimix-panel-divider)]" />
                <button
                  onClick={() => {
                    setLaunchMenuOpen(false);
                    void launchSavedCommand();
                  }}
                  style={{ paddingLeft: 18, paddingRight: 16 }}
                  className="flex h-10 w-full items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]"
                >
                  <SquareTerminal size={15} className="w-6 shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate">启动命令</span>
                </button>
                <button
                  onClick={() => {
                    setLaunchMenuOpen(false);
                    onSetLaunchCommand();
                  }}
                  style={{ paddingLeft: 18, paddingRight: 16 }}
                  className="flex h-10 w-full items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]"
                >
                  <Pencil size={15} className="w-6 shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate">设置启动命令...</span>
                </button>
              </div>
            )}
          </div>
        )}
        <div ref={projectMenuRef} className="relative" onMouseDown={(e) => e.stopPropagation()}>
          <div className={`kimix-toolbar-button flex h-9 w-14 items-center rounded-xl border ${projectMenuOpen ? "border-accent-primary bg-accent-primary-light text-accent-primary" : "border-[var(--kimix-panel-border-soft)] text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-soft-bg)] hover:text-[var(--kimix-panel-text)]"} ${!projectPath ? "opacity-45" : ""}`}>
            <button
              onClick={openProjectPath}
              disabled={!projectPath}
              className="flex h-full flex-1 items-center justify-center disabled:cursor-not-allowed"
              style={{ paddingLeft: 8, paddingRight: 3 }}
              title={currentProject?.path ?? "工作区"}
              aria-label="在文件资源管理器中打开项目"
            >
              <FolderOpen size={16} className="shrink-0" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setProjectMenuOpen((value) => !value);
              }}
              disabled={!projectPath}
              className="mr-0.5 flex h-8 w-6 items-center justify-center rounded-lg transition-colors hover:bg-[var(--kimix-panel-soft-bg)] disabled:cursor-not-allowed"
              title="打开方式"
              aria-label="打开方式"
            >
              <ChevronDown size={13} />
            </button>
          </div>
          {projectMenuOpen && (
            <div className="kimix-floating-menu absolute right-0 top-full z-40 mt-3 w-[236px] overflow-hidden rounded-[14px] py-2.5 text-[14px] text-[var(--kimix-panel-text)]">
              <button onClick={openProjectPath} style={{ paddingLeft: 18, paddingRight: 16 }} className="flex h-10 w-full items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]">
                <FolderOpen size={15} className="w-6 shrink-0 text-accent-warning" />
                <span className="min-w-0 flex-1 truncate">在文件资源管理器中打开</span>
              </button>
              <button onClick={() => void openProjectEditor()} style={{ paddingLeft: 18, paddingRight: 16 }} className="flex h-10 w-full items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]">
                <Code2 size={15} className="w-6 shrink-0 text-accent-primary" />
                <span className="min-w-0 flex-1 truncate">使用 VS Code 打开</span>
              </button>
              <button onClick={openProjectTerminal} style={{ paddingLeft: 18, paddingRight: 16 }} className="flex h-10 w-full items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]">
                <SquareTerminal size={15} className="w-6 shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate">打开终端</span>
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => void openCurrentSessionInKimiWeb()}
          className="kimix-toolbar-button flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--kimix-panel-border-soft)] text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-soft-bg)] hover:text-[var(--kimix-panel-text)] disabled:cursor-not-allowed disabled:opacity-45"
          title="在 Kimi Web 打开当前会话"
          aria-label="在 Kimi Web 打开当前会话"
        >
          <Globe2 size={15} />
        </button>
        <button
          onClick={reloadKimixWindow}
          className="kimix-toolbar-button flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--kimix-panel-border-soft)] text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-soft-bg)] hover:text-[var(--kimix-panel-text)]"
          title="重新载入页面 (Ctrl+R)"
          aria-label="重新载入页面"
        >
          <RefreshCw size={15} />
        </button>
        <button
          onClick={onToggleDiffPanel}
          className={`kimix-toolbar-button flex h-9 w-9 items-center justify-center rounded-xl border ${
            diffPanelOpen
              ? "border-accent-primary bg-accent-primary-light text-accent-primary"
              : "border-[var(--kimix-panel-border-soft)] text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-soft-bg)]"
          }`}
          title="文件预览"
          aria-label="文件预览"
        >
          <FileText size={15} />
        </button>
        <button
          onClick={onToggleLongTaskInspector}
          className={`kimix-toolbar-button flex h-9 w-9 items-center justify-center rounded-xl border ${
            longTaskInspectorOpen
              ? "border-accent-primary bg-accent-primary-light text-accent-primary"
              : "border-[var(--kimix-panel-border-soft)] text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-soft-bg)]"
          }`}
          title="会话侧栏"
          aria-label="会话侧栏"
        >
          <PanelRight size={15} />
        </button>
      </div>
    </div>
    {renameDialogOpen && (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-[color:var(--kimix-modal-overlay-bg)]"
        style={{ padding: 24 }}
        onMouseDown={() => {
          if (!renameBusy) setRenameDialogOpen(false);
        }}
      >
        <form
          className="kimix-floating-panel w-full max-w-[420px] rounded-[14px] bg-[var(--kimix-panel-bg)] text-[var(--kimix-panel-text)] shadow-xl"
          style={{ padding: 22 }}
          onMouseDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            void submitRenameCurrentSession();
          }}
        >
          <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
            <div className="min-w-0 text-[16px] font-semibold leading-6">重命名对话</div>
            <button
              type="button"
              onClick={() => {
                if (!renameBusy) setRenameDialogOpen(false);
              }}
              className="kimix-muted-action flex h-8 w-8 items-center justify-center rounded-lg"
              aria-label="关闭"
            >
              <X size={16} />
            </button>
          </div>
          <input
            value={renameDraft}
            onChange={(event) => {
              setRenameDraft(event.target.value);
              setRenameError(null);
            }}
            autoFocus
            className="h-10 w-full rounded-lg border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)] text-[14px] outline-none focus:border-[var(--accent-blue)]"
            style={{ marginTop: 16, paddingLeft: 14, paddingRight: 14 }}
            placeholder="输入新的对话标题"
          />
          {renameError && (
            <div className="rounded-lg bg-accent-danger-light text-[13px] leading-5 text-accent-danger" style={{ marginTop: 12, padding: "9px 12px" }}>
              {renameError}
            </div>
          )}
          <div className="flex justify-end" style={{ gap: 10, marginTop: 18 }}>
            <button
              type="button"
              onClick={() => setRenameDialogOpen(false)}
              disabled={renameBusy}
              className="kimix-icon-text-button kimix-muted-action is-compact disabled:cursor-wait disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={renameBusy || !renameDraft.trim() || renameDraft.trim() === liveCurrentSession?.title}
              className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {renameBusy ? "保存中" : "保存"}
            </button>
          </div>
        </form>
      </div>
    )}
    </>
  );
}
