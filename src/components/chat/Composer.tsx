import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, ArrowUp, ChevronDown, Check, Send, Edit2, Trash2, Mic, Hand, ShieldAlert, CircleCheck, Brain, X, GripVertical, MoreHorizontal, AtSign, TerminalSquare, FileText, Bot, Puzzle, ClipboardList, Palette, Zap, Target, Loader2 } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useLiveSession } from "@/hooks/useLiveSession";
import type { ComposerDockCard, Session, TimelineEvent, PermissionMode, OfficialGoalSnapshot, ThemePaletteColors, KimiThemePalette, UserMessageImage, RoomContextShareSelection } from "@/types/ui";
import { kimiThemePaletteId } from "@/utils/themePalettes";
import { ComposerInput, type ComposerInputHandle } from "./ComposerInput";
import { TodoPanel, getVisibleTodos } from "./TodoPanel";
import { ContextRing } from "./ContextRing";
import { DrawingBoard, type DrawingBoardRequest } from "./DrawingBoard";
import { ImagePreviewOverlay, type PreviewImage } from "./ImagePreviewOverlay";
import { AddRoomAgentDialog } from "./AddRoomAgentDialog";
import { EditRoomAgentDialog } from "./EditRoomAgentDialog";
import { RoomAgentPicker } from "./RoomAgentPicker";
import { RoomContextPicker } from "./RoomContextPicker";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import { isSessionRuntimeRunning } from "@/utils/sessionActivity";
import { isWindows } from "@/utils/platform";
import { isKimiActiveTurnError, sendKimiCodePromptWithRetry } from "@/utils/kimiCodeSendRetry";
import { kimiCodeRouteStatus } from "@/utils/kimiCodeRouteStatus";
import { reconcileOfficialGoalSnapshot } from "@/utils/officialGoalState";
import { classifySlashCommand, shouldActivateSkillBeforePrompt } from "@/utils/slashRouting";
import { normalizeAdditionalWorkDirs } from "@/utils/additionalWorkDirs";
import { isSamePath } from "@/utils/pathCase";
import { logError } from "@/utils/reportError";
import { isPendingPermissionTurnEnded, type PendingPermissionChange } from "@/utils/pendingPermissionChange";
import { setKimiCodePermissionWithRecovery } from "@/utils/kimiCodePermission";
import { displayedSwarmMode, hasPendingSwarmMode, pendingSwarmModeValue } from "@/utils/swarmMode";
import { resolveResumedSessionModel } from "@/utils/modelDisplay";
import { mapHistoryEvents } from "@/utils/eventMapper";
import { getPrimaryRoomAgent, getRoomAgent, roomAgentActivityKey, updateRoomAgent, updateRoomAgentEvents } from "@/utils/collaborationRooms";
import { reconcileAgentCanonicalHistory } from "@/utils/collaborationHistory";
import {
  appendRoomAgentSteerEvent,
  getRoomAgentControlTargets,
  resolveRoomAgentControlTarget,
  settleStoppedRoomAgent,
  type RoomAgentControlTarget,
} from "@/utils/roomAgentControl";
import {
  appendRoomMutationEvent,
  resolveRoomMutationOwner,
  updateRoomMutationOwner,
  type RoomMutationOwner,
} from "@/utils/roomMutationOwner";
import {
  bindRecoveredRoomAgentRuntime,
  getPrimaryRecoveryTarget,
  resumeRoomAgentRuntime,
  roomAgentCanResume,
} from "@/utils/roomAgentRecovery";
import { persistLocalConversationState } from "@/utils/persistence";
import {
  bindProvisionedRoomAgent,
  failRoomAgentProvisioning,
  getRoomPrimaryMetadataIdentity,
  isMultiAgentRoomUiAvailable,
  isMultiAgentRoomUiEnabled,
  MULTI_AGENT_ROOM_UI_CHANGED_EVENT,
  prepareRoomAgentProvisioning,
  renameRoomAgent,
  type RoomAgentDraft,
} from "@/utils/roomAgentProvisioning";
import {
  cancelQueuedRoomDelivery,
  createRoomMessageDispatch,
  dispatchQueuedRoomDelivery,
  getDispatchableRoomDeliveries,
  retryRoomDelivery,
} from "@/utils/roomDelivery";
import { resolveRoomPromptRoute } from "@/utils/roomRouting";
import { detachRoomAgentAsSession, roomHasActiveAgentWork, roomHasExecutingAgentWork } from "@/utils/sessionArchive";
import {
  buildRoomDeliveryPrompt,
  estimateRoomContextShare,
  getDefaultRoomContextSelection,
} from "@/utils/roomContextBridge";

function genId(): string {
  return Math.random().toString(36).substring(2, 11);
}

const MAX_IMAGE_ATTACHMENTS = 20;
const MAX_SINGLE_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_IMAGE_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_CONCURRENT_IMAGE_READS = 3;

function hasDraggedFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

const PERMISSION_OPTIONS: { value: PermissionMode; label: string; desc: string; tooltip: string }[] = [
  { value: "manual", label: "手动审批", desc: "高风险操作会先问你", tooltip: "手动审批：高风险工具调用会暂停确认。" },
  { value: "auto", label: "自动权限", desc: "少提问，自动继续推进", tooltip: "自动权限：少问用户，Plan 和问题会尽量自动继续。" },
  { value: "yolo", label: "完全访问权限", desc: "工具权限最高", tooltip: "完全访问：自动批准所有工具请求，最少触发工具审批。" },
];

const permissionMenuIcons = {
  manual: Hand,
  auto: CircleCheck,
  yolo: ShieldAlert,
};

function emitPermissionModeDiag(stage: string, data: Record<string, unknown>) {
  const payload = {
    stage,
    at: Date.now(),
    ...data,
  };
  window.dispatchEvent(new CustomEvent("kimix:permission-mode-diag", { detail: payload }));
  window.api.writeDiag?.({
    message: "[Composer] permissionMode",
    data: payload,
  }).catch(logError("writeDiag"));
}

const DRAWING_BOARD_RATIOS: DrawingBoardRequest["ratio"][] = ["1:1", "4:3", "3:4", "16:9", "9:16"];
const FALLBACK_KIMI_MODEL = "kimi-for-coding";

function removeLocalSendAttempt(
  events: TimelineEvent[],
  userEventId: string,
  responseEventId: string,
  shouldRemoveUserEvent: boolean,
) {
  return events.filter((event) => {
    if (event.id === responseEventId) return false;
    if (shouldRemoveUserEvent && event.id === userEventId) return false;
    if (shouldRemoveUserEvent && event.type === "status_update" && event.parentEventId === userEventId) return false;
    return true;
  });
}

function goalStatusLabel(status: string) {
  if (status === "active") return "进行中";
  if (status === "paused") return "已暂停";
  if (status === "blocked") return "受阻";
  if (status === "complete") return "已完成";
  return status;
}

function formatPercent(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = value > 1 ? value : value * 100;
  return `${normalized.toFixed(normalized >= 10 ? 1 : 2)}%`;
}

function formatKimiCodeStatus(status: Record<string, unknown>): string {
  const contextTokens = typeof status.contextTokens === "number" ? status.contextTokens : undefined;
  const maxContextTokens = typeof status.maxContextTokens === "number" ? status.maxContextTokens : undefined;
  const contextUsage = formatPercent(status.contextUsage);
  const lines = [
    "Kimi Code 状态：",
    typeof status.model === "string" ? `模型：${status.model}` : "",
    typeof status.permission === "string" ? `权限：${status.permission}` : "",
    typeof status.planMode === "boolean" ? `Plan：${status.planMode ? "开" : "关"}` : "",
    typeof status.swarmMode === "boolean" ? `Swarm：${status.swarmMode ? "开" : "关"}` : "",
    typeof status.thinkingLevel === "string" ? `思考强度：${status.thinkingLevel}` : "",
    contextTokens !== undefined && maxContextTokens !== undefined
      ? `上下文：${contextTokens.toLocaleString()} / ${maxContextTokens.toLocaleString()}${contextUsage ? ` (${contextUsage})` : ""}`
      : contextUsage
        ? `上下文：${contextUsage}`
        : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function formatKimiCodeUsage(usage: unknown): string {
  if (!usage || typeof usage !== "object") return "Kimi Code 用量：暂无可显示的会话用量。";
  const usageRecord = usage as Record<string, unknown>;
  const compact = JSON.stringify(usageRecord, null, 2);
  return `Kimi Code 会话用量：\n${compact}`;
}

function buildGoalKickoffPrompt(objective: string) {
  return [
    "【Kimix 官方 Goal：继续推进】",
    "",
    `Goal 目标：${objective}`,
    "",
    "请先读取当前 Goal 状态，再推进本轮工作。",
    "- 本轮只做一个完整、可验证的推进步骤。",
    "- 若需要继续多轮，完成本轮后说明验证证据和下一步。",
    "- 若目标已完成，请调用官方 Goal 工具标记完成。",
    "- 若受阻且无法自行推进，请调用官方 Goal 工具标记受阻，并说明阻塞原因。",
  ].join("\n");
}

function buildCustomThemeKickoffPrompt(request: string) {
  const themeRequest = request.trim() || "生成一套适合日常编码使用的 Kimi Code 主题";
  return [
    "【Kimix /custom-theme 兼容兜底】",
    "",
    "官方内置 custom-theme Skill 当前不可用，请按官方工作流完成等价操作。",
    "",
    `用户主题需求：${themeRequest}`,
    "",
    "如果用户尚未明确亮色/暗色、风格、指定颜色或文件名，请先提问并等待答复；信息完整后再写主题 JSON。",
    "",
    "写入位置必须严格按下面步骤解析，不能猜测用户目录：",
    "- 先读取 `KIMI_CODE_HOME`；非空时使用 `$KIMI_CODE_HOME/themes`。",
    "- `KIMI_CODE_HOME` 为空时才使用真实用户主目录下的 `.kimi-code/themes`。",
    "- Windows 必须通过环境变量解析真实目录，其他系统使用 `$HOME`。",
    "- 禁止写入项目目录、当前工作目录、`~/.kimi-code/themes` 的字面量目录、或任何其他用户目录。",
    "- 如果当前真实用户目录不是 `C:\\Users\\lijialin08`，禁止写入 `C:\\Users\\lijialin08\\.kimi-code\\themes`。",
    "",
    "JSON 结构必须包含：",
    "```json",
    "{",
    "  \"name\": \"theme-name\",",
    "  \"displayName\": \"Theme Display Name\",",
    "  \"base\": \"light\",",
    "  \"colors\": {",
    "    \"primary\": \"#1565C0\",",
    "    \"accent\": \"#00838F\",",
    "    \"text\": \"#1A1A1A\",",
    "    \"textStrong\": \"#1A1A1A\",",
    "    \"textDim\": \"#454545\",",
    "    \"textMuted\": \"#5F5F5F\",",
    "    \"border\": \"#737373\",",
    "    \"borderFocus\": \"#92660A\",",
    "    \"success\": \"#0E7A38\",",
    "    \"warning\": \"#92660A\",",
    "    \"error\": \"#B91C1C\",",
    "    \"diffAdded\": \"#0E7A38\",",
    "    \"diffRemoved\": \"#B91C1C\",",
    "    \"diffAddedStrong\": \"#0E7A38\",",
    "    \"diffRemovedStrong\": \"#B91C1C\",",
    "    \"diffGutter\": \"#737373\",",
    "    \"diffMeta\": \"#5F5F5F\",",
    "    \"roleUser\": \"#9A4A00\",",
    "    \"shellMode\": \"#00838F\"",
    "  }",
    "}",
    "```",
    "",
    "主题质量要求（必须先按这些规则设计，再写 JSON）：",
    "- 这 19 个 token 不是三色主题映射，必须按语义分别设计，不能只改 primary/accent/text 后复制默认值。",
    "- `diffAdded` / `diffRemoved` 是 diff 背景/普通提示语义，必须与 `success` / `error` 有明确色相或明度差异；不能直接等于 success/error。",
    "- `diffAddedStrong` / `diffRemovedStrong` 必须比对应普通 diff 更强、更醒目，不能等于 diffAdded/diffRemoved，也不能等于 success/error。",
    "- `diffGutter` / `diffMeta` 是 diff 辅助信息，应该低饱和、低对比，但仍能读清；不要复用 textMuted 以外的强强调色。",
    "- `success` / `warning` / `error` 必须分别服务成功、警告、错误，warning 不要复用 success 或 borderFocus，error 不要复用 diffRemoved。",
    "- `borderFocus` 必须是清晰焦点环颜色，通常可比 primary 更暖或更亮，但不能和 border、textMuted 一样弱。",
    "- `roleUser` 必须是用户身份/用户消息强调色，应该与 primary/accent 有联系但可辨认，不能直接复用 text 或 border。",
    "- `text` / `textStrong` / `textDim` / `textMuted` 必须形成递进层级；textStrong 应最清晰，textDim 和 textMuted 不能完全相同。",
    "- `border` 必须能在背景上看见但不抢眼；不能过浅到不可见，也不能和 primary/accent 抢层级。",
    "- 对低饱和主题也要保留语义区分：可以低饱和，但不能把所有语义色都灰化或同色化。",
    "",
    "生成前先做一轮内部配色自检，禁止出现这些情况：",
    "- diffAdded === success，diffRemoved === error。",
    "- diffAddedStrong === diffAdded，diffRemovedStrong === diffRemoved。",
    "- success === warning，warning === error，success === error。",
    "- textDim === textMuted，border === textMuted === diffGutter。",
    "- 超过 3 个语义 token 共用同一个颜色值。",
    "如果自检发现上述任一情况，必须先重新选色再写文件。",
    "",
    "建议生成流程：",
    "1. 先根据用户需求确定 2-3 个主题关键词和 base。",
    "2. 设计核心色：primary、accent、roleUser、borderFocus。",
    "3. 设计文本层级和边框层级。",
    "4. 独立设计状态色：success、warning、error。",
    "5. 独立设计 diff 色：added/removed、strong added/removed、gutter/meta。",
    "6. 再写 JSON，写完读取并做重复值/语义色自检。",
    "",
    "执行要求：",
    "- 根据用户需求自行命名主题，文件名使用小写英文、数字和连字符。",
    "- 颜色必须都是 `#RRGGBB`。",
    "- 选择 `base` 为 `light` 或 `dark`，并保证正文、弱文本、边框、背景语义在该模式下有足够对比度。",
    "- 创建目录、写入 JSON 后，读取文件确认 JSON 可解析。",
    "- 写完后必须输出一段简短自检结论，说明 diff、状态色、文本层级是否各自独立。",
    "- 写完后必须列出真实目标目录内容，确认新文件出现在 `...\\.kimi-code\\themes\\` 下。",
    "- 完成后告诉用户主题文件的绝对路径，并提示到 Kimix 设置页点击“扫描官方主题”导入。",
  ].join("\n");
}

async function getDefaultKimiModel() {
  try {
    const res = await window.api.getKimiModelConfig();
    if (res.success) return res.data.defaultModel?.trim() || FALLBACK_KIMI_MODEL;
  } catch {
    // Ignore and use the official built-in default below.
  }
  return FALLBACK_KIMI_MODEL;
}

const iconButtonClass =
  "kimix-muted-action flex h-8 w-8 shrink-0 items-center justify-center rounded-xl disabled:cursor-not-allowed disabled:opacity-35";

function roomControlStatusLabel(status: RoomAgentControlTarget["status"]) {
  if (status === "waiting_approval") return "等待审批";
  if (status === "waiting_question") return "等待回答";
  if (status === "accepted") return "已接收";
  return "运行中";
}

type ImageAttachment = {
  id: string;
  kind?: "image" | "file";
  name: string;
  dataUrl?: string;
  filePath?: string;
};

type RoomControlRequest =
  | { action: "stop" }
  | { action: "steer-input" }
  | { action: "steer-pending"; pendingId: string };

function isImageAttachment(attachment: ImageAttachment): attachment is ImageAttachment & { dataUrl: string } {
  return Boolean(attachment.dataUrl);
}

function attachmentFilePath(attachment: ImageAttachment) {
  return attachment.filePath?.trim() || "";
}

function buildAttachmentPromptContent(content: string, attachments: ImageAttachment[]) {
  const files = attachments.filter((attachment) => attachment.kind === "file" || Boolean(attachment.filePath));
  if (files.length === 0) return content;
  const fileLines = files.map((file, index) => {
    const filePath = attachmentFilePath(file);
    return `${index + 1}. ${file.name}${filePath ? `\n   绝对路径：${filePath}` : "\n   绝对路径：未能从系统拖拽事件读取，请提示用户重新选择文件"}`;
  });
  return [
    content.trim(),
    "附件文件：",
    ...fileLines,
    "",
    "请直接使用上述绝对路径读取附件内容，不要只按文件名搜索。",
  ].filter(Boolean).join("\n");
}

function toPromptImages(attachments: ImageAttachment[]) {
  return attachments
    .filter(isImageAttachment)
    .map((image) => ({ name: image.name, dataUrl: image.dataUrl }));
}

function toUserAttachments(attachments: ImageAttachment[]) {
  return attachments.map((attachment) => ({
    id: attachment.id,
    kind: attachment.kind ?? (attachment.dataUrl ? "image" as const : "file" as const),
    name: attachment.name,
    dataUrl: attachment.dataUrl,
    filePath: attachment.filePath,
  }));
}

type CompletionMode = "mention" | "slash";

type CompletionItem = {
  id: string;
  label: string;
  detail?: string;
  insertText: string;
  commandName?: string;
  pluginId?: string;
  pluginCommandName?: string;
  kind: "agent" | "plugin" | "file" | "slash" | "skill" | "plugin-command";
};

const skillCommandPattern = /^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/;
const slashCommandPattern = /^\/([a-zA-Z][\w:-]*)(?:\s+([\s\S]*))?$/;
function summarizeImportPlan(items: { kind: string; action: string }[]) {
  const active = items.filter((item) => item.action !== "skip");
  const count = (kind: string) => active.filter((item) => item.kind === kind).length;
  return `指令 ${count("instruction")} 项，Skills ${count("skill")} 项，MCP ${count("mcp")} 项`;
}

function formatMappedTheme(item: { colors: ThemePaletteColors; sourceTokens: { primary?: string; surface?: string; accent?: string } }) {
  const token = (value?: string) => value ? `(${value})` : "(兜底)";
  return `主色 ${item.colors.primary}${token(item.sourceTokens.primary)}，背景 ${item.colors.surface}${token(item.sourceTokens.surface)}，强调 ${item.colors.accent}${token(item.sourceTokens.accent)}`;
}

type ThemeImportPreview = {
  previewId: string;
  themesDir: string;
  items: {
    id: string;
    displayName: string;
    base: "light" | "dark";
    colors: ThemePaletteColors;
    kimiColors: KimiThemePalette;
    sourceTokens: {
      primary?: string;
      surface?: string;
      accent?: string;
    };
    warning?: string;
  }[];
  warnings: string[];
};

const sdkSlashCommandItems: CompletionItem[] = [
  { id: "slash-goal", label: "/goal", detail: "兼容 Goal 入口；Server 会话暂不支持", insertText: "/goal ", commandName: "goal", kind: "slash" },
  { id: "slash-goal-status", label: "/goal status", detail: "查看当前 Goal 状态", insertText: "/goal status ", commandName: "goal", kind: "slash" },
  { id: "slash-goal-show", label: "/goal show", detail: "显示当前 Goal 状态", insertText: "/goal show ", commandName: "goal", kind: "slash" },
  { id: "slash-goal-start", label: "/goal start", detail: "启动一个新 Goal", insertText: "/goal start ", commandName: "goal", kind: "slash" },
  { id: "slash-goal-start-template", label: "/goal start 修复已知问题并完成验证", detail: "带目标模板：启动一个新 Goal", insertText: "/goal start 修复已知问题并完成验证", commandName: "goal", kind: "slash" },
  { id: "slash-goal-replace", label: "/goal replace", detail: "替换当前 Goal", insertText: "/goal replace ", commandName: "goal", kind: "slash" },
  { id: "slash-goal-replace-template", label: "/goal replace 完成当前任务并输出验证证据", detail: "带目标模板：替换当前 Goal", insertText: "/goal replace 完成当前任务并输出验证证据", commandName: "goal", kind: "slash" },
  { id: "slash-goal-pause", label: "/goal pause", detail: "暂停当前 Goal", insertText: "/goal pause ", commandName: "goal", kind: "slash" },
  { id: "slash-goal-resume", label: "/goal resume", detail: "继续已暂停/受阻 Goal", insertText: "/goal resume ", commandName: "goal", kind: "slash" },
  { id: "slash-goal-cancel", label: "/goal cancel", detail: "取消并清除当前 Goal", insertText: "/goal cancel ", commandName: "goal", kind: "slash" },
  { id: "slash-goal-next", label: "/goal next", detail: "排队后续 Goal", insertText: "/goal next ", commandName: "goal", kind: "slash" },
  { id: "slash-goal-next-template", label: "/goal next 继续收尾并整理剩余风险", detail: "带目标模板：排队后续 Goal", insertText: "/goal next 继续收尾并整理剩余风险", commandName: "goal", kind: "slash" },
  { id: "slash-swarm", label: "/swarm", detail: "兼容 Swarm 入口；Server 会话暂不支持", insertText: "/swarm ", commandName: "swarm", kind: "slash" },
  { id: "slash-swarm-template", label: "/swarm 并行检查最近改动并给出修复建议", detail: "通过兼容链路发起 Swarm 任务", insertText: "/swarm 并行检查最近改动并给出修复建议", commandName: "swarm", kind: "slash" },
  { id: "slash-swarm-on", label: "/swarm on", detail: "开启 Swarm 模式", insertText: "/swarm on ", commandName: "swarm", kind: "slash" },
  { id: "slash-swarm-off", label: "/swarm off", detail: "关闭 Swarm 模式", insertText: "/swarm off ", commandName: "swarm", kind: "slash" },
  { id: "slash-theme", label: "/theme", detail: "打开 Kimix 主题设置；官方终端主题仅供参考", insertText: "/theme", commandName: "theme", kind: "slash" },
  { id: "slash-custom-theme", label: "/custom-theme", detail: "调用官方内置 Skill 创建或修改主题", insertText: "/custom-theme ", commandName: "custom-theme", kind: "slash" },
  { id: "slash-custom-theme-template", label: "/custom-theme 做一套低饱和绿色主题", detail: "调用官方内置 Skill 设计主题", insertText: "/custom-theme 做一套低饱和绿色主题", commandName: "custom-theme", kind: "slash" },
  { id: "slash-import-from-cc-codex", label: "/import-from-cc-codex", detail: "调用官方内置 Skill 导入 Claude Code / Codex 配置", insertText: "/import-from-cc-codex", commandName: "import-from-cc-codex", kind: "slash" },
  { id: "slash-mcp-config", label: "/mcp-config", detail: "调用官方内置 Skill 配置 MCP", insertText: "/mcp-config ", commandName: "mcp-config", kind: "slash" },
  { id: "slash-compact", label: "/compact", detail: "静默压缩当前上下文，可附带保留指令，如：保留本轮测试结果和待办", insertText: "/compact ", commandName: "compact", kind: "slash" },
  { id: "slash-compact-template", label: "/compact 保留本轮测试结果和待办", detail: "带保留指令模板：压缩当前上下文", insertText: "/compact 保留本轮测试结果和待办", commandName: "compact", kind: "slash" },
  { id: "slash-plan", label: "/plan", detail: "切换 Plan 模式", insertText: "/plan ", commandName: "plan", kind: "slash" },
  { id: "slash-plan-on", label: "/plan on", detail: "开启 Plan 模式", insertText: "/plan on ", commandName: "plan", kind: "slash" },
  { id: "slash-plan-off", label: "/plan off", detail: "关闭 Plan 模式", insertText: "/plan off ", commandName: "plan", kind: "slash" },
  { id: "slash-status", label: "/status", detail: "显示当前 Kimi Code 会话状态", insertText: "/status", commandName: "status", kind: "slash" },
  { id: "slash-usage", label: "/usage", detail: "显示当前 Kimi Code 会话用量", insertText: "/usage", commandName: "usage", kind: "slash" },
  { id: "slash-reload", label: "/reload", detail: "重载当前会话配置和 Skill 视图", insertText: "/reload", commandName: "reload", kind: "slash" },
  { id: "slash-btw", label: "/btw", detail: "侧问，不影响主轮次", insertText: "/btw ", commandName: "btw", kind: "slash" },
  { id: "slash-btw-template", label: "/btw 这个函数是谁调用的", detail: "带问题模板：侧问，不影响主轮次", insertText: "/btw 这个函数是谁调用的", commandName: "btw", kind: "slash" },
  { id: "slash-undo", label: "/undo", detail: "撤回最近一次官方历史", insertText: "/undo ", commandName: "undo", kind: "slash" },
  { id: "slash-undo-template", label: "/undo 1", detail: "带次数模板：撤回最近 1 次官方历史", insertText: "/undo 1", commandName: "undo", kind: "slash" },
  { id: "slash-skill", label: "/skill:", detail: "通过官方链路调用 Skill", insertText: "/skill:", commandName: "skill", kind: "slash" },
];

const conservativeSlashCommandItems = sdkSlashCommandItems.filter(
  (item) => !["goal", "swarm", "reload"].includes(item.commandName ?? ""),
);

const mentionBaseItems: CompletionItem[] = [
  { id: "agent-explorer", label: "Explorer Fast", detail: "快速探索代码库", insertText: "@Explorer Fast ", kind: "agent" },
  { id: "agent-implementer", label: "Implementer Safe", detail: "实现代码", insertText: "@Implementer Safe ", kind: "agent" },
  { id: "agent-reviewer", label: "Reviewer Strict", detail: "代码审查", insertText: "@Reviewer Strict ", kind: "agent" },
  { id: "agent-test-runner", label: "Test Runner", detail: "运行测试", insertText: "@Test Runner ", kind: "agent" },
  { id: "plugin-browser", label: "浏览器", detail: "Control the in-app browser with Codex", insertText: "@浏览器 ", kind: "plugin" },
  { id: "plugin-chrome", label: "Chrome", detail: "Control Chrome with Codex", insertText: "@Chrome ", kind: "plugin" },
];

function getActiveCompletion(value: string): { mode: CompletionMode; query: string; start: number } | null {
  const slashMatch = value.match(/(^|\s)\/([^\r\n]*)$/);
  if (slashMatch && slashMatch.index !== undefined) {
    return {
      mode: "slash",
      query: slashMatch[2] ?? "",
      start: slashMatch.index + slashMatch[1].length,
    };
  }
  const mentionMatch = value.match(/(^|\s)@([^\s]*)$/);
  if (!mentionMatch || mentionMatch.index === undefined) return null;
  return {
    mode: "mention",
    query: mentionMatch[2] ?? "",
    start: mentionMatch.index + mentionMatch[1].length,
  };
}

export function Composer() {
  const [input, setInput] = useState("");
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const [drawingBoardRequest, setDrawingBoardRequest] = useState<DrawingBoardRequest | null>(null);
  const [slashCommands, setSlashCommands] = useState<CompletionItem[]>([]);
  const [skillItems, setSkillItems] = useState<CompletionItem[]>([]);
  const [themeImportPreview, setThemeImportPreview] = useState<ThemeImportPreview | null>(null);
  const [themeImportApplyingId, setThemeImportApplyingId] = useState<string | null>(null);
  const [fileItems, setFileItems] = useState<CompletionItem[]>([]);
  const [activeCompletionIndex, setActiveCompletionIndex] = useState(0);
  const inputRef = useRef<ComposerInputHandle>(null);
  const completionListRef = useRef<HTMLDivElement>(null);
  const completionItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const roomDispatchingRef = useRef(new Set<string>());

  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const handoffSessionId = useAppStore((s) => s.handoffSessionId);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const currentProject = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const setDefaultThinking = useAppStore((s) => s.setDefaultThinking);
  const defaultPlanMode = useAppStore((s) => s.defaultPlanMode);
  const additionalWorkDirs = useAppStore((s) => s.additionalWorkDirs);
  const setDefaultPlanMode = useAppStore((s) => s.setDefaultPlanMode);
  const setThemePalette = useAppStore((s) => s.setThemePalette);
  const upsertKimiThemePalette = useAppStore((s) => s.upsertKimiThemePalette);
  const setWorkspaceView = useAppStore((s) => s.setWorkspaceView);
  const hiddenComposerCards = useAppStore((s) => s.hiddenComposerCards);
  const setComposerCardHidden = useAppStore((s) => s.setComposerCardHidden);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const focusInputTrigger = useAppStore((s) => s.focusInputTrigger);
  const voiceShortcut = useAppStore((s) => s.voiceShortcut);
  const roomAgentActivities = useAppStore((s) => s.roomAgentActivities);
  const setRoomAgentActivity = useAppStore((s) => s.setRoomAgentActivity);
  const removeRoomAgentActivity = useAppStore((s) => s.removeRoomAgentActivity);

  const updateSession = useSessionStore((s) => s.updateSession);
  const addSession = useSessionStore((s) => s.addSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const addPendingMessage = useSessionStore((s) => s.addPendingMessage);
  const allPendingMessages = useSessionStore((s) => s.pendingMessages);
  const removePendingMessage = useSessionStore((s) => s.removePendingMessage);
  const reorderPendingMessage = useSessionStore((s) => s.reorderPendingMessage);
  const movePendingMessage = useSessionStore((s) => s.movePendingMessage);
  const promotePendingMessage = useSessionStore((s) => s.promotePendingMessage);
  const liveSession = useLiveSession(currentSession?.id);

  const [showPermissionMenu, setShowPermissionMenu] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [draggingPendingId, setDraggingPendingId] = useState<string | null>(null);
  const [pendingMoreId, setPendingMoreId] = useState<string | null>(null);
  const [showAddRoomAgentDialog, setShowAddRoomAgentDialog] = useState(false);
  const [multiAgentRoomUiEnabled, setMultiAgentRoomUiEnabled] = useState(() => isMultiAgentRoomUiEnabled());
  const [roomContextShareSelection, setRoomContextShareSelection] = useState<RoomContextShareSelection>(() => getDefaultRoomContextSelection());
  const [addRoomAgentTargetId, setAddRoomAgentTargetId] = useState<string | null>(null);
  const [addRoomAgentBusy, setAddRoomAgentBusy] = useState(false);
  const [addRoomAgentError, setAddRoomAgentError] = useState("");
  const [roomAgentMutationId, setRoomAgentMutationId] = useState<string | null>(null);
  const [editingRoomAgentId, setEditingRoomAgentId] = useState<string | null>(null);
  const [editRoomAgentBusy, setEditRoomAgentBusy] = useState(false);
  const [editRoomAgentError, setEditRoomAgentError] = useState("");
  const [roomControlRequest, setRoomControlRequest] = useState<RoomControlRequest | null>(null);

  const permissionBtnRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLDivElement>(null);
  const roomControlMenuRef = useRef<HTMLDivElement>(null);
  const pendingMoreRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingPermissionChangeRef = useRef<PendingPermissionChange | null>(null);
  const activeSession = liveSession ?? currentSession;
  const activeSessionRef = useRef(activeSession);
  activeSessionRef.current = activeSession;
  const multiAgentRoomUiAvailable = isMultiAgentRoomUiAvailable(activeSession, multiAgentRoomUiEnabled);
  const activeRoomAgents = activeSession?.collaboration?.agents.filter((agent) => !agent.removedAt) ?? [];
  const selectedRoomAgentIds = activeSession?.collaboration
    ? Array.from(new Set(activeSession.collaboration.defaultRecipientIds.filter((id) => activeRoomAgents.some((agent) => agent.id === id))))
    : [];
  const selectedRoomAgents = selectedRoomAgentIds
    .map((id) => activeRoomAgents.find((agent) => agent.id === id))
    .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent));
  let roomContextTargetAgentIds = selectedRoomAgentIds;
  if (activeSession?.collaboration && input.trim()) {
    try {
      roomContextTargetAgentIds = resolveRoomPromptRoute(
        activeSession,
        input.trim(),
        activeSession.collaboration.defaultRecipientIds,
      ).recipientAgentIds;
    } catch {
      roomContextTargetAgentIds = selectedRoomAgentIds;
    }
  }
  const activeRoomBusy = Boolean(activeSession?.collaboration && roomHasActiveAgentWork(
    activeSession,
    Object.values(roomAgentActivities),
  ));
  const activeRoomExecuting = Boolean(activeSession?.collaboration && roomHasExecutingAgentWork(
    activeSession,
    Object.values(roomAgentActivities),
  ));
  const roomStopTargets = activeSession?.collaboration
    ? getRoomAgentControlTargets(activeSession, Object.values(roomAgentActivities), "stop")
    : [];
  const roomSteerTargets = activeSession?.collaboration
    ? getRoomAgentControlTargets(activeSession, Object.values(roomAgentActivities), "steer")
    : [];
  const activeRoomDispatchSignature = activeSession?.collaboration
    ? activeSession.collaboration.messages.flatMap((message) => message.recipientAgentIds.map((agentId) => (
        `${message.id}:${agentId}:${message.deliveries[agentId]?.status ?? "missing"}`
      ))).join("|") + "::" + activeRoomAgents.map((agent) => {
        const activity = roomAgentActivities[roomAgentActivityKey(activeSession.id, agent.id)];
        return `${agent.id}:${activity?.status ?? "idle"}:${agent.runtimeSessionId ?? agent.officialSessionId ?? "none"}`;
      }).join("|")
    : "";
  const roomReadOnly = Boolean(activeSession?.collaboration && !multiAgentRoomUiAvailable);
  let activeMutationOwner: RoomMutationOwner | null = null;
  let mutationOwnerError = "";
  if (activeSession) {
    try {
      activeMutationOwner = resolveRoomMutationOwner(activeSession, activeSession.collaboration ? selectedRoomAgentIds : undefined, permissionMode);
    } catch (error) {
      mutationOwnerError = error instanceof Error ? error.message : String(error);
    }
  }
  const hasUniqueMutationOwner = Boolean(activeMutationOwner);
  const editingRoomAgent = activeSession && editingRoomAgentId
    ? getRoomAgent(activeSession, editingRoomAgentId)
    : undefined;
  const pendingMessages = currentSession
    ? allPendingMessages.filter((msg) => msg.sessionId === currentSession.id)
    : [];
  const activeRuntimeSessionId = activeSession?.collaboration
    ? activeMutationOwner?.runtimeSessionId
    : activeSession ? getRuntimeSessionId(activeSession) : undefined;
  const isCurrentSessionRunning = isSessionRuntimeRunning(activeSession, runningSessionId);
  const isMutationOwnerRunning = activeMutationOwner
    ? isSessionRuntimeRunning(activeMutationOwner.sessionView, runningSessionId)
    : false;
  const isCurrentSessionHandoff = Boolean(activeSession && handoffSessionId === activeSession.id);
  const hasActiveAssistantTurn = activeSession?.collaboration ? activeRoomExecuting : isCurrentSessionRunning;
  const mutationSessionView = activeMutationOwner?.sessionView ?? activeSession ?? undefined;
  const mutationPermissionMode = activeSession?.collaboration
    ? activeMutationOwner?.agent.permissionMode
    : activeSession?.permissionMode ?? permissionMode;
  const mutationPlanMode = activeSession?.collaboration
    ? activeMutationOwner?.agent.planMode ?? defaultPlanMode
    : activeSession?.planMode ?? defaultPlanMode;
  const swarmModeEnabled = displayedSwarmMode(mutationSessionView);
  const swarmModePending = hasPendingSwarmMode(mutationSessionView);
  const canSteerActiveTurn = Boolean(
    activeSession?.collaboration
      ? roomSteerTargets.length > 0
      : activeRuntimeSessionId && isCurrentSessionRunning
  );
  const shouldShowStopButton = activeSession?.collaboration ? roomStopTargets.length > 0 : isCurrentSessionRunning;
  const canUseComposer = Boolean(currentSession || currentProject) && !isCurrentSessionHandoff && !roomReadOnly;
  const canTogglePlanMode = canUseComposer && hasUniqueMutationOwner && !isMutationOwnerRunning;

  useEffect(() => {
    const syncMultiAgentRoomGate = () => {
      const enabled = isMultiAgentRoomUiEnabled();
      setMultiAgentRoomUiEnabled(enabled);
      if (!isMultiAgentRoomUiAvailable(activeSessionRef.current, enabled)) setShowAddRoomAgentDialog(false);
    };
    window.addEventListener(MULTI_AGENT_ROOM_UI_CHANGED_EVENT, syncMultiAgentRoomGate);
    return () => window.removeEventListener(MULTI_AGENT_ROOM_UI_CHANGED_EVENT, syncMultiAgentRoomGate);
  }, []);

  useEffect(() => {
    setRoomContextShareSelection(getDefaultRoomContextSelection());
  }, [activeSession?.id]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (permissionBtnRef.current && !permissionBtnRef.current.contains(e.target as Node)) {
        setShowPermissionMenu(false);
      }
      if (addBtnRef.current && !addBtnRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
      if (roomControlMenuRef.current && !roomControlMenuRef.current.contains(e.target as Node)) {
        setRoomControlRequest(null);
      }
      const insideMore = Object.values(pendingMoreRefs.current).some(
        (el) => el && el.contains(e.target as Node)
      );
      if (!insideMore) setPendingMoreId(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    setRoomControlRequest(null);
  }, [activeSession?.id]);

  useEffect(() => {
    if (!roomControlRequest) return;
    const targetCount = roomControlRequest.action === "stop" ? roomStopTargets.length : roomSteerTargets.length;
    if (targetCount === 0) setRoomControlRequest(null);
  }, [roomControlRequest, roomSteerTargets.length, roomStopTargets.length]);

  useEffect(() => {
    if (focusInputTrigger > 0) inputRef.current?.focus();
  }, [focusInputTrigger]);

  useEffect(() => {
    if (showAddRoomAgentDialog && addRoomAgentTargetId && activeSession?.id !== addRoomAgentTargetId) {
      setShowAddRoomAgentDialog(false);
      setAddRoomAgentTargetId(null);
    }
    if (editingRoomAgentId && activeSession && !getRoomAgent(activeSession, editingRoomAgentId)) {
      setEditingRoomAgentId(null);
    }
  }, [activeSession, addRoomAgentTargetId, editingRoomAgentId, showAddRoomAgentDialog]);

  useEffect(() => {
    const handleAddDrawingImage = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; dataUrl?: string }>).detail;
      if (!detail?.dataUrl?.startsWith("data:image/")) return;
      setImageAttachments((prev) => [
        ...prev,
        {
          id: genId(),
          name: detail.name?.trim() || "画板图片.png",
          dataUrl: detail.dataUrl,
        },
      ]);
      inputRef.current?.focus();
    };
    window.addEventListener("kimix:addDrawingImage", handleAddDrawingImage);
    return () => window.removeEventListener("kimix:addDrawingImage", handleAddDrawingImage);
  }, []);

  useEffect(() => {
    const handleRestoreComposerDraft = (event: Event) => {
      const detail = (event as CustomEvent<{
        sessionId?: string;
        content?: string;
        images?: Array<{ id?: string; kind?: "image" | "file"; name: string; dataUrl?: string; filePath?: string }>;
      }>).detail;
      if (!detail?.sessionId || useAppStore.getState().currentSession?.id !== detail.sessionId) return;
      setInput(detail.content ?? "");
      setImageAttachments((detail.images ?? []).map((image) => ({
        id: image.id ?? genId(),
        kind: image.kind,
        name: image.name,
        dataUrl: image.dataUrl,
        filePath: image.filePath,
      })));
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener("kimix:restore-composer-draft", handleRestoreComposerDraft);
    return () => window.removeEventListener("kimix:restore-composer-draft", handleRestoreComposerDraft);
  }, []);

  useEffect(() => {
    if (!currentSession) {
      setSlashCommands([]);
      return;
    }
    setSlashCommands(conservativeSlashCommandItems);
    let cancelled = false;
    const runtimeSessionId = getRuntimeSessionId(currentSession);
    if (!runtimeSessionId) {
      setSlashCommands([]);
      return;
    }
    void window.api.listKimiCodeSlashCommands({ sessionId: runtimeSessionId }).then((res) => {
      if (cancelled) return;
      if (!res.success) {
        console.warn("List slash commands failed:", res.error);
        setSlashCommands([]);
        return;
      }
      setSlashCommands(res.data.map((command) => {
        const isPluginCommand = command.kind === "plugin-command" && command.pluginId && command.commandName;
        return {
          id: isPluginCommand
            ? `plugin-command-${command.pluginId}-${command.commandName}`
            : `slash-${command.name}`,
          label: `/${command.name}`,
          detail: isPluginCommand
            ? `${command.description} · Plugin ${command.pluginId}`
            : command.description,
          insertText: `/${command.name} `,
          commandName: command.name,
          pluginId: isPluginCommand ? command.pluginId : undefined,
          pluginCommandName: isPluginCommand ? command.commandName : undefined,
          kind: isPluginCommand ? "plugin-command" : "slash",
        } satisfies CompletionItem;
      }));
    }).catch((err) => {
      if (cancelled) return;
      console.warn("List slash commands failed:", err);
      setSlashCommands([]);
    });
    return () => {
      cancelled = true;
    };
  }, [currentSession?.id, currentSession?.longTask?.activeAgent]);

  const activeCompletion = getActiveCompletion(input);
  const isSkillCompletion = activeCompletion?.mode === "slash" && activeCompletion.query.toLowerCase().startsWith("skill:");
  const skillCompletionQuery = isSkillCompletion ? activeCompletion.query.slice("skill:".length).trim().toLowerCase() : "";
  const slashCompletionSource = slashCommands.length > 0 ? slashCommands : conservativeSlashCommandItems;
  const filteredSkillItems = isSkillCompletion
    ? skillItems.filter((item) => {
        if (!skillCompletionQuery) return true;
        return item.label.toLowerCase().includes(skillCompletionQuery) ||
          item.detail?.toLowerCase().includes(skillCompletionQuery);
      })
    : [];
  const filteredSlashItems = activeCompletion?.mode === "slash"
    ? isSkillCompletion
      ? filteredSkillItems
      : slashCompletionSource.filter((item) => {
        const rawQuery = activeCompletion.query.toLowerCase().trimStart();
        const query = rawQuery.replace(/\s+/g, " ");
        const commandText = item.label.replace(/^\//, "").toLowerCase().replace(/\s+/g, " ");
        const detail = item.detail?.toLowerCase() ?? "";
        const isSecondaryCommand = commandText.includes(" ");
        const wantsSecondaryCommand = /\s/.test(rawQuery);
        if (!wantsSecondaryCommand) {
          return !isSecondaryCommand && (commandText.includes(query) || detail.includes(query));
        }
        const rootCommand = query.trimStart().split(" ")[0] ?? "";
        if (!isSecondaryCommand) return false;
        if (!rootCommand || !commandText.startsWith(`${rootCommand} `)) return false;
        const subcommandQuery = query.slice(rootCommand.length).trimStart();
        if (!subcommandQuery) return true;
        return commandText.includes(`${rootCommand} ${subcommandQuery}`) || detail.includes(subcommandQuery);
      })
    : [];
  const roomAwareMentionBaseItems = activeSession?.collaboration
    ? [
        ...activeRoomAgents
          .filter((agent) => !agent.archivedAt && !agent.provisioningError && !agent.recoveryIssue)
          .map((agent): CompletionItem => ({
            id: `room-agent-${agent.id}`,
            label: agent.displayName,
            detail: `@${agent.mentionName} · ${agent.modelLabelSnapshot || agent.modelAlias || "模型未知"}`,
            insertText: `@${agent.mentionName} `,
            kind: "agent",
          })),
        ...mentionBaseItems.filter((item) => item.kind !== "agent"),
      ]
    : mentionBaseItems;
  const filteredMentionBaseItems = activeCompletion?.mode === "mention"
    ? roomAwareMentionBaseItems.filter((item) => {
        const query = activeCompletion.query.toLowerCase();
        return item.label.toLowerCase().includes(query) || item.detail?.toLowerCase().includes(query);
      })
    : [];
  const completionItems = activeCompletion?.mode === "slash"
    ? filteredSlashItems
    : activeCompletion?.mode === "mention"
      ? [...filteredMentionBaseItems, ...fileItems]
      : [];
  const shouldShowCompletionPanel = Boolean(
    activeCompletion && (
      activeCompletion.mode === "mention" ||
      completionItems.length > 0 ||
      slashCompletionSource.length === 0
    ),
  );

  useEffect(() => {
    setActiveCompletionIndex(0);
  }, [activeCompletion?.mode, activeCompletion?.query]);

  useEffect(() => {
    let cancelled = false;
    const byName = new Map<string, CompletionItem>();
    const pushSkill = (source: string, name: string, description?: string, sourceLabel?: string) => {
      const normalized = name.trim();
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (byName.has(key)) return;
      const detail = [description?.trim(), sourceLabel?.trim()].filter(Boolean).join(" · ");
      byName.set(key, {
        id: "skill-" + source + "-" + key,
        label: normalized,
        detail: detail || "可通过 /skill 调用",
        insertText: "/skill:" + normalized + " ",
        commandName: "skill",
        kind: "skill",
      });
    };

    const loadSkills = async () => {
      const runtimeSessionId = currentSession ? getRuntimeSessionId(currentSession) : undefined;
      if (runtimeSessionId) {
        const officialRes = await window.api.listKimiCodeSkills({ sessionId: runtimeSessionId });
        if (!cancelled && officialRes.success) {
          officialRes.data.forEach((skill) => {
            pushSkill("official", skill.name, skill.description, skill.source || "官方 Skill");
          });
        }
      }

      const localRes = await window.api.listSkills();
      if (!cancelled && localRes.success) {
        localRes.data.skills.forEach((skill) => {
          pushSkill("local", skill.name, skill.description, skill.sourceLabel || skill.source);
        });
      }

      if (!cancelled) {
        setSkillItems(Array.from(byName.values()).sort((left, right) => left.label.localeCompare(right.label)));
      }
    };

    void loadSkills().catch((err) => {
      if (cancelled) return;
      console.warn("List skills failed:", err);
      setSkillItems([]);
    });

    return () => {
      cancelled = true;
    };
  }, [currentSession?.id, currentSession?.runtimeSessionId, currentSession?.officialSessionId]);

  useEffect(() => {
    if (!activeCompletion || completionItems.length === 0) return;
    const activeItem = completionItems[activeCompletionIndex] ?? completionItems[0];
    const activeNode = activeItem ? completionItemRefs.current[activeItem.id] : null;
    activeNode?.scrollIntoView({ block: "nearest" });
  }, [activeCompletion, activeCompletionIndex, completionItems]);

  useEffect(() => {
    if (activeCompletion?.mode !== "mention" || !currentProject) {
      setFileItems([]);
      return;
    }
    let cancelled = false;
    const query = activeCompletion.query;
    const timer = window.setTimeout(() => {
      void window.api.searchProjectFiles({
        projectPath: currentProject.path,
        sessionId: activeRuntimeSessionId,
        additionalWorkDirs: normalizeAdditionalWorkDirs(additionalWorkDirs),
        query,
        limit: 12,
      }).then((res) => {
        if (cancelled || !res.success) return;
        setFileItems(res.data.map((file) => ({
          id: `file-${file.path}`,
          label: file.name,
          detail: file.sourceLabel && file.rootPath ? `${file.path} · ${file.sourceLabel}` : file.path,
          insertText: `@${file.path} `,
          kind: "file",
        })));
      });
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeCompletion?.mode, activeCompletion?.query, activeRuntimeSessionId, additionalWorkDirs, currentProject?.path]);

  const addImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    const currentImages = imageAttachments.filter(isImageAttachment);
    const currentCount = currentImages.length;
    const currentSize = currentImages.reduce((sum, image) => sum + (image.dataUrl?.length ?? 0) * 0.75, 0);

    if (currentCount + imageFiles.length > MAX_IMAGE_ATTACHMENTS) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `最多只能附加 ${MAX_IMAGE_ATTACHMENTS} 张图片，当前已有 ${currentCount} 张。`,
      }));
      return;
    }

    const oversized = imageFiles.filter((file) => file.size > MAX_SINGLE_IMAGE_SIZE_BYTES);
    if (oversized.length > 0) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `单张图片不能超过 ${MAX_SINGLE_IMAGE_SIZE_BYTES / 1024 / 1024}MB，有 ${oversized.length} 张图片超出限制。`,
      }));
      return;
    }

    const batchTotal = imageFiles.reduce((sum, file) => sum + file.size, 0);
    if (currentSize + batchTotal > MAX_TOTAL_IMAGE_SIZE_BYTES) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `图片总大小不能超过 ${MAX_TOTAL_IMAGE_SIZE_BYTES / 1024 / 1024}MB。`,
      }));
      return;
    }

    const attachments: ImageAttachment[] = [];
    for (let i = 0; i < imageFiles.length; i += MAX_CONCURRENT_IMAGE_READS) {
      const batch = imageFiles.slice(i, i + MAX_CONCURRENT_IMAGE_READS);
      const batchAttachments = await Promise.all(
        batch.map((file) => new Promise<ImageAttachment>((resolve, reject) => {
          const filePath = getDraggedFilePath(file);
          const reader = new FileReader();
          reader.onload = () => resolve({
            id: genId(),
            kind: "image",
            name: file.name || filePath.split(/[\/]/).pop() || "粘贴图片",
            dataUrl: String(reader.result),
            filePath,
          });
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        })),
      );
      attachments.push(...batchAttachments);
    }
    setImageAttachments((prev) => [...prev, ...attachments]);
  };

  const getDraggedFilePath = (file: File) => {
    const electronPath = typeof window.api.getDraggedFilePath === "function"
      ? window.api.getDraggedFilePath(file)
      : "";
    if (electronPath) return electronPath;
    return typeof (file as { path?: unknown }).path === "string" ? (file as { path: string }).path : "";
  };

  const addFileAttachments = (files: File[]) => {
    const attachments = files.map((file) => {
      const filePath = getDraggedFilePath(file);
      return {
        id: genId(),
        kind: "file" as const,
        name: file.name || filePath.split(/[\\/]/).pop() || "附件文件",
        filePath,
      };
    });
    setImageAttachments((prev) => [...prev, ...attachments]);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    void addImageFiles(files);
  };

  const openBlankDrawingBoard = (ratio: DrawingBoardRequest["ratio"]) => {
    setDrawingBoardRequest({ ratio });
    setShowAddMenu(false);
  };

  const handleSaveDrawingBoard = (image: { name: string; dataUrl: string; sourceId?: string }) => {
    const attachment: ImageAttachment = {
      id: genId(),
      kind: "image",
      name: image.name,
      dataUrl: image.dataUrl,
    };
    setImageAttachments((prev) => {
      if (!image.sourceId) return [...prev, attachment];
      const sourceIndex = prev.findIndex((item) => item.id === image.sourceId);
      if (sourceIndex < 0) return [...prev, attachment];
      return [
        ...prev.slice(0, sourceIndex + 1),
        attachment,
        ...prev.slice(sourceIndex + 1),
      ];
    });
    setDrawingBoardRequest(null);
  };

  const syncCurrentSessionFromStore = (sessionId: string) => {
    const latest = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
    if (latest && useAppStore.getState().currentSession?.id === sessionId) {
      setCurrentSession(latest);
    }
    return latest;
  };

  const ensureSession = async (): Promise<Session | null> => {
    if (currentSession) {
      return useSessionStore.getState().sessions.find((session) => session.id === currentSession.id) ?? currentSession;
    }
    if (!currentProject) return null;
    const model = await getDefaultKimiModel();
    // Kimi Code 主链路：仅创建本地会话对象，真实官方 session 延迟到首条消息发送时再创建。
    const session: Session = {
      id: genId(),
      engine: "kimi-code" as const,
      model,
      permissionMode,
      planMode: defaultPlanMode,
      title: "新会话",
      projectPath: currentProject.path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      events: [],
      isLoading: false,
    };
    addSession(session);
    setCurrentSession(session);
    return session;
  };

  const resumeRoomAgentForPrompt = async (roomId: string, roomAgentId: string) => {
    const latest = useSessionStore.getState().sessions.find((session) => session.id === roomId);
    if (!latest) throw new Error("房间会话不存在");
    const agent = getRoomAgent(latest, roomAgentId);
    if (!agent) throw new Error("目标 Agent 不存在");
    if (!roomAgentCanResume(latest, roomAgentId)) {
      throw new Error(agent.recoveryIssue?.message ?? "目标 Agent 当前不可用");
    }
    const resumed = await resumeRoomAgentRuntime({
      session: latest,
      roomAgentId,
      additionalWorkDirs: normalizeAdditionalWorkDirs(additionalWorkDirs),
      resume: (request) => window.api.resumeKimiCodeSession(request),
    });
    if (!resumed.success) throw new Error(resumed.error);
    updateSession(roomId, (session) => bindRecoveredRoomAgentRuntime(session, roomAgentId, {
      sessionId: resumed.data.sessionId,
      model: resumed.data.model,
    }));
    syncCurrentSessionFromStore(roomId);
    const persisted = await persistLocalConversationState();
    if (!persisted.success) throw new Error(`保存 Agent runtime 绑定失败：${persisted.error}`);
    return resumed.data.sessionId;
  };

  const dispatchRoomDeliveryTarget = async (roomId: string, roomMessageId: string, roomAgentId: string) => {
    const dispatchKey = `${roomId}:${roomAgentId}`;
    if (roomDispatchingRef.current.has(dispatchKey)) return;
    roomDispatchingRef.current.add(dispatchKey);
    try {
      const initial = useSessionStore.getState().sessions.find((session) => session.id === roomId);
      const message = initial?.collaboration?.messages.find((candidate) => candidate.id === roomMessageId);
      const agent = initial ? getRoomAgent(initial, roomAgentId) : undefined;
      if (!initial || !message || !agent) return;
      let runtimeSessionId = agent.runtimeSessionId ?? agent.officialSessionId;
      const promptImages = (message.images ?? [])
        .filter((image): image is typeof image & { dataUrl: string } => Boolean(image.dataUrl))
        .map((image) => ({ name: image.name, dataUrl: image.dataUrl }));
      const result = await dispatchQueuedRoomDelivery({
        roomMessageId,
        roomAgentId,
        getSession: () => useSessionStore.getState().sessions.find((session) => session.id === roomId) ?? initial,
        setSession: (next) => {
          updateSession(roomId, () => next);
          syncCurrentSessionFromStore(roomId);
        },
        persist: async () => persistLocalConversationState(),
        send: async ({ delivery }) => {
          if (!runtimeSessionId) {
            try {
              runtimeSessionId = await resumeRoomAgentForPrompt(roomId, roomAgentId);
            } catch (error) {
              return { success: false as const, certainty: "not-sent" as const, error: error instanceof Error ? error.message : String(error) };
            }
          }
          setRoomAgentActivity({
            roomId,
            roomAgentId,
            runtimeSessionId,
            status: "sending",
            roomMessageId,
            activeTurnId: delivery.agentTurnId,
            startedAt: Date.now(),
            updatedAt: Date.now(),
          });
          const outboundPrompt = buildRoomDeliveryPrompt(
            message.outboundContent ?? message.content,
            delivery.contextShare,
            {
              displayName: agent.displayName,
              mentionName: agent.mentionName,
            },
          );
          let response = await sendKimiCodePromptWithRetry({
            sessionId: runtimeSessionId,
            content: outboundPrompt,
            images: promptImages,
          });
          if (!response.success && /not active|not found|session/i.test(response.error)) {
            try {
              runtimeSessionId = await resumeRoomAgentForPrompt(roomId, roomAgentId);
            } catch (error) {
              return { success: false as const, certainty: "not-sent" as const, error: error instanceof Error ? error.message : String(error) };
            }
            setRoomAgentActivity({
              roomId,
              roomAgentId,
              runtimeSessionId,
              status: "sending",
              roomMessageId,
              activeTurnId: delivery.agentTurnId,
              startedAt: Date.now(),
              updatedAt: Date.now(),
            });
            response = await sendKimiCodePromptWithRetry({
              sessionId: runtimeSessionId,
              content: outboundPrompt,
              images: promptImages,
            });
          }
          if (!response.success) {
            return {
              success: false as const,
              certainty: isKimiActiveTurnError(response.error) || /not active|not found/i.test(response.error)
                ? "not-sent" as const
                : "unknown" as const,
              error: response.error,
            };
          }
          window.dispatchEvent(new CustomEvent("kimix:toast", {
            detail: `${agent.displayName} · ${kimiCodeRouteStatus(response.data.route)}`,
          }));
          return { success: true as const };
        },
      });
      if (!result.success) {
        const latest = useSessionStore.getState().sessions.find((session) => session.id === roomId);
        const delivery = latest?.collaboration?.messages.find((candidate) => candidate.id === roomMessageId)?.deliveries[roomAgentId];
        if (delivery?.status === "queued") {
          setRoomAgentActivity({
            roomId,
            roomAgentId,
            runtimeSessionId,
            status: "queued",
            roomMessageId,
            activeTurnId: delivery.agentTurnId,
            updatedAt: Date.now(),
          });
        } else {
          setRoomAgentActivity({
            roomId,
            roomAgentId,
            runtimeSessionId,
            status: "error",
            roomMessageId,
            activeTurnId: delivery?.agentTurnId,
            updatedAt: Date.now(),
          });
        }
        window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `发送给 ${agent.displayName} 失败：${result.error}` }));
      }
    } finally {
      roomDispatchingRef.current.delete(dispatchKey);
    }
  };

  const dispatchAvailableRoomDeliveries = async (roomId: string) => {
    const latest = useSessionStore.getState().sessions.find((session) => session.id === roomId);
    if (!latest?.collaboration) return;
    const targets = getDispatchableRoomDeliveries(latest, Object.values(useAppStore.getState().roomAgentActivities))
      .filter((target) => !roomDispatchingRef.current.has(`${roomId}:${target.roomAgentId}`));
    await Promise.all(targets.map((target) => dispatchRoomDeliveryTarget(roomId, target.roomMessageId, target.roomAgentId)));
  };

  const sendRoomPrompt = async (
    session: Session,
    content: string,
    options?: { images?: ImageAttachment[]; manualSubmitAutoScroll?: boolean; outboundContent?: string },
  ) => {
    const images = options?.images ?? [];
    const route = resolveRoomPromptRoute(session, content, session.collaboration?.defaultRecipientIds);
    const recipients = route.recipientAgentIds.map((id) => getRoomAgent(session, id));
    const unavailable = recipients.find((agent) => !agent || agent.provisioningError || agent.recoveryIssue || agent.archivedAt || agent.removedAt);
    if (unavailable) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: unavailable?.provisioningError || unavailable?.recoveryIssue?.message || "至少一个目标 Agent 当前不可用。",
      }));
      return false;
    }
    if (!route.outboundContent.trim() && images.length === 0) {
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: "请在 @Agent 之后输入要处理的任务。" }));
      return false;
    }
    const contentWithAttachments = buildAttachmentPromptContent(options?.outboundContent ?? route.outboundContent, images);
    let created: ReturnType<typeof createRoomMessageDispatch>;
    try {
      created = createRoomMessageDispatch(session, {
        content,
        outboundContent: contentWithAttachments,
        images: toUserAttachments(images),
        recipientAgentIds: route.recipientAgentIds,
        contextShareSelection: roomContextShareSelection,
      });
    } catch (error) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
    updateSession(session.id, () => created.session);
    syncCurrentSessionFromStore(session.id);
    if (options?.manualSubmitAutoScroll !== false) {
      window.dispatchEvent(new CustomEvent("kimix:user-message-submitted", { detail: { sessionId: session.id } }));
    }
    await dispatchAvailableRoomDeliveries(session.id);
    setRoomContextShareSelection(getDefaultRoomContextSelection());
    return true;
  };

  useEffect(() => {
    if (!multiAgentRoomUiAvailable || !activeSession?.collaboration) return;
    void dispatchAvailableRoomDeliveries(activeSession.id);
  }, [activeRoomDispatchSignature, activeSession?.id, multiAgentRoomUiAvailable]);

  useEffect(() => {
    const handleRoomDeliveryAction = (event: Event) => {
      const detail = (event as CustomEvent<{
        action?: "cancel" | "retry";
        sessionId?: string;
        roomMessageId?: string;
        roomAgentId?: string;
      }>).detail;
      if (!detail?.action || !detail.sessionId || !detail.roomMessageId || !detail.roomAgentId) return;
      void (async () => {
        const previous = useSessionStore.getState().sessions.find((session) => session.id === detail.sessionId);
        if (!previous?.collaboration) return;
        try {
          const next = detail.action === "cancel"
            ? cancelQueuedRoomDelivery(previous, detail.roomMessageId!, detail.roomAgentId!)
            : retryRoomDelivery(previous, detail.roomMessageId!, detail.roomAgentId!);
          updateSession(previous.id, () => next);
          const activity = useAppStore.getState().roomAgentActivities[roomAgentActivityKey(previous.id, detail.roomAgentId!)];
          if (!activity || activity.roomMessageId === detail.roomMessageId) {
            removeRoomAgentActivity(previous.id, detail.roomAgentId!);
          }
          syncCurrentSessionFromStore(previous.id);
          const persisted = await persistLocalConversationState();
          if (!persisted.success) {
            updateSession(previous.id, () => previous);
            syncCurrentSessionFromStore(previous.id);
            await persistLocalConversationState();
            throw new Error(persisted.error);
          }
          if (detail.action === "retry") await dispatchAvailableRoomDeliveries(previous.id);
        } catch (error) {
          window.dispatchEvent(new CustomEvent("kimix:toast", {
            detail: `${detail.action === "retry" ? "重试" : "取消排队"}失败：${error instanceof Error ? error.message : String(error)}`,
          }));
        }
      })();
    };
    window.addEventListener("kimix:room-delivery-action", handleRoomDeliveryAction);
    return () => window.removeEventListener("kimix:room-delivery-action", handleRoomDeliveryAction);
  }, [removeRoomAgentActivity, updateSession]);

  const sendPromptContent = async (content: string, options?: { addUserEvent?: boolean; manualSubmitAutoScroll?: boolean; images?: ImageAttachment[]; outboundContent?: string; postUserStatusMessage?: string }) => {
    const ensuredSession = await ensureSession();
    if (!ensuredSession) return false;
    let targetSession = ensuredSession;
    const images = options?.images ?? [];
    if (targetSession.collaboration) {
      return sendRoomPrompt(targetSession, content, {
        images,
        manualSubmitAutoScroll: options?.manualSubmitAutoScroll,
        outboundContent: options?.outboundContent,
      });
    }

    const userEvent: TimelineEvent = {
      id: genId(),
      type: "user_message",
      timestamp: Date.now(),
      content,
      images: toUserAttachments(images),
    };
    const responsePlaceholder: TimelineEvent = {
      id: genId(),
      type: "assistant_message",
      timestamp: Date.now(),
      content: "",
      isThinking: defaultThinking,
      isComplete: false,
    };
    const postUserStatusEvent: TimelineEvent | null = options?.postUserStatusMessage
      ? {
          id: genId(),
          type: "status_update",
          timestamp: Date.now(),
          message: options.postUserStatusMessage,
          source: "slash",
          tone: "info",
          parentEventId: userEvent.id,
        }
      : null;
    const linkStatusEvent: TimelineEvent = {
      id: genId(),
      type: "status_update",
      timestamp: Date.now(),
      message: "消息发送中",
      source: "ipc",
      tone: "info",
      parentEventId: userEvent.id,
    };

    const shouldAddUserEvent = options?.addUserEvent !== false;
    updateSession(targetSession.id, (session) => ({
      ...session,
      events: [
        ...session.events,
        ...(shouldAddUserEvent ? [userEvent] : []),
        ...(postUserStatusEvent ? [postUserStatusEvent] : []),
        linkStatusEvent,
        responsePlaceholder,
      ],
      title: session.title,
      updatedAt: Date.now(),
    }));
    if (shouldAddUserEvent && options?.manualSubmitAutoScroll !== false) {
      window.dispatchEvent(new CustomEvent("kimix:user-message-submitted", {
        detail: { sessionId: targetSession.id },
      }));
    }
    targetSession = syncCurrentSessionFromStore(targetSession.id) ?? targetSession;

    const effectiveEngine = "kimi-code";
    const contentWithAttachments = buildAttachmentPromptContent(content, images);
    const outboundContent = options?.outboundContent ?? contentWithAttachments;
    setRunningSessionId(targetSession.id);
    if (effectiveEngine === "kimi-code") {
      const imagesForApi = toPromptImages(images);
      const sameWorkDir = (a?: string, b?: string) => isSamePath(a, b);
      const updateLinkStatus = (message: string, tone: Extract<TimelineEvent, { type: "status_update" }>["tone"] = "info") => {
        const timestamp = Date.now();
        updateSession(targetSession.id, (session) => ({
          ...session,
          events: session.events.map((event) => event.id === linkStatusEvent.id
            ? { ...event, timestamp, message, tone }
            : event
          ),
          updatedAt: timestamp,
        }));
        targetSession = syncCurrentSessionFromStore(targetSession.id) ?? targetSession;
      };

      const ensureKimiCodeRuntime = async () => {
        const applyDesiredSwarmMode = async (runtimeSessionId: string) => {
          const desired = targetSession.swarmModeDesired ?? (
            targetSession.swarmModeLockedAt && targetSession.swarmMode === undefined ? true : undefined
          );
          if (desired === undefined) return;
          const res = await window.api.swarmKimiCode({
            sessionId: runtimeSessionId,
            enabled: desired,
            trigger: "manual",
          });
          if (!res.success) throw new Error(`应用 Swarm 模式失败：${res.error}`);
          const timestamp = Date.now();
          updateSession(targetSession.id, (session) => ({
            ...session,
            swarmMode: desired,
            swarmModeDesired: undefined,
            swarmModeLockedAt: desired ? session.swarmModeLockedAt ?? timestamp : session.swarmModeLockedAt,
          }));
          targetSession = syncCurrentSessionFromStore(targetSession.id) ?? targetSession;
        };
        const primaryAgentId = getPrimaryRoomAgent(targetSession).id;
        const recoveryTarget = getPrimaryRecoveryTarget(targetSession);
        if (!roomAgentCanResume(targetSession, primaryAgentId)) {
          const issue = getPrimaryRoomAgent(targetSession).recoveryIssue;
          throw new Error(issue?.message ?? "当前 Agent 暂时不可恢复");
        }
        if (recoveryTarget.sessionIds.length > 0) {
          updateLinkStatus("消息发送中", "info");
          const resumeRes = await resumeRoomAgentRuntime({
            session: targetSession,
            roomAgentId: primaryAgentId,
            additionalWorkDirs: normalizeAdditionalWorkDirs(additionalWorkDirs),
            resume: (request) => window.api.resumeKimiCodeSession(request),
          });
          // Only adopt the resumed runtime when it points at this project's
          // workDir. A stale binding to the plugin-management temp session would
          // otherwise make the assistant run against the wrong directory; drop it
          // and fall through to create a fresh session at projectPath.
          if (resumeRes.success && (!targetSession.projectPath || sameWorkDir(resumeRes.data.workDir, targetSession.projectPath))) {
            const model = resolveResumedSessionModel({
              resumedModel: resumeRes.data.model,
              sessionModel: getPrimaryRoomAgent(targetSession).modelAlias,
              switchedToModel: getPrimaryRoomAgent(targetSession).switchedToModel,
              modelSwitchedAt: getPrimaryRoomAgent(targetSession).modelSwitchedAt,
            }) ?? await getDefaultKimiModel();
            targetSession = bindRecoveredRoomAgentRuntime(targetSession, primaryAgentId, {
              sessionId: resumeRes.data.sessionId,
              model,
            });
            targetSession = {
              ...targetSession,
              engine: "kimi-code",
            };
            updateSession(targetSession.id, () => targetSession);
            targetSession = syncCurrentSessionFromStore(targetSession.id) ?? targetSession;
            // Re-apply the current UI permission mode so a resumed session honours
            // full-access (yolo) instead of keeping its persisted permission.
            const latestPermissionMode = useAppStore.getState().permissionMode;
            const permissionRes = await window.api.setKimiCodePermission({
              sessionId: resumeRes.data.sessionId,
              mode: latestPermissionMode,
            });
            if (!permissionRes.success) {
              throw new Error(`应用权限模式失败：${permissionRes.error}`);
            }
            updateLinkStatus("消息发送中", "info");
            await applyDesiredSwarmMode(resumeRes.data.sessionId);
            return resumeRes.data.sessionId;
          }
          updateLinkStatus("消息发送中", "info");
        } else {
          updateLinkStatus("消息发送中", "info");
        }

        const createRes = await window.api.createKimiCodeSession({
          workDir: targetSession.projectPath,
          model: targetSession.switchedToModel ?? targetSession.model ?? undefined,
          permission: permissionMode,
          planMode: defaultPlanMode,
          additionalWorkDirs: normalizeAdditionalWorkDirs(additionalWorkDirs),
        });
        if (!createRes.success) throw new Error(createRes.error);
        const model = createRes.data.model ?? getPrimaryRoomAgent(targetSession).modelAlias ?? await getDefaultKimiModel();
        targetSession = bindRecoveredRoomAgentRuntime(targetSession, primaryAgentId, {
          sessionId: createRes.data.sessionId,
          model,
        });
        targetSession = {
          ...targetSession,
          engine: "kimi-code",
        };
        updateSession(targetSession.id, () => targetSession);
        targetSession = syncCurrentSessionFromStore(targetSession.id) ?? targetSession;
        updateLinkStatus("消息发送中", "info");
        await applyDesiredSwarmMode(createRes.data.sessionId);
        return createRes.data.sessionId;
      };

      try {
        let kimiCodeSessionId = await ensureKimiCodeRuntime();
        const markPromptDispatchStarted = () => {
          const startedAt = Date.now();
          updateSession(targetSession.id, (session) => ({
            ...session,
            events: session.events.map((event) => event.id === responsePlaceholder.id
              ? { ...event, timestamp: startedAt }
              : event
            ),
            updatedAt: startedAt,
          }));
          targetSession = syncCurrentSessionFromStore(targetSession.id) ?? targetSession;
        };
        updateLinkStatus("消息发送中", "info");
        markPromptDispatchStarted();
        let res = await sendKimiCodePromptWithRetry({
          sessionId: kimiCodeSessionId,
          content: outboundContent,
          images: imagesForApi,
        });
        if (!res.success && /not active|not found|session/i.test(res.error)) {
          updateSession(targetSession.id, (session) => ({ ...session, runtimeSessionId: undefined }));
          targetSession = { ...targetSession, runtimeSessionId: undefined };
          kimiCodeSessionId = await ensureKimiCodeRuntime();
          markPromptDispatchStarted();
          res = await sendKimiCodePromptWithRetry({
            sessionId: kimiCodeSessionId,
            content: outboundContent,
            images: imagesForApi,
          });
        }
        if (!res.success) throw new Error(res.error);
        updateLinkStatus(kimiCodeRouteStatus(res.data.route), "success");
        return true;
      } catch (err) {
        console.error("Kimi Code send failed:", err);
        const message = err instanceof Error ? err.message : String(err);
        if (isKimiActiveTurnError(message)) {
          const afterEvents = removeLocalSendAttempt(targetSession.events, userEvent.id, responsePlaceholder.id, shouldAddUserEvent);
          setRunningSessionId(targetSession.id);
          updateSession(targetSession.id, (session) => ({
            ...session,
            events: afterEvents,
            updatedAt: Date.now(),
          }));
          targetSession = syncCurrentSessionFromStore(targetSession.id) ?? targetSession;
          window.dispatchEvent(new CustomEvent("kimix:toast", {
            detail: "上一轮仍在运行，请等待或停止后再发送。",
          }));
          return false;
        }
        setRunningSessionId(null);
        updateSession(targetSession.id, (session) => ({
          ...session,
          events: [
            ...session.events.map((event) => event.type === "assistant_message" && !event.isComplete
              ? { ...event, isComplete: true, isThinking: false }
              : event
            ),
            {
              id: genId(),
              type: "error",
              timestamp: Date.now(),
              message,
              source: "ipc",
            },
          ],
          updatedAt: Date.now(),
        }));
        return false;
      }
    }
    return false;
  };

  const settlePendingClarifications = (sessionId: string, roomAgentId?: string, status: "skipped" | "answered" = "skipped") => {
    updateSession(sessionId, (session) => {
      const updateEvents = (events: TimelineEvent[]) => events.map((event) => (
        event.type === "question_request" && event.status === "pending"
          ? { ...event, status, answers: event.answers ?? {} }
          : event
      ));
      const next = roomAgentId
        ? updateRoomAgentEvents(session, roomAgentId, updateEvents)
        : { ...session, events: updateEvents(session.events) };
      return { ...next, updatedAt: Date.now() };
    });
  };

  const appendLocalEvent = async (event: TimelineEvent, roomAgentId?: string) => {
    const targetSession = await ensureSession();
    if (!targetSession) return null;
    updateSession(targetSession.id, (session) => {
      const next = roomAgentId
        ? appendRoomMutationEvent(session, roomAgentId, event)
        : { ...session, events: [...session.events, event] };
      return { ...next, updatedAt: Date.now() };
    });
    return syncCurrentSessionFromStore(targetSession.id) ?? targetSession;
  };

  const appendStatusMessage = async (message: string, roomAgentId?: string) => {
    await appendLocalEvent({
      id: genId(),
      type: "status_update",
      timestamp: Date.now(),
      message,
    }, roomAgentId);
  };

  const appendSlashUserMessage = async (command: string, roomAgentId?: string) => {
    const targetSession = await ensureSession();
    if (!targetSession) return;
    const timestamp = Date.now();
    const ownerEvents = roomAgentId && targetSession.collaboration
      ? targetSession.collaboration.agentEvents[roomAgentId] ?? []
      : targetSession.events;
    const latestMatchingCommand = ownerEvents.findLast((event) => (
      event.type === "user_message" &&
      event.content.trim() === command.trim() &&
      Math.abs(timestamp - event.timestamp) <= 10_000
    ));
    if (latestMatchingCommand) return;
    await appendLocalEvent({
      id: genId(),
      type: "user_message",
      timestamp,
      content: command,
    }, roomAgentId);
    window.dispatchEvent(new CustomEvent("kimix:user-message-submitted", {
      detail: { sessionId: targetSession.id },
    }));
  };

  const appendAssistantNotice = async (content: string, roomAgentId?: string) => {
    await appendLocalEvent({
      id: genId(),
      type: "assistant_message",
      timestamp: Date.now(),
      content,
      isThinking: false,
      isComplete: true,
      durationMs: 0,
    }, roomAgentId);
  };

  const recordAppliedSwarmMode = (uiSessionId: string, roomAgentId: string, enabled: boolean) => {
    const timestamp = Date.now();
    updateSession(uiSessionId, (session) => ({
      ...updateRoomMutationOwner(session, roomAgentId, (agent) => ({
        ...agent,
        swarmModeLockedAt: enabled ? agent.swarmModeLockedAt ?? timestamp : agent.swarmModeLockedAt,
        swarmMode: enabled,
        swarmModeDesired: undefined,
      }), permissionMode),
      updatedAt: timestamp,
    }));
    const updated = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (updated && useAppStore.getState().currentSession?.id === uiSessionId) {
      setCurrentSession(updated);
    }
  };

  const ensureOfficialRuntimeForSession = async (explicitRoomAgentId?: string) => {
    const targetSession = await ensureSession();
    if (!targetSession) return null;
    let owner: RoomMutationOwner;
    try {
      owner = resolveRoomMutationOwner(
        targetSession,
        explicitRoomAgentId ? [explicitRoomAgentId] : targetSession.collaboration?.defaultRecipientIds,
        permissionMode,
      );
    } catch (error) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: error instanceof Error ? error.message : String(error),
      }));
      return null;
    }
    if (!roomAgentCanResume(targetSession, owner.roomAgentId)) {
      throw new Error(owner.agent.recoveryIssue?.message ?? `Agent“${owner.displayName}”暂时不可恢复`);
    }
    if (owner.agent.runtimeSessionId || owner.agent.officialSessionId) {
      const resumeRes = await resumeRoomAgentRuntime({
        session: targetSession,
        roomAgentId: owner.roomAgentId,
        additionalWorkDirs: normalizeAdditionalWorkDirs(additionalWorkDirs),
        resume: (request) => window.api.resumeKimiCodeSession(request),
      });
      if (resumeRes.success) {
        updateSession(targetSession.id, (session) => ({
          ...bindRecoveredRoomAgentRuntime(session, owner.roomAgentId, {
            sessionId: resumeRes.data.sessionId,
            model: resumeRes.data.model,
          }),
          engine: "kimi-code",
        }));
        const updated = useSessionStore.getState().sessions.find((session) => session.id === targetSession.id);
        if (updated && useAppStore.getState().currentSession?.id === targetSession.id) setCurrentSession(updated);
        return {
          uiSessionId: targetSession.id,
          roomAgentId: owner.roomAgentId,
          displayName: owner.displayName,
          runtimeSessionId: resumeRes.data.sessionId,
        };
      }
      if (targetSession.collaboration) throw new Error(`恢复 Agent“${owner.displayName}”失败：${resumeRes.error}`);
    } else if (targetSession.collaboration) {
      throw new Error(`Agent“${owner.displayName}”尚未绑定官方运行会话。`);
    }
    const createRes = await window.api.createKimiCodeSession({
      workDir: targetSession.projectPath,
      model: owner.agent.modelAlias ?? undefined,
      permission: owner.agent.permissionMode,
      planMode: owner.agent.planMode ?? defaultPlanMode,
      additionalWorkDirs: normalizeAdditionalWorkDirs(additionalWorkDirs),
    });
    if (!createRes.success) throw new Error(createRes.error);
    updateSession(targetSession.id, (session) => ({
      ...bindRecoveredRoomAgentRuntime(session, owner.roomAgentId, {
        sessionId: createRes.data.sessionId,
        model: createRes.data.model,
      }),
      engine: "kimi-code",
    }));
    const updated = useSessionStore.getState().sessions.find((session) => session.id === targetSession.id);
    if (updated && useAppStore.getState().currentSession?.id === targetSession.id) setCurrentSession(updated);
    return {
      uiSessionId: targetSession.id,
      roomAgentId: owner.roomAgentId,
      displayName: owner.displayName,
      runtimeSessionId: createRes.data.sessionId,
    };
  };

  const provisionRoomAgent = async (roomId: string, roomAgentId: string) => {
    const latest = useSessionStore.getState().sessions.find((session) => session.id === roomId);
    if (!latest?.collaboration) return { success: false as const, error: "房间会话不存在" };
    const agent = getRoomAgent(latest, roomAgentId);
    if (!agent || agent.removedAt) return { success: false as const, error: "Agent 不存在或已移出" };
    const primarySessionId = getRoomPrimaryMetadataIdentity(latest);
    if (!primarySessionId) return { success: false as const, error: "原会话尚未建立官方身份" };
    setRoomAgentActivity({
      roomId,
      roomAgentId,
      status: "creating",
      updatedAt: Date.now(),
    });
    let response: Awaited<ReturnType<Window["api"]["createKimiCodeSession"]>>;
    try {
      response = await window.api.createKimiCodeSession({
        id: agent.id,
        workDir: latest.projectPath,
        model: agent.modelAlias ?? undefined,
        permission: agent.permissionMode,
        planMode: agent.planMode ?? defaultPlanMode,
        additionalWorkDirs: normalizeAdditionalWorkDirs(additionalWorkDirs),
        roomMetadata: {
          schemaVersion: 1,
          roomId,
          roomAgentId: agent.id,
          primarySessionId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateSession(roomId, (session) => failRoomAgentProvisioning(session, roomAgentId, message));
      syncCurrentSessionFromStore(roomId);
      setRoomAgentActivity({
        roomId,
        roomAgentId,
        status: "error",
        updatedAt: Date.now(),
      });
      await persistLocalConversationState();
      return { success: false as const, error: message };
    }
    if (!response.success) {
      updateSession(roomId, (session) => failRoomAgentProvisioning(session, roomAgentId, response.error));
      syncCurrentSessionFromStore(roomId);
      setRoomAgentActivity({
        roomId,
        roomAgentId,
        status: "error",
        updatedAt: Date.now(),
      });
      await persistLocalConversationState();
      return { success: false as const, error: response.error };
    }
    updateSession(roomId, (session) => bindProvisionedRoomAgent(
      session,
      roomAgentId,
      response.data.sessionId,
      agent.modelAlias,
    ));
    syncCurrentSessionFromStore(roomId);
    setRoomAgentActivity({
      roomId,
      roomAgentId,
      runtimeSessionId: response.data.sessionId,
      status: "idle",
      updatedAt: Date.now(),
    });
    const persisted = await persistLocalConversationState();
    if (!persisted.success) {
      const message = `官方 Agent 已创建，但本地绑定保存失败：${persisted.error}`;
      updateSession(roomId, (session) => failRoomAgentProvisioning(session, roomAgentId, message));
      syncCurrentSessionFromStore(roomId);
      setRoomAgentActivity({
        roomId,
        roomAgentId,
        runtimeSessionId: response.data.sessionId,
        status: "error",
        updatedAt: Date.now(),
      });
      await persistLocalConversationState();
      return { success: false as const, error: message };
    }
    return { success: true as const };
  };

  const handleOpenAddRoomAgent = async () => {
    if (!multiAgentRoomUiAvailable || !canUseComposer || activeRoomBusy) return;
    const target = await ensureSession();
    if (!target) return;
    setShowAddMenu(false);
    setAddRoomAgentError("");
    setAddRoomAgentTargetId(target.id);
    setShowAddRoomAgentDialog(true);
  };

  const handleAddRoomAgent = async (draft: RoomAgentDraft) => {
    setAddRoomAgentBusy(true);
    setAddRoomAgentError("");
    try {
      const primaryRuntime = await ensureOfficialRuntimeForSession(activeSession ? getPrimaryRoomAgent(activeSession).id : undefined);
      if (!primaryRuntime) throw new Error("无法建立原会话 runtime");
      const baseSession = useSessionStore.getState().sessions.find((session) => session.id === primaryRuntime.uiSessionId);
      if (!baseSession) throw new Error("会话不存在");
      const preparedBaseSession = {
        ...baseSession,
        permissionMode: baseSession.permissionMode ?? permissionMode,
        planMode: baseSession.planMode ?? defaultPlanMode,
      };
      const prepared = prepareRoomAgentProvisioning(
        preparedBaseSession,
        { ...draft, planMode: defaultPlanMode },
        Object.values(useAppStore.getState().roomAgentActivities),
      );
      updateSession(baseSession.id, () => prepared.session);
      syncCurrentSessionFromStore(baseSession.id);
      setRoomAgentActivity({
        roomId: baseSession.id,
        roomAgentId: prepared.agent.id,
        status: "creating",
        updatedAt: Date.now(),
      });
      const intentPersisted = await persistLocalConversationState();
      if (!intentPersisted.success) {
        updateSession(baseSession.id, () => baseSession);
        syncCurrentSessionFromStore(baseSession.id);
        removeRoomAgentActivity(baseSession.id, prepared.agent.id);
        await persistLocalConversationState();
        throw new Error(`保存添加意图失败：${intentPersisted.error}`);
      }
      const result = await provisionRoomAgent(baseSession.id, prepared.agent.id);
      setShowAddRoomAgentDialog(false);
      setAddRoomAgentTargetId(null);
      if (!result.success) {
        window.dispatchEvent(new CustomEvent("kimix:toast", {
          detail: `Agent 已保留在房间中，可稍后重试：${result.error}`,
        }));
        return;
      }
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `已添加 ${prepared.agent.displayName}，下一条消息将只发送给它。`,
      }));
    } catch (error) {
      setAddRoomAgentError(error instanceof Error ? error.message : String(error));
    } finally {
      setAddRoomAgentBusy(false);
    }
  };

  const handleRetryRoomAgent = async (roomAgentId: string) => {
    if (!activeSession?.collaboration || roomAgentMutationId) return;
    setRoomAgentMutationId(roomAgentId);
    const agent = getRoomAgent(activeSession, roomAgentId);
    try {
      const result = await provisionRoomAgent(activeSession.id, roomAgentId);
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: result.success
          ? `${agent?.displayName ?? "Agent"} 已恢复。`
          : `${agent?.displayName ?? "Agent"} 重试失败：${result.error}`,
      }));
    } finally {
      setRoomAgentMutationId(null);
    }
  };

  const handleSelectRoomAgents = async (roomAgentIds: string[]) => {
    if (!activeSession?.collaboration || roomAgentIds.length === 0) return;
    const previous = useSessionStore.getState().sessions.find((session) => session.id === activeSession.id);
    if (!previous?.collaboration) return;
    const uniqueIds = Array.from(new Set(roomAgentIds));
    const agents = uniqueIds.map((id) => getRoomAgent(previous, id));
    if (agents.some((agent) => !agent || agent.removedAt || agent.archivedAt || agent.provisioningError || agent.recoveryIssue)) return;
    updateSession(previous.id, (session) => ({
      ...session,
      collaboration: session.collaboration ? {
        ...session.collaboration,
        focusedAgentId: uniqueIds.length === 1 ? uniqueIds[0] : session.collaboration.focusedAgentId,
        defaultRecipientIds: uniqueIds,
      } : session.collaboration,
      updatedAt: Date.now(),
    }));
    syncCurrentSessionFromStore(previous.id);
    const persisted = await persistLocalConversationState();
    if (!persisted.success) {
      updateSession(previous.id, () => previous);
      syncCurrentSessionFromStore(previous.id);
      await persistLocalConversationState();
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `切换接收者失败：${persisted.error}` }));
    }
  };

  const handleEditRoomAgent = (roomAgentId: string) => {
    if (!activeSession?.collaboration || activeRoomBusy || roomAgentMutationId) return;
    setEditRoomAgentError("");
    setEditingRoomAgentId(roomAgentId);
  };

  const handleRenameRoomAgent = async (input: { displayName: string; mentionName: string }) => {
    if (!activeSession?.collaboration || !editingRoomAgentId) return;
    const previous = useSessionStore.getState().sessions.find((session) => session.id === activeSession.id);
    if (!previous) return;
    setEditRoomAgentBusy(true);
    setEditRoomAgentError("");
    try {
      const renamed = renameRoomAgent(
        previous,
        editingRoomAgentId,
        input,
        Object.values(useAppStore.getState().roomAgentActivities),
      );
      updateSession(previous.id, () => renamed);
      syncCurrentSessionFromStore(previous.id);
      const persisted = await persistLocalConversationState();
      if (!persisted.success) {
        updateSession(previous.id, () => previous);
        syncCurrentSessionFromStore(previous.id);
        await persistLocalConversationState();
        throw new Error(persisted.error);
      }
      setEditingRoomAgentId(null);
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: "Agent 名称已更新。" }));
    } catch (error) {
      setEditRoomAgentError(error instanceof Error ? error.message : String(error));
    } finally {
      setEditRoomAgentBusy(false);
    }
  };

  const handleRemoveRoomAgent = async (roomAgentId: string) => {
    if (!activeSession?.collaboration || roomAgentMutationId) return;
    const previous = useSessionStore.getState().sessions.find((session) => session.id === activeSession.id);
    const agent = previous ? getRoomAgent(previous, roomAgentId) : undefined;
    if (!previous || !agent) return;
    if (!window.confirm(`将 ${agent.displayName} 移出房间？它的历史和官方会话会保留为独立会话。`)) return;
    setRoomAgentMutationId(roomAgentId);
    try {
      const detached = detachRoomAgentAsSession(
        previous,
        roomAgentId,
        new Set(useSessionStore.getState().sessions.map((session) => session.id)),
        Date.now(),
        Object.values(useAppStore.getState().roomAgentActivities),
      );
      updateSession(previous.id, () => detached.room);
      addSession(detached.detached);
      removeRoomAgentActivity(previous.id, roomAgentId);
      syncCurrentSessionFromStore(previous.id);
      const persisted = await persistLocalConversationState();
      if (!persisted.success) {
        updateSession(previous.id, () => previous);
        deleteSession(detached.detached.id);
        syncCurrentSessionFromStore(previous.id);
        await persistLocalConversationState();
        throw new Error(persisted.error);
      }
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `${agent.displayName} 已移出房间，并保留为独立会话。`,
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `移出 Agent 失败：${error instanceof Error ? error.message : String(error)}`,
      }));
    } finally {
      setRoomAgentMutationId(null);
    }
  };

  const openRoomAgentModelSettings = () => {
    setShowAddRoomAgentDialog(false);
    setAddRoomAgentTargetId(null);
    setWorkspaceView("settings");
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("kimix:focus-model-settings")), 80);
  };

  const setSwarmModeForCurrentSession = async (enabled: boolean, options?: { feedback?: "toast" | "status" }) => {
    const feedback = options?.feedback ?? "toast";
    const latestActiveSession = activeSession
      ? useSessionStore.getState().sessions.find((session) => session.id === activeSession.id) ?? activeSession
      : null;
    let owner: RoomMutationOwner | null = null;
    if (latestActiveSession) {
      try {
        owner = resolveRoomMutationOwner(
          latestActiveSession,
          latestActiveSession.collaboration?.defaultRecipientIds,
          permissionMode,
        );
      } catch (error) {
        window.dispatchEvent(new CustomEvent("kimix:toast", {
          detail: error instanceof Error ? error.message : String(error),
        }));
        return false;
      }
    }
    if (latestActiveSession && owner && isSessionRuntimeRunning(owner.sessionView, useAppStore.getState().runningSessionId)) {
      updateSession(latestActiveSession.id, (session) => updateRoomMutationOwner(session, owner!.roomAgentId, (agent) => ({
        ...agent,
        swarmModeDesired: pendingSwarmModeValue(owner!.sessionView, enabled),
      }), permissionMode));
      const updated = useSessionStore.getState().sessions.find((session) => session.id === latestActiveSession.id);
      if (updated && useAppStore.getState().currentSession?.id === latestActiveSession.id) setCurrentSession(updated);
      const message = `Swarm 模式将在下一轮${enabled ? "开启" : "关闭"}。`;
      if (feedback === "status") await appendStatusMessage(message, owner.roomAgentId);
      else {
        window.dispatchEvent(new CustomEvent("kimix:toast", {
          detail: `${owner.displayName}：${message}`,
        }));
      }
      return true;
    }
    const runtime = await ensureOfficialRuntimeForSession();
    if (!runtime) return false;
    const res = await window.api.swarmKimiCode({
      sessionId: runtime.runtimeSessionId,
      enabled,
      trigger: "manual",
    });
    if (!res.success) {
      const message = `Swarm 模式${enabled ? "开启" : "关闭"}失败：${res.error}`;
      if (feedback === "status") await appendStatusMessage(message, runtime.roomAgentId);
      else {
        window.dispatchEvent(new CustomEvent("kimix:toast", {
          detail: message,
        }));
      }
      return false;
    }
    recordAppliedSwarmMode(runtime.uiSessionId, runtime.roomAgentId, enabled);
    if (feedback === "status") {
      await appendStatusMessage(`Swarm 模式已${enabled ? "开启" : "关闭"}。`, runtime.roomAgentId);
    } else {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `${runtime.displayName} · Swarm ${enabled ? "开" : "关"}`,
      }));
    }
    return true;
  };

  const syncOfficialGoal = (uiSessionId: string, roomAgentId: string, goal: unknown, error?: string | null) => {
    updateSession(uiSessionId, (session) => ({
      ...updateRoomMutationOwner(session, roomAgentId, (agent) => ({
        ...agent,
        officialGoal: {
          goal: reconcileOfficialGoalSnapshot(goal && typeof goal === "object" ? goal as NonNullable<Session["officialGoal"]>["goal"] : null, agent.officialGoal?.goal),
          error: error ?? null,
          updatedAt: Date.now(),
        },
      }), permissionMode),
      updatedAt: Date.now(),
    }));
    const updated = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (updated && useAppStore.getState().currentSession?.id === uiSessionId) setCurrentSession(updated);
  };

  const formatGoalStatusNotice = (goal: OfficialGoalSnapshot | null) => {
    if (!goal) return "已刷新官方 Goal 状态：当前没有官方 Goal。";
    const status = goalStatusLabel(goal.status);
    const turns = typeof goal.turnsUsed === "number" ? ` · ${goal.turnsUsed} 轮` : "";
    const objective = goal.objective.trim();
    return [
      `已刷新官方 Goal 状态：${status}${turns}`,
      objective ? `目标：${objective}` : "",
    ].filter(Boolean).join("\n\n");
  };

  const refreshOfficialGoal = async (options?: { feedback?: "status" | "assistant" }) => {
    const runtime = await ensureOfficialRuntimeForSession();
    if (!runtime) return false;
    const res = await window.api.getKimiCodeGoal({ sessionId: runtime.runtimeSessionId });
    if (!res.success) {
      syncOfficialGoal(runtime.uiSessionId, runtime.roomAgentId, null, res.error);
      await appendStatusMessage(`官方 Goal 状态读取失败：${res.error}`, runtime.roomAgentId);
      return false;
    }
    syncOfficialGoal(runtime.uiSessionId, runtime.roomAgentId, res.data.goal);
    if (options?.feedback === "assistant") {
      await appendAssistantNotice(formatGoalStatusNotice(res.data.goal), runtime.roomAgentId);
    } else {
      await appendStatusMessage(res.data.goal ? `官方 Goal：${goalStatusLabel(res.data.goal.status)} · ${res.data.goal.objective}` : "当前没有官方 Goal。", runtime.roomAgentId);
    }
    return true;
  };

  const handleGoalSlashCommand = async (rawCommand: string, rawArgs: string) => {
    if (imageAttachments.length > 0) {
      await appendStatusMessage("/goal 命令暂不接收图片附件，请先移除图片。", activeMutationOwner?.roomAgentId);
      return true;
    }
    const args = rawArgs.trim();
    const [subcommandRaw, ...restParts] = args.split(/\s+/);
    const subcommand = (subcommandRaw || "status").toLowerCase();
    const rest = restParts.join(" ").trim();
    const runtime = await ensureOfficialRuntimeForSession();
    if (!runtime) return true;
    const runtimeSession = useSessionStore.getState().sessions.find((session) => session.id === runtime.uiSessionId);
    const isRoomCommand = Boolean(runtimeSession?.collaboration);

    const runGoalAction = async (message: string, action: () => Promise<{ success: true; data: { goal: unknown } } | { success: false; error: string }>) => {
      await appendSlashUserMessage(rawCommand, runtime.roomAgentId);
      const res = await action();
      if (!res.success) {
        syncOfficialGoal(runtime.uiSessionId, runtime.roomAgentId, null, res.error);
        await appendStatusMessage(`${message}失败：${res.error}`, runtime.roomAgentId);
        return true;
      }
      syncOfficialGoal(runtime.uiSessionId, runtime.roomAgentId, res.data.goal);
      await appendStatusMessage(message, runtime.roomAgentId);
      return true;
    };

    if (!args || subcommand === "status" || subcommand === "show") {
      await appendSlashUserMessage(rawCommand, runtime.roomAgentId);
      await refreshOfficialGoal({ feedback: "assistant" });
      return true;
    }
    if (subcommand === "pause") {
      return runGoalAction("已暂停官方 Goal。", () => window.api.pauseKimiCodeGoal({ sessionId: runtime.runtimeSessionId, reason: "Paused from Kimix slash command" }));
    }
    if (subcommand === "resume" || subcommand === "continue") {
      return runGoalAction("已继续官方 Goal。下一轮消息会按 Goal 模式推进。", () => window.api.resumeKimiCodeGoal({ sessionId: runtime.runtimeSessionId, reason: "Resumed from Kimix slash command" }));
    }
    if (subcommand === "cancel" || subcommand === "clear") {
      return runGoalAction("已取消官方 Goal。", () => window.api.cancelKimiCodeGoal({ sessionId: runtime.runtimeSessionId, reason: "Cancelled from Kimix slash command" }));
    }

    const replace = subcommand === "replace";
    const objective = ["start", "create", "new", "replace", "next"].includes(subcommand) ? rest : args;
    if (!objective) {
      await appendSlashUserMessage(rawCommand, runtime.roomAgentId);
      await appendStatusMessage("请输入 Goal 目标，例如：/goal 完成项目构建并修复失败。", runtime.roomAgentId);
      return true;
    }
    if (subcommand === "next") {
      const current = await window.api.getKimiCodeGoal({ sessionId: runtime.runtimeSessionId });
      if (current.success && current.data.goal) {
        await appendSlashUserMessage(rawCommand, runtime.roomAgentId);
        syncOfficialGoal(runtime.uiSessionId, runtime.roomAgentId, current.data.goal);
        await appendStatusMessage("Kimi Code 已默认提供 Goal 队列；当前兼容链路尚未公开队列管理能力。当前已有 Goal 时，请先完成/取消当前 Goal，或使用 /goal replace 替换。", runtime.roomAgentId);
        return true;
      }
    }
    const res = await window.api.createKimiCodeGoal({
      sessionId: runtime.runtimeSessionId,
      objective,
      replace,
    });
    if (!res.success) {
      await appendSlashUserMessage(rawCommand, runtime.roomAgentId);
      syncOfficialGoal(runtime.uiSessionId, runtime.roomAgentId, null, res.error);
      await appendStatusMessage(`${replace ? "替换" : "启动"}官方 Goal 失败：${res.error}`, runtime.roomAgentId);
      return true;
    }
    syncOfficialGoal(runtime.uiSessionId, runtime.roomAgentId, res.data.goal);
    if (!isRoomCommand) await appendSlashUserMessage(rawCommand, runtime.roomAgentId);
    await sendPromptContent(rawCommand, {
      addUserEvent: false,
      manualSubmitAutoScroll: false,
      outboundContent: buildGoalKickoffPrompt(objective),
    });
    return true;
  };

  const handleSdkSlashCommand = async (content: string, roomAgentId?: string) => {
    const match = content.trim().match(slashCommandPattern);
    if (!match) return false;
    const name = match[1].toLowerCase();
    const args = (match[2] ?? "").trim();
    const routing = classifySlashCommand(name);
    if (routing !== "local" && routing !== "official-skill-first") return false;
    const commandNotice = args ? `/${name} ${args}` : `/${name}`;
    if (name === "theme") {
      await appendSlashUserMessage(commandNotice, roomAgentId);
      setWorkspaceView("settings");
      await appendStatusMessage("已打开 Kimix 主题设置。官方 /theme 是终端 Kimi Code 的主题选择器，Kimix 使用独立的全局主题色板。", roomAgentId);
      return true;
    }
    if (name === "custom-theme") {
      if (!roomAgentId) await appendSlashUserMessage(commandNotice);
      const sent = await sendPromptContent(content.trim(), {
        addUserEvent: false,
        manualSubmitAutoScroll: false,
        outboundContent: buildCustomThemeKickoffPrompt(args),
        postUserStatusMessage: `官方 Skill 不可用，已使用兼容兜底：${commandNotice}`,
      });
      if (sent && roomAgentId) {
        await appendStatusMessage(`官方 Skill 不可用，已使用兼容兜底：${commandNotice}`, roomAgentId);
      }
      return true;
    }
    if (name === "import-from-cc-codex") {
      await appendSlashUserMessage(commandNotice, roomAgentId);
      const [subcommand, previewId] = args.split(/\s+/);
      if (subcommand === "apply") {
        if (!previewId) {
          await appendStatusMessage("请输入预览 ID，例如：/import-from-cc-codex apply abc12345。", roomAgentId);
          return true;
        }
        const res = await window.api.applyImportFromCcCodex({ previewId });
        if (!res.success) {
          await appendStatusMessage(`导入失败：${res.error}`, roomAgentId);
          return true;
        }
        const imported = res.data.imported.length;
        const skipped = res.data.skipped.length;
        const backups = res.data.backups.length;
        await appendStatusMessage(`导入完成：已写入 ${imported} 项，跳过 ${skipped} 项，创建备份 ${backups} 个。请在设置/插件面板刷新确认，必要时重启 Kimi Code 会话。`, roomAgentId);
        return true;
      }
      if (args) {
        await appendStatusMessage("当前仅支持 /import-from-cc-codex 生成安全预览，或 /import-from-cc-codex apply <预览ID> 应用预览。", roomAgentId);
        return true;
      }
      const res = await window.api.previewImportFromCcCodex({ workDir: currentProject?.path });
      if (!res.success) {
        await appendStatusMessage(`生成导入预览失败：${res.error}`, roomAgentId);
        return true;
      }
      const writable = res.data.items.filter((item) => item.action !== "skip");
      const previewLines = [
        `已生成 Claude Code / Codex 导入预览：${res.data.previewId}`,
        `将导入：${summarizeImportPlan(res.data.items)}。`,
        res.data.projectRoot ? `项目范围：${res.data.projectRoot}` : "项目范围：未找到 .git 根目录，仅预览用户级配置。",
        res.data.warnings.length > 0 ? `注意：${res.data.warnings.slice(0, 2).join("；")}` : "",
        writable.length > 0
          ? `确认无误后发送：/import-from-cc-codex apply ${res.data.previewId}`
          : "没有发现需要写入的新内容。",
      ].filter(Boolean);
      await appendStatusMessage(previewLines.join("\n"), roomAgentId);
      return true;
    }
    return false;
  };

  const findOfficialPluginCommand = (name: string) => {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return undefined;
    return slashCommands.find((command) =>
      command.kind === "plugin-command" &&
      command.commandName?.toLowerCase() === normalized &&
      command.pluginId &&
      command.pluginCommandName
    );
  };

  const handleOfficialPluginCommand = async (command: CompletionItem, args?: string) => {
    if (!command.pluginId || !command.pluginCommandName) return false;
    const runtime = await ensureOfficialRuntimeForSession();
    if (!runtime) return true;
    const res = await window.api.activateKimiCodePluginCommand({
      sessionId: runtime.runtimeSessionId,
      pluginId: command.pluginId,
      commandName: command.pluginCommandName,
      args,
    });
    if (!res.success) {
      await appendLocalEvent({
        id: genId(),
        type: "error",
        timestamp: Date.now(),
        message: `Plugin 命令 /${command.commandName ?? `${command.pluginId}:${command.pluginCommandName}`} 激活失败：${res.error}`,
        source: "ui",
      }, runtime.roomAgentId);
    }
    return true;
  };

  const handleDirectSlashCommand = async (content: string) => {
    const match = content.trim().match(slashCommandPattern);
    if (!match) return false;
    const name = match[1].toLowerCase();
    const args = (match[2] ?? "").trim();
    if (classifySlashCommand(name) !== "direct") return false;
    const commandNotice = args ? `/${name} ${args}` : `/${name}`;
    if (name.startsWith("skill:")) {
      const skillName = name.slice("skill:".length);
      await applySkillCommand(skillName, args || undefined);
      return true;
    }
    if (name === "goal") {
      return handleGoalSlashCommand(content.trim(), args);
    }
    if (name === "swarm") {
      const normalized = args.toLowerCase();
      const owner = activeMutationOwner;
      if (!owner) {
        window.dispatchEvent(new CustomEvent("kimix:toast", { detail: mutationOwnerError || "请先选择一个 Agent。" }));
        return true;
      }
      if (!args) {
        await appendSlashUserMessage(commandNotice, owner.roomAgentId);
        await appendStatusMessage("请输入 Swarm 任务，例如：/swarm 并行检查最近改动并给出修复建议；也可使用 /swarm on 或 /swarm off 切换模式。", owner.roomAgentId);
        return true;
      }
      if (normalized === "on" || normalized === "off") {
        await appendSlashUserMessage(commandNotice, owner.roomAgentId);
        const enabled = normalized === "on";
        await setSwarmModeForCurrentSession(enabled, { feedback: "status" });
        return true;
      }

      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      const userEvent: TimelineEvent = {
        id: genId(),
        type: "user_message",
        timestamp: Date.now(),
        content: content.trim(),
      };
      const statusEvent: TimelineEvent = {
        id: genId(),
        type: "status_update",
        timestamp: Date.now(),
        message: `已发出 Swarm 指令：${args}`,
        source: "slash",
        tone: "info",
        parentEventId: userEvent.id,
      };
      updateSession(runtime.uiSessionId, (session) => {
        const withUser = appendRoomMutationEvent(session, runtime.roomAgentId, userEvent);
        const withStatus = appendRoomMutationEvent(withUser, runtime.roomAgentId, statusEvent);
        return { ...withStatus, updatedAt: Date.now() };
      });
      setRoomAgentActivity({
        roomId: runtime.uiSessionId,
        roomAgentId: runtime.roomAgentId,
        runtimeSessionId: runtime.runtimeSessionId,
        status: "running",
        startedAt: Date.now(),
        updatedAt: Date.now(),
      });
      const swarmRoom = useSessionStore.getState().sessions.find((session) => session.id === runtime.uiSessionId);
      if (swarmRoom && getPrimaryRoomAgent(swarmRoom).id === runtime.roomAgentId) {
        setRunningSessionId(runtime.uiSessionId);
      }
      const modeRes = await window.api.swarmKimiCode({ sessionId: runtime.runtimeSessionId, enabled: true, trigger: "task" });
      if (modeRes.success) {
        recordAppliedSwarmMode(runtime.uiSessionId, runtime.roomAgentId, true);
      }
      const res = modeRes.success ? await window.api.swarmKimiCode({ sessionId: runtime.runtimeSessionId, content: args }) : modeRes;
      if (!res.success) {
        setRoomAgentActivity({
          roomId: runtime.uiSessionId,
          roomAgentId: runtime.roomAgentId,
          runtimeSessionId: runtime.runtimeSessionId,
          status: "error",
          updatedAt: Date.now(),
        });
        const currentRoom = useSessionStore.getState().sessions.find((session) => session.id === runtime.uiSessionId);
        if (currentRoom && getPrimaryRoomAgent(currentRoom).id === runtime.roomAgentId) setRunningSessionId(null);
        updateSession(runtime.uiSessionId, (session) => ({
          ...appendRoomMutationEvent(session, runtime.roomAgentId, {
            id: genId(),
            type: "error",
            timestamp: Date.now(),
            message: `Swarm 启动失败：${res.error}`,
            source: "ipc",
          }),
          updatedAt: Date.now(),
        }));
      }
      return true;
    }
    if (name === "compact") {
      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      await appendSlashUserMessage(commandNotice, runtime.roomAgentId);
      const res = await window.api.compactKimiCodeSession({ sessionId: runtime.runtimeSessionId, instruction: args || undefined });
      if (!res.success) await appendStatusMessage(`压缩失败：${res.error}`, runtime.roomAgentId);
      return true;
    }
    if (name === "plan") {
      const owner = activeMutationOwner;
      if (!owner) {
        window.dispatchEvent(new CustomEvent("kimix:toast", { detail: mutationOwnerError || "请先选择一个 Agent。" }));
        return true;
      }
      await appendSlashUserMessage(commandNotice, owner.roomAgentId);
      const normalized = args.toLowerCase();
      const next = normalized === "on" || normalized === "true" || normalized === "1"
        ? true
        : normalized === "off" || normalized === "false" || normalized === "0"
          ? false
          : !mutationPlanMode;
      updateSession(activeSession!.id, (session) => updateRoomMutationOwner(session, owner.roomAgentId, (agent) => ({ ...agent, planMode: next }), permissionMode));
      syncCurrentSessionFromStore(activeSession!.id);
      if (owner.runtimeSessionId) {
        const res = await window.api.setKimiCodePlanMode({ sessionId: owner.runtimeSessionId, enabled: next });
        if (!res.success) {
          updateSession(activeSession!.id, (session) => updateRoomMutationOwner(session, owner.roomAgentId, (agent) => ({ ...agent, planMode: !next }), permissionMode));
          syncCurrentSessionFromStore(activeSession!.id);
          if (!activeSession?.collaboration) setDefaultPlanMode(!next);
          await appendStatusMessage(`Plan 模式切换失败：${res.error}`, owner.roomAgentId);
          return true;
        } else await appendStatusMessage(next ? "Plan 模式已开启。" : "Plan 模式已关闭。", owner.roomAgentId);
      } else {
        await appendStatusMessage(next ? "Plan 模式已开启，新会话发送时生效。" : "Plan 模式已关闭。", owner.roomAgentId);
      }
      if (!activeSession?.collaboration) setDefaultPlanMode(next);
      return true;
    }
    if (name === "reload") {
      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      await appendSlashUserMessage(commandNotice, runtime.roomAgentId);
      const res = await window.api.reloadKimiCodeSession({ sessionId: runtime.runtimeSessionId });
      await appendStatusMessage(res.success ? "已重载当前会话配置。" : `重载失败：${res.error}`, runtime.roomAgentId);
      return true;
    }
    if (name === "status") {
      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      await appendSlashUserMessage(commandNotice, runtime.roomAgentId);
      const res = await window.api.getKimiCodeStatus({ sessionId: runtime.runtimeSessionId });
      await appendAssistantNotice(res.success ? formatKimiCodeStatus(res.data as Record<string, unknown>) : `读取 Kimi Code 状态失败：${res.error}`, runtime.roomAgentId);
      return true;
    }
    if (name === "usage") {
      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      await appendSlashUserMessage(commandNotice, runtime.roomAgentId);
      const res = await window.api.getKimiCodeUsage({ sessionId: runtime.runtimeSessionId });
      await appendAssistantNotice(res.success ? formatKimiCodeUsage(res.data) : `读取 Kimi Code 会话用量失败：${res.error}`, runtime.roomAgentId);
      return true;
    }
    if (name === "btw") {
      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      await appendSlashUserMessage(commandNotice, runtime.roomAgentId);
      if (!args) {
        await appendStatusMessage("请输入侧问内容，例如：/btw 这个函数是谁调用的？", runtime.roomAgentId);
        return true;
      }
      const roundId = `btw-round-${Date.now()}`;
      updateSession(runtime.uiSessionId, (session) => ({
        ...updateRoomMutationOwner(session, runtime.roomAgentId, (agent) => ({
          ...agent,
          btwRounds: [...(agent.btwRounds ?? []), { id: roundId, userContent: args, timestamp: Date.now() }],
        }), permissionMode),
        updatedAt: Date.now(),
      }));
      const res = await window.api.askKimiCodeBtw({ sessionId: runtime.runtimeSessionId, content: args });
      updateSession(runtime.uiSessionId, (session) => ({
        ...updateRoomMutationOwner(session, runtime.roomAgentId, (agent) => ({
          ...agent,
          btwRounds: (agent.btwRounds ?? []).map((round) => round.id === roundId
            ? { ...round, assistantContent: res.success ? res.data.content || "没有返回正文。" : `侧问失败：${res.error}`, thinking: res.success ? res.data.thinking || undefined : undefined }
            : round),
        }), permissionMode),
        updatedAt: Date.now(),
      }));
      await appendStatusMessage(res.success ? "BTW 侧问已完成，结果在右侧会话栏。" : `BTW 侧问失败：${res.error}`, runtime.roomAgentId);
      return true;
    }
    if (name === "undo") {
      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      const targetSession = useSessionStore.getState().sessions.find((session) => session.id === runtime.uiSessionId);
      const rawCount = Number(args || "1");
      const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(Math.floor(rawCount), 10)) : 1;
      const res = await window.api.undoKimiCodeHistory({ sessionId: runtime.runtimeSessionId, count });
      let message = res.success ? `已撤回最近 ${count} 次官方历史。` : `撤回失败：${res.error}`;
      if (res.success && targetSession) {
        const loaded = await window.api.loadKimiCodeSession({
          workDir: targetSession.projectPath,
          sessionId: runtime.runtimeSessionId,
        });
        if (!loaded.success) {
          message = `官方撤回成功，但刷新官方历史失败：${loaded.error}`;
        } else {
          updateSession(runtime.uiSessionId, (session) => {
            const reconciliation = reconcileAgentCanonicalHistory({
              session,
              roomAgentId: runtime.roomAgentId,
              expectedRuntimeSessionId: runtime.runtimeSessionId,
              canonicalEvents: mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []),
              reason: "undo",
            });
            return reconciliation.applied ? reconciliation.session : session;
          });
          syncCurrentSessionFromStore(runtime.uiSessionId);
        }
      }
      await appendSlashUserMessage(commandNotice, runtime.roomAgentId);
      await appendStatusMessage(message, runtime.roomAgentId);
      return true;
    }
    return false;
  };

  const applySkillCommand = async (
    skillName: string,
    args?: string,
    options: { allowMigration?: boolean; reportFailure?: boolean } = {},
  ) => {
    const allowMigration = options.allowMigration ?? true;
    const reportFailure = options.reportFailure ?? true;
    const runtime = await ensureOfficialRuntimeForSession();
    if (!runtime) return false;
    let runtimeSessionId = runtime.runtimeSessionId;
    const normalizedName = skillName.trim().toLowerCase();
    const findOfficialSkill = async () => {
      const result = await window.api.listKimiCodeSkills({ sessionId: runtimeSessionId });
      return result.success
        ? result.data.find((item) => item.name.toLowerCase() === normalizedName)
        : undefined;
    };

    let officialSkill = await findOfficialSkill();
    let migrated = false;
    let reloaded = false;
    if (!officialSkill && allowMigration) {
      const prepareRes = await window.api.prepareKimiSkill({ name: skillName });
      if (!prepareRes.success) {
        await appendLocalEvent({ id: genId(), type: "error", timestamp: Date.now(), message: `调用 Skill 失败：${prepareRes.error}`, source: "ui" }, runtime.roomAgentId);
        return false;
      }
      migrated = prepareRes.data.copied;
      const syncedAt = Date.now();
      const reloadRes = await window.api.reloadKimiCodeSession({ sessionId: runtimeSessionId });
      if (reloadRes.success) {
        reloaded = true;
        updateSession(runtime.uiSessionId, (session) => updateRoomMutationOwner(session, runtime.roomAgentId, (agent) => ({
          ...agent,
          skillRegistrySyncedAt: syncedAt,
        }), permissionMode));
      } else {
        const refreshedRuntimeSessionId = await forkRuntimeForSkillRegistry(
          runtime.uiSessionId,
          runtimeSessionId,
          syncedAt,
          runtime.roomAgentId,
        );
        if (!refreshedRuntimeSessionId) return false;
        runtimeSessionId = refreshedRuntimeSessionId;
      }
      officialSkill = await findOfficialSkill();
      if (!officialSkill && reloaded) {
        const refreshedRuntimeSessionId = await forkRuntimeForSkillRegistry(
          runtime.uiSessionId,
          runtimeSessionId,
          syncedAt,
          runtime.roomAgentId,
        );
        if (!refreshedRuntimeSessionId) return false;
        runtimeSessionId = refreshedRuntimeSessionId;
        reloaded = false;
        officialSkill = await findOfficialSkill();
      }
    }
    if (!officialSkill) {
      if (reportFailure) {
        await appendLocalEvent({ id: genId(), type: "error", timestamp: Date.now(), message: `Kimi Server 未识别 Skill：${skillName}。请新建会话后重试。`, source: "ui" }, runtime.roomAgentId);
      }
      return false;
    }

    const activateRes = await window.api.activateKimiCodeSkill({
      sessionId: runtimeSessionId,
      name: officialSkill.name,
      args: args || undefined,
    });
    if (activateRes.success) {
      const targetSession = useSessionStore.getState().sessions.find((session) => session.id === runtime.uiSessionId);
      const ownerIsPrimary = Boolean(targetSession && getPrimaryRoomAgent(targetSession).id === runtime.roomAgentId);
      if (targetSession && ownerIsPrimary && (targetSession.title === "新会话" || /^User activated the skill\b/i.test(targetSession.title))) {
        const nextTitle = (args?.trim() || `使用 ${officialSkill.name}`).slice(0, 48);
        updateSession(runtime.uiSessionId, (session) => ({ ...session, title: nextTitle, updatedAt: Date.now() }));
        const renamedSession = useSessionStore.getState().sessions.find((session) => session.id === runtime.uiSessionId);
        if (renamedSession) setCurrentSession(renamedSession);
        await window.api.renameKimiCodeSession({ sessionId: runtimeSessionId, title: nextTitle }).catch(() => undefined);
      }
    }
    if (activateRes.success || reportFailure) {
      await appendLocalEvent({
        id: genId(),
        type: activateRes.success ? "status_update" : "error",
        timestamp: Date.now(),
        message: activateRes.success
          ? `${migrated ? (reloaded ? "已迁移并刷新会话后" : "已迁移并") : "已"}调用官方 Skill：${officialSkill.name}`
          : `调用 Skill 失败：${activateRes.error}`,
        source: "ui",
      }, runtime.roomAgentId);
    }
    return activateRes.success;
  };

  const forkRuntimeForSkillRegistry = async (uiSessionId: string, runtimeSessionId: string, syncedAt: number, roomAgentId: string) => {
    const targetSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    const forkRes = await window.api.forkKimiCodeSession({
      sessionId: runtimeSessionId,
      forkId: `skill-${crypto.randomUUID()}`,
      title: targetSession?.title,
    });
    if (!forkRes.success) {
      await appendLocalEvent({ id: genId(), type: "error", timestamp: Date.now(), message: `Skill 已安装，但会话刷新失败：${forkRes.error}`, source: "ui" }, roomAgentId);
      return null;
    }

    const nextRuntimeSessionId = forkRes.data.sessionId;
    updateSession(uiSessionId, (session) => ({
      ...updateRoomMutationOwner(session, roomAgentId, (agent) => ({
        ...agent,
        runtimeSessionId: nextRuntimeSessionId,
        officialSessionId: nextRuntimeSessionId,
        skillForkParentSessionId: runtimeSessionId,
        skillRegistrySyncedAt: syncedAt,
      }), permissionMode),
      engine: "kimi-code",
      updatedAt: Date.now(),
    }));
    const refreshedSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (refreshedSession && useAppStore.getState().currentSession?.id === uiSessionId) setCurrentSession(refreshedSession);
    await window.api.closeKimiCodeSession({ sessionId: runtimeSessionId }).catch(() => undefined);
    return nextRuntimeSessionId;
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    const imagesToSend = imageAttachments;
    if ((!trimmed && imagesToSend.length === 0) || !canUseComposer) return;
    const slashRoomAgentId = activeSession?.collaboration ? activeMutationOwner?.roomAgentId : undefined;
    if (activeSession?.collaboration && trimmed.startsWith("/") && !slashRoomAgentId) {
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: mutationOwnerError || "请先选择一个 Agent。" }));
      return;
    }
    if (activeSession?.collaboration) {
      try {
        const route = resolveRoomPromptRoute(activeSession, trimmed, activeSession.collaboration.defaultRecipientIds);
        const unavailable = route.recipientAgentIds
          .map((id) => getRoomAgent(activeSession, id))
          .find((agent) => !agent || agent.provisioningError || agent.recoveryIssue || agent.archivedAt || agent.removedAt);
        if (unavailable) {
          window.dispatchEvent(new CustomEvent("kimix:toast", {
            detail: unavailable?.provisioningError || unavailable?.recoveryIssue?.message || "至少一个目标 Agent 当前不可用。",
          }));
          return;
        }
        if (!route.outboundContent.trim() && imagesToSend.length === 0) {
          window.dispatchEvent(new CustomEvent("kimix:toast", { detail: "请在 @Agent 之后输入要处理的任务。" }));
          return;
        }
        const contextEstimate = estimateRoomContextShare(
          activeSession,
          route.recipientAgentIds,
          roomContextShareSelection,
        );
        if (contextEstimate.overLimitAgentNames.length > 0) {
          window.dispatchEvent(new CustomEvent("kimix:toast", {
            detail: `${contextEstimate.overLimitAgentNames.join("、")} 要补充的正文超过安全上限，请改用最近 3 轮或选择消息。`,
          }));
          return;
        }
      } catch (error) {
        window.dispatchEvent(new CustomEvent("kimix:toast", { detail: error instanceof Error ? error.message : String(error) }));
        return;
      }
    }
    if (hasActiveAssistantTurn && currentSession && !currentSession.collaboration) {
      setInput("");
      setImageAttachments([]);
      inputRef.current?.reset();
      addPendingMessage(currentSession.id, trimmed, toUserAttachments(imagesToSend));
      return;
    }
    const slashName = trimmed.match(slashCommandPattern)?.[1] ?? "";
    const slashArgs = trimmed.match(slashCommandPattern)?.[2]?.trim() || undefined;
    const slashRouting = classifySlashCommand(slashName);
    const pluginCommand = findOfficialPluginCommand(slashName);
    if (shouldActivateSkillBeforePrompt(slashName)) {
      const match = trimmed.match(slashCommandPattern);
      const skillName = match?.[1]?.slice("skill:".length) ?? "";
      const skillArgs = (match?.[2] ?? "").trim();
      if (imagesToSend.length > 0) {
        await appendStatusMessage(`/${slashName} 暂不接收图片附件，请先移除图片。`, slashRoomAgentId);
        return;
      }
      setInput("");
      setImageAttachments([]);
      inputRef.current?.reset();
      if (!hasActiveAssistantTurn && activeSession) {
        settlePendingClarifications(activeSession.id, slashRoomAgentId);
      }
      await appendSlashUserMessage(trimmed, slashRoomAgentId);
      await applySkillCommand(skillName, skillArgs || undefined);
      return;
    }
    if (pluginCommand) {
      if (imagesToSend.length > 0) {
        await appendStatusMessage(`/${slashName} 暂不接收图片附件，请先移除图片。`, slashRoomAgentId);
        return;
      }
      setInput("");
      setImageAttachments([]);
      inputRef.current?.reset();
      if (!hasActiveAssistantTurn && activeSession) {
        settlePendingClarifications(activeSession.id, slashRoomAgentId);
      }
      await appendSlashUserMessage(trimmed, slashRoomAgentId);
      await handleOfficialPluginCommand(pluginCommand, slashArgs);
      return;
    }
    if (slashRouting === "official-skill-first") {
      if (imagesToSend.length > 0) {
        await appendStatusMessage(`/${slashName} 暂不接收图片附件，请先移除图片。`, slashRoomAgentId);
        return;
      }
      setInput("");
      setImageAttachments([]);
      inputRef.current?.reset();
      if (!hasActiveAssistantTurn && activeSession) {
        settlePendingClarifications(activeSession.id, slashRoomAgentId);
      }
      const activated = await applySkillCommand(slashName, slashArgs, {
        allowMigration: false,
        reportFailure: false,
      });
      if (activated) {
        await appendSlashUserMessage(trimmed, slashRoomAgentId);
      } else {
        const fallbackHandled = await handleSdkSlashCommand(trimmed, slashRoomAgentId);
        if (!fallbackHandled) {
          await appendLocalEvent({
            id: genId(),
            type: "error",
            timestamp: Date.now(),
            message: `官方 /${slashName} Skill 激活失败，当前没有可用的兼容处理。`,
            source: "ui",
          }, slashRoomAgentId);
        }
      }
      return;
    }
    if (slashRouting === "direct") {
      if (imagesToSend.length > 0) {
        await appendStatusMessage(`/${slashName} 暂不接收图片附件，请先移除图片。`, slashRoomAgentId);
        return;
      }
      setInput("");
      setImageAttachments([]);
      inputRef.current?.reset();
      if (!hasActiveAssistantTurn && activeSession) {
        settlePendingClarifications(activeSession.id, slashRoomAgentId);
      }
      await handleDirectSlashCommand(trimmed);
      return;
    }
    const slashHandled = trimmed.startsWith("/")
      ? await handleSdkSlashCommand(trimmed, slashRoomAgentId)
      : false;
    if (slashHandled) {
      setInput("");
      setImageAttachments([]);
      inputRef.current?.reset();
      return;
    }
    setInput("");
    setImageAttachments([]);
    inputRef.current?.reset();

    if (!hasActiveAssistantTurn && activeSession && !activeSession.collaboration) {
      settlePendingClarifications(activeSession.id);
    }

    await sendPromptContent(trimmed, { images: imagesToSend });
  };

  const handleApplyThemeImport = async (themeId: string) => {
    if (!themeImportPreview) return;
    setThemeImportApplyingId(themeId);
    const res = await window.api.applyKimiThemeImport({ previewId: themeImportPreview.previewId, themeId });
    setThemeImportApplyingId(null);
    if (!res.success) {
      await appendStatusMessage(`应用主题映射失败：${res.error}`);
      return;
    }
    upsertKimiThemePalette({
      id: res.data.id,
      name: res.data.name,
      displayName: `KIMI-${res.data.displayName}`,
      path: res.data.path,
      base: res.data.base,
      palette: res.data.kimiColors,
      colors: res.data.colors,
    });
    setThemePalette(kimiThemePaletteId(res.data.id));
    setThemeImportPreview(null);
    await appendStatusMessage(`已登记并启用「KIMI-${res.data.displayName}」：Kimix 将使用官方 18 个主题 token，三色预览为 ${formatMappedTheme(res.data)}。`);
  };

  // steer：把输入框内容立即注入当前运行中的 turn，与普通 Enter 排队严格区分。
  const updateSteerStatus = (
    sessionId: string,
    steerId: string,
    status: "accepted" | "sent" | "failed",
    error?: string,
    roomTarget?: Pick<RoomAgentControlTarget, "roomAgentId">,
  ) => {
    updateSession(sessionId, (session) => {
      const updateEvents = (events: TimelineEvent[]) => events.map((event) => event.id === steerId && event.type === "steer_message"
        ? event.status === "sent" && status === "accepted"
          ? event
          : { ...event, status, error: status === "failed" ? error : undefined }
        : event
      );
      const next = roomTarget
        ? updateRoomAgentEvents(session, roomTarget.roomAgentId, updateEvents)
        : { ...session, events: updateEvents(session.events) };
      return { ...next, updatedAt: Date.now() };
    });
    const updated = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
    if (updated && useAppStore.getState().currentSession?.id === sessionId) setCurrentSession(updated);
  };

  const insertLocalSteerMessage = (
    sessionId: string,
    content: string,
    images: ImageAttachment[] = [],
    roomTarget?: Pick<RoomAgentControlTarget, "roomAgentId" | "roomMessageId" | "activeTurnId">,
  ): string => {
    const steerId = genId();
    const event: Extract<TimelineEvent, { type: "steer_message" }> = {
      id: steerId,
      type: "steer_message",
      timestamp: Date.now(),
      content,
      images: toUserAttachments(images),
      status: "sending",
    };
    updateSession(sessionId, (session) => {
      const next = roomTarget
        ? appendRoomAgentSteerEvent(session, roomTarget, event)
        : { ...session, events: [...session.events, event] };
      return { ...next, updatedAt: Date.now() };
    });
    const updated = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
    if (updated && useAppStore.getState().currentSession?.id === sessionId) setCurrentSession(updated);
    return steerId;
  };

  const handleSteer = async (roomAgentId?: string) => {
    const trimmed = input.trim();
    const imagesToSend = imageAttachments;
    if ((!trimmed && imagesToSend.length === 0) || !canUseComposer) return;
    if (!activeSession || !canSteerActiveTurn) {
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: "当前没有可引导的运行轮次，消息会留在队列里等待本轮结束。" }));
      return;
    }
    if (activeSession.collaboration && !roomAgentId && roomSteerTargets.length > 1) {
      setRoomControlRequest({ action: "steer-input" });
      return;
    }
    let roomTarget: RoomAgentControlTarget | undefined;
    let runtimeSessionId = getRuntimeSessionId(activeSession);
    if (activeSession.collaboration) {
      try {
        const latest = useSessionStore.getState().sessions.find((session) => session.id === activeSession.id) ?? activeSession;
        roomTarget = resolveRoomAgentControlTarget(
          latest,
          Object.values(useAppStore.getState().roomAgentActivities),
          "steer",
          roomAgentId,
        );
        runtimeSessionId = roomTarget.runtimeSessionId;
      } catch (error) {
        window.dispatchEvent(new CustomEvent("kimix:toast", { detail: error instanceof Error ? error.message : String(error) }));
        return;
      }
    }
    if (!runtimeSessionId) return;
    const steerId = insertLocalSteerMessage(
      activeSession.id,
      trimmed || (imagesToSend.length > 0 ? "[附件]" : ""),
      imagesToSend,
      roomTarget,
    );
    setInput("");
    setImageAttachments([]);
    inputRef.current?.reset();
    const res = await window.api.steerKimiCode({
      sessionId: runtimeSessionId,
      content: buildAttachmentPromptContent(trimmed, imagesToSend),
      images: toPromptImages(imagesToSend),
    });
    if (!res.success) {
      updateSteerStatus(activeSession.id, steerId, "failed", res.error, roomTarget);
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `引导失败：${res.error}` }));
      return;
    }
    updateSteerStatus(activeSession.id, steerId, "accepted", undefined, roomTarget);
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: roomTarget ? `已向 ${roomTarget.displayName} 发送引导请求` : "已发送引导请求",
    }));
  };

  const stopRoomAgentTarget = async (target: RoomAgentControlTarget, persist = true): Promise<string | null> => {
    if (!activeSession?.collaboration || !target.runtimeSessionId) {
      return `Agent“${target.displayName}”的运行会话尚未就绪。`;
    }
    try {
      const res = await window.api.cancelKimiCodeTurn({ sessionId: target.runtimeSessionId });
      if (!res.success) return res.error;
      const stoppedAt = Date.now();
      updateSession(activeSession.id, (session) => settleStoppedRoomAgent(session, target, stoppedAt));
      setRoomAgentActivity({
        roomId: activeSession.id,
        roomAgentId: target.roomAgentId,
        runtimeSessionId: target.runtimeSessionId,
        status: "interrupted",
        roomMessageId: target.roomMessageId,
        activeTurnId: target.activeTurnId,
        updatedAt: stoppedAt,
      });
      if (activeSession.collaboration.primaryAgentId === target.roomAgentId) setRunningSessionId(null);
      syncCurrentSessionFromStore(activeSession.id);
      if (!persist) return null;
      const persisted = await persistLocalConversationState();
      return persisted.success ? null : `停止已生效，但保存本地状态失败：${persisted.error}`;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  const handleStopAllRoomAgents = async () => {
    if (!activeSession?.collaboration) return;
    const latest = useSessionStore.getState().sessions.find((session) => session.id === activeSession.id) ?? activeSession;
    const targets = getRoomAgentControlTargets(latest, Object.values(useAppStore.getState().roomAgentActivities), "stop");
    setRoomControlRequest(null);
    const outcomes = await Promise.all(targets.map(async (target) => ({
      target,
      error: await stopRoomAgentTarget(target, false),
    })));
    const persisted = await persistLocalConversationState();
    const failed = outcomes.filter((outcome) => outcome.error);
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: !persisted.success
        ? `停止请求已完成，但保存本地状态失败：${persisted.error}`
        : failed.length === 0
        ? `已停止 ${outcomes.length} 个 Agent`
        : `已停止 ${outcomes.length - failed.length} 个，${failed.length} 个失败：${failed.map((outcome) => outcome.target.displayName).join("、")}`,
    }));
  };

  const handleStop = async (roomAgentId?: string) => {
    if (activeSession?.collaboration) {
      if (!roomAgentId && roomStopTargets.length > 1) {
        setRoomControlRequest({ action: "stop" });
        return;
      }
      try {
        const latest = useSessionStore.getState().sessions.find((session) => session.id === activeSession.id) ?? activeSession;
        const target = resolveRoomAgentControlTarget(
          latest,
          Object.values(useAppStore.getState().roomAgentActivities),
          "stop",
          roomAgentId,
        );
        const error = await stopRoomAgentTarget(target);
        window.dispatchEvent(new CustomEvent("kimix:toast", {
          detail: error
            ? error.startsWith("停止已生效")
              ? `${target.displayName}：${error}`
              : `停止 ${target.displayName} 失败：${error}`
            : `已停止 ${target.displayName}`,
        }));
      } catch (error) {
        window.dispatchEvent(new CustomEvent("kimix:toast", { detail: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }
    const stateRunningSessionId = useAppStore.getState().runningSessionId;
    const stateRunningMatchesActive = Boolean(activeSession && (
      stateRunningSessionId === activeSession.id ||
      Boolean(activeRuntimeSessionId && stateRunningSessionId === activeRuntimeSessionId)
    ));
    const sessionId = (isSessionRuntimeRunning(activeSession, stateRunningSessionId) || stateRunningMatchesActive) && activeSession
      ? activeSession.id
      : stateRunningSessionId ?? activeSession?.id;
    if (!sessionId) return;
    if (stateRunningSessionId === sessionId || (activeRuntimeSessionId && stateRunningSessionId === activeRuntimeSessionId)) setRunningSessionId(null);
    updateSession(sessionId, (session) => ({
      ...session,
      events: session.events.map((event) => event.type === "assistant_message" && !event.isComplete
        ? { ...event, isComplete: true, isThinking: false, durationMs: event.durationMs ?? Math.max(0, Date.now() - event.timestamp) }
        : event.type === "question_request" && event.status === "pending"
          ? { ...event, status: "skipped" as const, answers: event.answers ?? {} }
        : event
      ),
      updatedAt: Date.now(),
    }));
    if (activeSession?.id === sessionId) {
      const updated = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
      if (updated) setCurrentSession(updated);
    }
    window.setTimeout(() => {
      const latest = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
      if (!latest) return;
      const hasOpenAssistant = latest.events.some((event) => event.type === "assistant_message" && !event.isComplete);
      if (!hasOpenAssistant) return;
      updateSession(sessionId, (session) => ({
        ...session,
        events: session.events.map((event) => event.type === "assistant_message" && !event.isComplete
          ? { ...event, isComplete: true, isThinking: false, durationMs: event.durationMs ?? Math.max(0, Date.now() - event.timestamp) }
          : event
        ),
        updatedAt: Date.now(),
      }));
    }, 250);
    try {
      const latest = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
      const runtimeSessionId = latest ? getRuntimeSessionId(latest) : sessionId;
      const res = runtimeSessionId
        ? await window.api.cancelKimiCodeTurn({ sessionId: runtimeSessionId })
        : { success: true as const, data: undefined };
      if (!res.success) {
        console.error("Stop failed:", res.error);
      }
    } catch (err) {
      console.error("Stop failed:", err);
    }
  };

  const handleVoiceShortcut = async () => {
    const shortcut = voiceShortcut.trim() || "Win+H";
    inputRef.current?.focus();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
    const res = await window.api.triggerShortcut({ shortcut });
    inputRef.current?.focus();
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: res.success ? `已触发语音快捷键：${shortcut}` : `语音快捷键失败：${res.error}`,
    }));
  };

  const applyPermissionMode = useCallback(async (mode: PermissionMode, runtimeSessionId?: string, roomAgentId?: string, traceId = genId()) => {
    const stateSnapshot = useSessionStore.getState();
    const targetSession = roomAgentId
      ? stateSnapshot.sessions.find((session) => Boolean(getRoomAgent(session, roomAgentId)))
      : stateSnapshot.sessions.find((session) => (
          session.id === runtimeSessionId ||
          session.runtimeSessionId === runtimeSessionId ||
          session.officialSessionId === runtimeSessionId
        )) ?? useAppStore.getState().currentSession ?? undefined;
    const ownerId = targetSession
      ? roomAgentId ?? getPrimaryRoomAgent(targetSession).id
      : roomAgentId;
    const appPermissionMode = useAppStore.getState().permissionMode;
    const targetAgent = targetSession && ownerId ? getRoomAgent(targetSession, ownerId, appPermissionMode) : null;
    const previousMode = targetAgent?.permissionMode ?? targetSession?.permissionMode ?? appPermissionMode;
    emitPermissionModeDiag("apply:start", {
      traceId,
      requestedMode: mode,
      previousMode,
      runtimeSessionId,
      activeSessionId: targetSession?.id,
      activeRuntimeSessionId: runtimeSessionId,
      currentSessionId: useAppStore.getState().currentSession?.id,
      runningSessionId: useAppStore.getState().runningSessionId,
      sessionCount: stateSnapshot.sessions.length,
    });
    // Only push to the SDK when a real runtime session exists. Using the UI-id
    // fallback here would hit "session not active" before the first message is
    // sent and wrongly roll the UI mode back. New sessions carry permissionMode
    // into createKimiCodeSession at send time, so the local update is enough.
    let appliedRuntimeSessionId = runtimeSessionId;
    if (runtimeSessionId) {
      emitPermissionModeDiag("apply:before-set-permission", {
        traceId,
        requestedMode: mode,
        previousMode,
        runtimeSessionId,
        targetSessionId: targetSession?.id,
        targetRuntimeSessionId: targetSession ? getRuntimeSessionId(targetSession) : undefined,
        targetEventCount: targetSession?.events.length,
        targetUpdatedAt: targetSession?.updatedAt,
      });
      const res = await setKimiCodePermissionWithRecovery({
        sessionId: runtimeSessionId,
        mode,
        projectPath: targetSession?.projectPath,
        additionalWorkDirs: normalizeAdditionalWorkDirs(useAppStore.getState().additionalWorkDirs),
        setPermission: window.api.setKimiCodePermission,
        resumeSession: window.api.resumeKimiCodeSession,
      });
      if (!res.success) {
        emitPermissionModeDiag("apply:error", {
          traceId,
          requestedMode: mode,
          previousMode,
          runtimeSessionId,
          targetSessionId: targetSession?.id,
          error: res.error,
        });
        if (!targetSession?.collaboration) setPermissionMode(previousMode);
        window.dispatchEvent(new CustomEvent("kimix:toast", {
          detail: `权限切换失败：${res.error}`,
        }));
        return;
      }
      appliedRuntimeSessionId = res.sessionId;
      emitPermissionModeDiag("apply:after-set-permission", {
        traceId,
        requestedMode: mode,
        previousMode,
        runtimeSessionId,
        appliedRuntimeSessionId,
        targetSessionId: targetSession?.id,
        recoveredRuntimeSession: appliedRuntimeSessionId !== runtimeSessionId,
      });
      if (targetSession && ownerId && appliedRuntimeSessionId !== runtimeSessionId) {
        emitPermissionModeDiag("apply:update-runtime-binding", {
          traceId,
          requestedMode: mode,
          previousMode,
          targetSessionId: targetSession.id,
          runtimeSessionId,
          appliedRuntimeSessionId,
        });
        updateSession(targetSession.id, (session) => updateRoomMutationOwner(session, ownerId, (agent) => ({
          ...agent,
          runtimeSessionId: appliedRuntimeSessionId,
          officialSessionId: appliedRuntimeSessionId,
        }), previousMode));
      }
    }

    if (targetSession && ownerId) {
      updateSession(targetSession.id, (session) => ({
        ...updateRoomMutationOwner(session, ownerId, (agent) => ({ ...agent, permissionMode: mode }), previousMode),
        updatedAt: Date.now(),
      }));
      syncCurrentSessionFromStore(targetSession.id);
    }

    emitPermissionModeDiag("apply:before-set-ui-mode", {
      traceId,
      requestedMode: mode,
      previousMode,
      runtimeSessionId,
      appliedRuntimeSessionId,
      currentSessionId: useAppStore.getState().currentSession?.id,
      runningSessionId: useAppStore.getState().runningSessionId,
    });
    if (!targetSession?.collaboration) setPermissionMode(mode);
    emitPermissionModeDiag("apply:after-set-ui-mode", {
      traceId,
      requestedMode: mode,
      previousMode,
      runtimeSessionId,
      appliedRuntimeSessionId,
      currentPermissionMode: targetSession?.collaboration ? mode : useAppStore.getState().permissionMode,
      currentSessionId: useAppStore.getState().currentSession?.id,
      runningSessionId: useAppStore.getState().runningSessionId,
    });
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: targetAgent ? `${targetAgent.displayName} · 权限模式已切换` : "权限模式已切换",
    }));
  }, [setPermissionMode, updateSession]);

  const handleSetPermissionMode = async (mode: PermissionMode) => {
    const traceId = genId();
    const owner = activeMutationOwner;
    if (!owner) {
      setShowPermissionMenu(false);
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: mutationOwnerError || "请先选择一个 Agent。" }));
      return;
    }
    const previousMode = mutationPermissionMode ?? permissionMode;
    emitPermissionModeDiag("click", {
      traceId,
      requestedMode: mode,
      previousMode,
      activeSessionId: activeSession?.id,
      activeRuntimeSessionId,
      currentSessionId: currentSession?.id,
      runningSessionId,
      isCurrentSessionRunning,
      hasPendingPermissionChange: Boolean(pendingPermissionChangeRef.current),
      showPermissionMenu,
    });
    setShowPermissionMenu(false);
    emitPermissionModeDiag("menu:closed", {
      traceId,
      requestedMode: mode,
      previousMode,
      activeSessionId: activeSession?.id,
      activeRuntimeSessionId,
      currentSessionId: currentSession?.id,
      runningSessionId,
      isCurrentSessionRunning,
    });
    if (previousMode === mode) {
      emitPermissionModeDiag("click:noop-same-mode", {
        traceId,
        requestedMode: mode,
        previousMode,
      });
      return;
    }
    if (activeSession?.collaboration && isMutationOwnerRunning) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `${owner.displayName} 正在运行，请在本轮结束后切换权限。`,
      }));
      return;
    }
    if (activeSession && isMutationOwnerRunning) {
      if (!activeRuntimeSessionId) {
        emitPermissionModeDiag("pending:error-no-runtime", {
          traceId,
          requestedMode: mode,
          previousMode,
          activeSessionId: activeSession.id,
          runningSessionId,
        });
        window.dispatchEvent(new CustomEvent("kimix:toast", {
          detail: "当前轮 runtime 尚未就绪，无法记录权限切换",
        }));
        return;
      }
      pendingPermissionChangeRef.current = {
        sessionId: activeSession.id,
        runtimeSessionId: activeRuntimeSessionId,
        roomAgentId: owner.roomAgentId,
        mode,
      };
      emitPermissionModeDiag("pending:stored", {
        traceId,
        requestedMode: mode,
        previousMode,
        activeSessionId: activeSession.id,
        activeRuntimeSessionId,
        currentSessionId: currentSession?.id,
        runningSessionId,
      });
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: "已记录，将在当前轮结束后安全切换权限",
      }));
      return;
    }
    await applyPermissionMode(mode, activeRuntimeSessionId, owner.roomAgentId, traceId);
  };

  useEffect(() => window.api.onKimiCodeEvent((payload) => {
    const pending = pendingPermissionChangeRef.current;
    if (!isPendingPermissionTurnEnded(pending, payload)) return;
    pendingPermissionChangeRef.current = null;
    const traceId = genId();
    emitPermissionModeDiag("pending:turn-ended", {
      traceId,
      requestedMode: pending.mode,
      pendingSessionId: pending.sessionId,
      pendingRuntimeSessionId: pending.runtimeSessionId,
      eventType: payload.type,
      eventSessionId: payload.sessionId,
      eventRuntimeSessionId: payload.runtimeSessionId,
      currentSessionId: useAppStore.getState().currentSession?.id,
      runningSessionId: useAppStore.getState().runningSessionId,
    });
    void applyPermissionMode(pending.mode, pending.runtimeSessionId, pending.roomAgentId, traceId);
  }), [applyPermissionMode]);

  const handleTogglePlanMode = async () => {
    if (!canTogglePlanMode) return;
    const owner = activeMutationOwner;
    if (!activeSession || !owner) {
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: mutationOwnerError || "请先选择一个 Agent。" }));
      return;
    }
    const next = !mutationPlanMode;
    updateSession(activeSession.id, (session) => ({
      ...updateRoomMutationOwner(session, owner.roomAgentId, (agent) => ({ ...agent, planMode: next }), permissionMode),
      updatedAt: Date.now(),
    }));
    syncCurrentSessionFromStore(activeSession.id);
    if (!activeSession.collaboration) setDefaultPlanMode(next);
    const runtimeSessionId = owner.runtimeSessionId ?? null;
    if (!runtimeSessionId) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `${owner.displayName} · ${next ? "Plan 模式已开启，新会话发送时生效" : "Plan 模式已关闭"}`,
      }));
      return;
    }
    const res = await window.api.setKimiCodePlanMode({ sessionId: runtimeSessionId, enabled: next });
    if (!res.success) {
      updateSession(activeSession.id, (session) => ({
        ...updateRoomMutationOwner(session, owner.roomAgentId, (agent) => ({ ...agent, planMode: !next }), permissionMode),
        updatedAt: Date.now(),
      }));
      syncCurrentSessionFromStore(activeSession.id);
      if (!activeSession.collaboration) setDefaultPlanMode(!next);
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `Plan 模式切换失败：${res.error}`,
      }));
      return;
    }
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: `${owner.displayName} · ${next ? "Plan 模式已开启" : "Plan 模式已关闭"}`,
    }));
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && canUseComposer) {
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      const otherFiles = files.filter((file) => !file.type.startsWith("image/"));
      if (imageFiles.length > 0) {
        void addImageFiles(imageFiles);
      }
      if (otherFiles.length === 0) return;
      addFileAttachments(otherFiles);
    }
  };

  const handleSendPendingNow = async (id: string) => {
    const pending = pendingMessages.find((msg) => msg.id === id);
    if (!pending || !canUseComposer) return;
    if (hasActiveAssistantTurn && currentSession) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: "当前轮次还没结束，这条消息会留在队列里，等待当前轮次结束后自动发送。",
      }));
      return;
    }
    removePendingMessage(id);
    const pendingAttachments = (pending.images ?? []).map((image) => ({
      id: image.id ?? genId(),
      kind: image.kind ?? (image.dataUrl ? "image" as const : "file" as const),
      name: image.name,
      dataUrl: image.dataUrl,
      filePath: image.filePath,
    }));
    await sendPromptContent(pending.content, {
      manualSubmitAutoScroll: false,
      images: pendingAttachments,
    });
  };

  const handleSteerPending = async (id: string, roomAgentId?: string) => {
    const pending = pendingMessages.find((msg) => msg.id === id);
    if (!pending || !canUseComposer) return;
    if (!activeSession || !canSteerActiveTurn) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: "当前没有可引导的运行轮次，这条消息会继续排队等待本轮结束。",
      }));
      return;
    }
    if (activeSession.collaboration && !roomAgentId && roomSteerTargets.length > 1) {
      setRoomControlRequest({ action: "steer-pending", pendingId: id });
      return;
    }
    let roomTarget: RoomAgentControlTarget | undefined;
    let runtimeSessionId = getRuntimeSessionId(activeSession);
    if (activeSession.collaboration) {
      try {
        const latest = useSessionStore.getState().sessions.find((session) => session.id === activeSession.id) ?? activeSession;
        roomTarget = resolveRoomAgentControlTarget(
          latest,
          Object.values(useAppStore.getState().roomAgentActivities),
          "steer",
          roomAgentId,
        );
        runtimeSessionId = roomTarget.runtimeSessionId;
      } catch (error) {
        window.dispatchEvent(new CustomEvent("kimix:toast", { detail: error instanceof Error ? error.message : String(error) }));
        return;
      }
    }
    if (!runtimeSessionId) return;
    const steerId = insertLocalSteerMessage(
      activeSession.id,
      pending.content || "[附件]",
      (pending.images ?? [])
        .map((image) => ({
          id: image.id ?? genId(),
          kind: image.kind ?? (image.dataUrl ? "image" as const : "file" as const),
          name: image.name,
          dataUrl: image.dataUrl,
          filePath: image.filePath,
        })),
      roomTarget,
    );
    removePendingMessage(id);
    const res = await window.api.steerKimiCode({
      sessionId: runtimeSessionId,
      content: buildAttachmentPromptContent(pending.content, (pending.images ?? []).map((image) => ({
        id: image.id ?? genId(),
        kind: image.kind ?? (image.dataUrl ? "image" as const : "file" as const),
        name: image.name,
        dataUrl: image.dataUrl,
        filePath: image.filePath,
      }))),
      images: (pending.images ?? [])
        .filter((image) => Boolean(image.dataUrl))
        .map((image) => ({ name: image.name, dataUrl: image.dataUrl as string })),
    });
    if (!res.success) {
      if (/not active|not found|session/i.test(res.error) && activeSession) {
        if (roomTarget) {
          updateSession(activeSession.id, (session) => updateRoomAgent(
            session,
            roomTarget!.roomAgentId,
            (agent) => ({ ...agent, runtimeSessionId: undefined }),
          ));
        } else {
          updateSession(activeSession.id, (session) => ({ ...session, runtimeSessionId: undefined }));
        }
      }
      updateSteerStatus(activeSession.id, steerId, "failed", res.error, roomTarget);
      addPendingMessage(activeSession.id, pending.content, pending.images);
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `引导失败：${res.error}` }));
      return;
    }
    updateSteerStatus(activeSession.id, steerId, "accepted", undefined, roomTarget);
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: roomTarget ? `已向 ${roomTarget.displayName} 发送引导请求` : "已发送引导请求",
    }));
  };

  const handleRoomControlSelection = async (roomAgentId: string) => {
    const request = roomControlRequest;
    setRoomControlRequest(null);
    if (!request) return;
    if (request.action === "stop") {
      await handleStop(roomAgentId);
      return;
    }
    if (request.action === "steer-pending") {
      await handleSteerPending(request.pendingId, roomAgentId);
      return;
    }
    await handleSteer(roomAgentId);
  };

  const handleEditPending = (id: string) => {
    const pending = pendingMessages.find((msg) => msg.id === id);
    if (!pending) return;
    setInput(pending.content);
    setImageAttachments((pending.images ?? []).map((image) => ({
      id: image.id ?? genId(),
      kind: image.kind ?? (image.dataUrl ? "image" as const : "file" as const),
      name: image.name,
      dataUrl: image.dataUrl,
      filePath: image.filePath,
    })));
    removePendingMessage(id);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const applyCompletion = (item: CompletionItem) => {
    if (!activeCompletion) return;
    setInput((value) => `${value.slice(0, activeCompletion.start)}${item.insertText}`);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleCompletionKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!activeCompletion || completionItems.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveCompletionIndex((index) => (index + 1) % completionItems.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveCompletionIndex((index) => (index - 1 + completionItems.length) % completionItems.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const item = completionItems[activeCompletionIndex] ?? completionItems[0];
      const typedCommand = input.slice(activeCompletion.start).trim().toLowerCase();
      const completedCommand = item?.insertText.trim().toLowerCase();
      if (event.key === "Enter" && typedCommand && completedCommand && typedCommand === completedCommand) {
        return;
      }
      event.preventDefault();
      applyCompletion(item);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setInput((value) => value.slice(0, activeCompletion.start));
    }
  };

  const permissionLabel = {
    manual: "手动审批",
    auto: "自动权限",
    yolo: "完全访问权限",
  }[mutationPermissionMode ?? permissionMode];

  const placeholder = roomReadOnly
    ? "多 Agent 房间功能当前处于只读 gate"
    : selectedRoomAgents.length > 0 && activeSession?.collaboration
      ? `默认发送给 ${selectedRoomAgents.map((agent) => agent.displayName).join("、")}；@Agent 可临时覆盖`
        : canUseComposer
          ? "向 Agent 询问任何事。输入 @ 使用插件或提及文件"
    : isCurrentSessionHandoff
      ? "正在生成交接内容..."
      : "请先选择项目";
  const composerCardSessionId = activeSession?.id ?? "__global__";
  const hiddenCards = hiddenComposerCards[composerCardSessionId] ?? [];
  const visibleTodos = activeSession ? getVisibleTodos(activeSession.events) : [];
  const todoHidden = hiddenCards.includes("todo");
  const pendingHidden = hiddenCards.includes("pending");
  const goalHidden = hiddenCards.includes("goal");
  const currentGoal = mutationSessionView?.officialGoal?.goal ?? null;
  const goalStatus = currentGoal?.status ?? "";
  const showGoalModeCard = Boolean(currentGoal && !goalHidden && !["complete", "cancelled", "canceled"].includes(goalStatus));
  const goalToneClass = goalStatus === "blocked"
    ? "text-accent-danger"
    : goalStatus === "paused"
      ? "text-accent-warning"
      : "text-accent-primary";
  const canSendNow = canUseComposer && (input.trim().length > 0 || imageAttachments.length > 0);
  const visibleRoomControlTargets = roomControlRequest?.action === "stop" ? roomStopTargets : roomSteerTargets;
  const roomControlTitle = roomControlRequest?.action === "stop" ? "选择要停止的 Agent" : "选择要引导的 Agent";
  const hideComposerCard = (card: ComposerDockCard, label: string) => {
    setComposerCardHidden(composerCardSessionId, card, true);
    window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `${label}已收起，可在右侧会话侧栏恢复。` }));
  };

  return (
    <div
      className="relative flex w-full flex-col"
      style={{ paddingTop: 8 }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {activeSession && visibleTodos.length > 0 && !todoHidden && (
        <TodoPanel
          events={activeSession.events}
          onDismiss={() => hideComposerCard("todo", "TodoList")}
        />
      )}

      {pendingMessages.length > 0 && !pendingHidden && (
        <div
          className="kimix-floating-panel overflow-hidden rounded-[15px] text-[13px]"
          style={{ marginBottom: 8 }}
        >
          <div className="flex h-11 items-center justify-between border-b border-[var(--kimix-panel-divider)] text-[14.5px] text-[var(--kimix-panel-text-secondary)]" style={{ gap: 12, paddingLeft: 20, paddingRight: 14 }}>
            <span className="min-w-0 truncate">{pendingMessages.length} 条消息正在排队</span>
            {hasActiveAssistantTurn && <span className="shrink-0 text-[var(--kimix-panel-text-muted)]">当前任务结束后继续</span>}
            <button
              type="button"
              onClick={() => hideComposerCard("pending", "排队消息")}
              className="kimix-muted-action flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              title="收起到侧栏"
              aria-label="收起排队消息"
            >
              <X size={13} />
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto">
            {pendingMessages.map((msg, index) => (
              <div
                key={msg.id}
                draggable
                onDragStart={(event) => {
                  setDraggingPendingId(msg.id);
                  setIsDragging(false);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", msg.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const dragId = draggingPendingId || event.dataTransfer.getData("text/plain");
                  if (dragId && dragId !== msg.id) reorderPendingMessage(dragId, msg.id);
                }}
                onDragEnd={() => setDraggingPendingId(null)}
                className={`group flex min-h-[42px] min-w-0 items-center gap-2 border-b border-[var(--kimix-panel-divider)] last:border-b-0 hover:bg-[var(--kimix-panel-soft-bg)] ${
                  draggingPendingId === msg.id ? "bg-[var(--kimix-panel-hover)] opacity-70" : ""
                }`}
                style={{ paddingLeft: 18, paddingRight: 18 }}
              >
                <div className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-lg text-[var(--kimix-panel-text-muted)] active:cursor-grabbing">
                  <GripVertical size={15} />
                </div>
                <div className="min-w-0 flex-1 truncate text-[14px] leading-5 text-[var(--kimix-panel-text)]">
                  {msg.content || "[图片]"}
                  {(msg.images?.length ?? 0) > 0 && (
                    <span className="text-[12.5px] text-[var(--kimix-panel-text-muted)]"> · {msg.images?.length} 个附件</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1 text-[var(--kimix-panel-text-muted)]">
                  {canSteerActiveTurn ? (
                    <button onClick={() => void handleSteerPending(msg.id)} className="kimix-icon-text-button is-compact text-[13px] text-accent-blue hover:bg-accent-blue/10" title="立即引导：把这条消息插入运行中的对话（官方 Ctrl+S steer），让 agent 尽快处理">
                      <Zap size={13} />
                      <span>引导</span>
                    </button>
                  ) : hasActiveAssistantTurn ? (
                    <span className="shrink-0 text-[13px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                      等待
                    </span>
                  ) : (
                    <button onClick={() => handleSendPendingNow(msg.id)} className="kimix-icon-text-button kimix-muted-action is-compact text-[13px]" title="发送这条队列消息">
                      <Send size={13} />
                      <span>发送</span>
                    </button>
                  )}
                  <button onClick={() => handleEditPending(msg.id)} className="kimix-muted-action flex h-7 w-7 items-center justify-center rounded-lg transition-colors" title="撤回到输入框修改" aria-label="撤回到输入框修改">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => removePendingMessage(msg.id)} className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-accent-red/10 hover:text-accent-red" title="删除" aria-label="删除">
                    <Trash2 size={13} />
                  </button>
                  <div className="relative" ref={(el) => { pendingMoreRefs.current[msg.id] = el; }}>
                    <button
                      type="button"
                      onClick={() => setPendingMoreId((prev) => (prev === msg.id ? null : msg.id))}
                      className={`kimix-muted-action flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${pendingMoreId === msg.id ? "bg-[var(--kimix-panel-hover)]" : ""}`}
                      title="更多"
                      aria-label="更多"
                      aria-expanded={pendingMoreId === msg.id}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    {pendingMoreId === msg.id && (
                      <div className="absolute right-0 top-full z-10 mt-1 flex min-w-[120px] flex-col rounded-lg border border-[var(--kimix-panel-border)] bg-[var(--kimix-panel-bg)] py-1 shadow-lg" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          disabled={index === 0}
                          onClick={() => { promotePendingMessage(msg.id); setPendingMoreId(null); }}
                          className="px-3 py-1.5 text-left text-[13px] text-[var(--kimix-panel-text)] hover:bg-[var(--kimix-panel-hover)] disabled:text-[var(--kimix-panel-text-muted)] disabled:opacity-50"
                        >
                          移到最前
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={index === 0}
                          onClick={() => { movePendingMessage(msg.id, "up"); setPendingMoreId(null); }}
                          className="px-3 py-1.5 text-left text-[13px] text-[var(--kimix-panel-text)] hover:bg-[var(--kimix-panel-hover)] disabled:text-[var(--kimix-panel-text-muted)] disabled:opacity-50"
                        >
                          上移
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={index === pendingMessages.length - 1}
                          onClick={() => { movePendingMessage(msg.id, "down"); setPendingMoreId(null); }}
                          className="px-3 py-1.5 text-left text-[13px] text-[var(--kimix-panel-text)] hover:bg-[var(--kimix-panel-hover)] disabled:text-[var(--kimix-panel-text-muted)] disabled:opacity-50"
                        >
                          下移
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showGoalModeCard && currentGoal && (
        <div
          className="kimix-floating-panel overflow-hidden rounded-[15px] text-[13px]"
          style={{ marginBottom: 8 }}
        >
          <div
            className="grid min-h-10 items-center text-[14px] text-[var(--kimix-panel-text-secondary)]"
            style={{ gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 10, paddingLeft: 20, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}
          >
            <div className="flex min-w-0 items-center" style={{ gap: 10 }}>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-primary-light ${goalToneClass}`}>
                {goalStatus === "active" ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} />}
              </span>
              <span className={`shrink-0 text-[13px] font-medium leading-5 ${goalToneClass}`}>
                Goal {goalStatusLabel(goalStatus)}
              </span>
              <span className="min-w-0 truncate leading-5 text-[var(--kimix-panel-text)]">
                {currentGoal.objective}
              </span>
            </div>
            <span
              className="shrink-0 rounded-lg bg-[var(--kimix-panel-soft-bg)] text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]"
              style={{ minHeight: 24, minWidth: 42, paddingLeft: 9, paddingRight: 9, textAlign: "center" }}
            >
              {currentGoal.turnsUsed ?? 0} 轮
            </span>
            <button
              type="button"
              onClick={() => hideComposerCard("goal", "官方 Goal")}
              className="kimix-muted-action flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              title="收起到侧栏"
              aria-label="收起官方 Goal 状态"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {themeImportPreview && (
        <div
          className="kimix-floating-panel rounded-[16px] text-[13px]"
          style={{ marginBottom: 10, padding: 16 }}
        >
          <div
            className="grid items-start"
            style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, marginBottom: 14 }}
          >
            <div className="min-w-0">
              <div className="text-[14px] font-medium leading-5 text-[var(--kimix-panel-text)]">导入 Kimi Code 主题</div>
              <div className="truncate text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">{themeImportPreview.themesDir}</div>
            </div>
            <button
              type="button"
              onClick={() => setThemeImportPreview(null)}
              className="kimix-muted-action flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              aria-label="关闭主题导入"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
          {themeImportPreview.items.length > 0 ? (
            <div className="flex flex-col" style={{ gap: 12 }}>
              {themeImportPreview.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[12px] border border-[var(--kimix-panel-border)] bg-[var(--kimix-panel-soft-bg)]"
                  style={{ padding: 14 }}
                >
                  <div
                    className="grid items-center"
                    style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center" style={{ gap: 8 }}>
                        <span className="truncate text-[13.5px] font-medium leading-5 text-[var(--kimix-panel-text)]">{item.displayName}</span>
                        <span className="shrink-0 rounded-md bg-[var(--kimix-panel-bg)] text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ paddingLeft: 7, paddingRight: 7 }}>{item.base}</span>
                        <span className="shrink-0 text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">{item.id}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap" style={{ gap: 8 }}>
                        {([
                          ["主色", item.colors.primary, item.sourceTokens.primary],
                          ["背景", item.colors.surface, item.sourceTokens.surface],
                          ["强调", item.colors.accent, item.sourceTokens.accent],
                        ] as const).map(([label, color, token]) => (
                          <span key={label} className="inline-flex items-center rounded-lg bg-[var(--kimix-panel-bg)] text-[12.5px] leading-6 text-[var(--kimix-panel-text-secondary)]" style={{ gap: 7, paddingLeft: 8, paddingRight: 9 }}>
                            <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-[var(--kimix-panel-border)]" style={{ background: color }} />
                            <span>{label}</span>
                            <span className="font-mono text-[12px] text-[var(--kimix-panel-text)]">{color}</span>
                            <span className="text-[var(--kimix-panel-text-muted)]">{token ?? "兜底"}</span>
                          </span>
                        ))}
                      </div>
                      {item.warning && <div className="mt-2 text-[12.5px] leading-5 text-accent-warning">{item.warning}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleApplyThemeImport(item.id)}
                      disabled={themeImportApplyingId === item.id}
                      className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:opacity-55"
                      style={{ minWidth: 86, justifyContent: "center" }}
                    >
                      {themeImportApplyingId === item.id ? "导入中" : "导入"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[12px] border border-dashed border-[var(--kimix-panel-border)] text-[13px] leading-6 text-[var(--kimix-panel-text-muted)]" style={{ padding: 16 }}>
              未发现可导入的官方自定义主题 JSON。可先在 Kimi Code 中使用官方 /custom-theme 生成主题文件。
            </div>
          )}
          {themeImportPreview.warnings.length > 0 && (
            <div className="mt-3 text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">
              {themeImportPreview.warnings.slice(0, 2).join("；")}
            </div>
          )}
        </div>
      )}

      <div
        style={{ paddingLeft: 17, paddingRight: 17, paddingTop: 14, paddingBottom: 10, containerType: "inline-size" }}
        className={`kimix-composer-surface kimix-composer-card relative flex min-w-0 flex-col overflow-visible border transition-colors ${
          isDragging
            ? "border-accent-blue"
            : isFocused
              ? "is-focused"
              : ""
        } ${!canUseComposer ? "opacity-60" : ""}`}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-accent-primary bg-accent-primary/5">
            <span className="text-sm font-medium text-accent-primary">释放以添加附件</span>
          </div>
        )}
        {shouldShowCompletionPanel && activeCompletion && (
          <div
            ref={completionListRef}
            className="kimix-floating-panel mb-3 max-h-[276px] overflow-y-auto rounded-[16px] text-[14px]"
            style={{ padding: 10 }}
            onMouseDown={(event) => event.preventDefault()}
          >
            {activeCompletion.mode === "mention" ? (
              <>
                {filteredMentionBaseItems.some((item) => item.kind === "agent") && (
                  <>
                    <div className="px-2 pb-1.5 text-[13px] text-[var(--kimix-panel-text-muted)]">智能体</div>
                    {filteredMentionBaseItems.filter((item) => item.kind === "agent").map((item) => {
                      const index = completionItems.findIndex((candidate) => candidate.id === item.id);
                      return (
                        <button
                          ref={(node) => { completionItemRefs.current[item.id] = node; }}
                          key={item.id}
                          type="button"
                          onClick={() => applyCompletion(item)}
                          className={`flex h-9 w-full items-center gap-2.5 rounded-xl text-left transition-colors ${activeCompletionIndex === index ? "bg-[var(--kimix-panel-hover)] text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                          style={{ paddingLeft: 10, paddingRight: 12 }}
                        >
                          <Bot size={15} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />
                          <span className="shrink-0">{item.label}</span>
                          {item.detail && <span className="min-w-0 truncate text-[var(--kimix-panel-text-muted)]">{item.detail}</span>}
                        </button>
                      );
                    })}
                  </>
                )}
                <div className="px-2 pb-1.5 pt-2 text-[13px] text-[var(--kimix-panel-text-muted)]">插件</div>
                {filteredMentionBaseItems.filter((item) => item.kind === "plugin").map((item) => {
                  const index = completionItems.findIndex((candidate) => candidate.id === item.id);
                  return (
                    <button
                      ref={(node) => { completionItemRefs.current[item.id] = node; }}
                      key={item.id}
                      type="button"
                      onClick={() => applyCompletion(item)}
                      className={`flex h-9 w-full items-center gap-2.5 rounded-xl text-left transition-colors ${activeCompletionIndex === index ? "bg-[var(--kimix-panel-hover)] text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                      style={{ paddingLeft: 10, paddingRight: 12 }}
                    >
                      <Puzzle size={15} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />
                      <span className="shrink-0">{item.label}</span>
                      {item.detail && <span className="min-w-0 truncate text-[var(--kimix-panel-text-muted)]">{item.detail}</span>}
                    </button>
                  );
                })}
                <div className="px-2 pb-1.5 pt-2 text-[13px] text-[var(--kimix-panel-text-muted)]">文件</div>
                {fileItems.length > 0 ? fileItems.map((item) => {
                  const index = completionItems.findIndex((candidate) => candidate.id === item.id);
                  return (
                    <button
                      ref={(node) => { completionItemRefs.current[item.id] = node; }}
                      key={item.id}
                      type="button"
                      onClick={() => applyCompletion(item)}
                      className={`flex h-9 w-full items-center gap-2.5 rounded-xl text-left transition-colors ${activeCompletionIndex === index ? "bg-[var(--kimix-panel-hover)] text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                      style={{ paddingLeft: 10, paddingRight: 12 }}
                    >
                      <FileText size={15} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />
                      <span className="min-w-0 flex-1 truncate">{item.detail}</span>
                    </button>
                  );
                }) : (
                  <div className="px-2 py-1.5 text-[var(--kimix-panel-text-muted)]">输入内容搜索文件</div>
                )}
              </>
            ) : (
              <>
                <div className="px-2 pb-1.5 text-[13px] text-[var(--kimix-panel-text-muted)]">{isSkillCompletion ? "Skill" : "命令"}</div>
                {completionItems.length > 0 ? completionItems.map((item, index) => (
                  <button
                    ref={(node) => { completionItemRefs.current[item.id] = node; }}
                    key={item.id}
                    type="button"
                    onClick={() => applyCompletion(item)}
                    className={`flex h-9 w-full items-center gap-2.5 rounded-xl text-left transition-colors ${activeCompletionIndex === index ? "bg-[var(--kimix-panel-hover)] text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                    style={{ paddingLeft: 10, paddingRight: 12 }}
                  >
                    {item.kind === "skill"
                      ? <Puzzle size={15} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />
                      : <TerminalSquare size={15} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />}
                    <span className="shrink-0">{item.label}</span>
                    {item.detail && <span className="min-w-0 truncate text-[var(--kimix-panel-text-muted)]">{item.detail}</span>}
                  </button>
                )) : (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-[var(--kimix-panel-text-muted)]">
                    <AtSign size={14} />
                    <span>{isSkillCompletion ? "正在加载已有 Skill，或当前没有可调用的 Skill" : "正在从 Agent 加载命令，或当前会话未返回 slash_commands"}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {imageAttachments.length > 0 && (
          <div className="flex flex-wrap" style={{ gap: 10, paddingTop: 2, paddingBottom: 12 }}>
            {imageAttachments.map((attachment) => {
              const isImage = Boolean(attachment.dataUrl);
              return (
                <div
                  key={attachment.id}
                  className={`kimix-media-thumb group relative overflow-hidden rounded-xl text-left shadow-[0_1px_2px_rgba(25,23,20,0.05)] transition-colors ${isImage ? "h-20 w-20" : "h-20 w-[176px]"}`}
                  title={isImage ? undefined : attachment.filePath || attachment.name}
                >
                  {isImage ? (
                    <button
                      type="button"
                      onClick={() => setPreviewImage(attachment as ImageAttachment & { dataUrl: string })}
                      className="block h-full w-full"
                      title="点击查看图片"
                      aria-label={`查看图片 ${attachment.name}`}
                    >
                      <img src={attachment.dataUrl} alt={attachment.name} className="h-full w-full object-cover" />
                    </button>
                  ) : (
                    <div className="flex h-full min-w-0 flex-col justify-center text-[var(--kimix-panel-text)]" style={{ gap: 5, paddingLeft: 14, paddingRight: 34 }}>
                      <div className="flex min-w-0 items-center" style={{ gap: 8 }}>
                        <FileText size={16} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />
                        <span className="min-w-0 truncate text-[13px] font-medium">{attachment.name}</span>
                      </div>
                      <div className="truncate text-[12px] text-[var(--kimix-panel-text-muted)]">
                        {attachment.filePath || "未读取到绝对路径"}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setImageAttachments((prev) => prev.filter((item) => item.id !== attachment.id));
                      if (previewImage?.id === attachment.id) setPreviewImage(null);
                    }}
                    className="kimix-inline-icon-action absolute z-10 rounded-full bg-accent-danger/85 text-white opacity-95 hover:bg-accent-danger"
                    style={{
                      top: 4,
                      right: 4,
                      padding: 0,
                      width: 20,
                      height: 20,
                      lineHeight: 0,
                    }}
                    title={isImage ? "移除图片" : "移除附件"}
                    aria-label={isImage ? "移除图片" : "移除附件"}
                  >
                    <X size={10} style={{ display: "block" }} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <ComposerInput
          ref={inputRef}
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onPaste={handlePaste}
          onKeyDownCapture={handleCompletionKeyDown}
          placeholder={placeholder}
          disabled={!canUseComposer}
        />

        <div className="kimix-composer-toolbar mt-2 flex h-9 min-w-0 flex-nowrap items-center justify-between gap-3">
          <div className="kimix-composer-toolbar-primary flex min-w-0 flex-1 items-center gap-1" style={{ marginLeft: -6 }}>
            <div ref={addBtnRef} className="relative">
              <button disabled={!canUseComposer} onClick={() => setShowAddMenu((value) => !value)} className={iconButtonClass} title="更多工具" aria-label="更多工具">
                <Plus size={18} />
              </button>
              {showAddMenu && (
                <div className="kimix-floating-panel absolute bottom-full left-0 z-30 mb-2 w-[260px] rounded-xl" style={{ padding: "14px 14px 14px" }}>
                  <div className="flex flex-col" style={{ gap: 14 }}>
                    {multiAgentRoomUiAvailable && (
                      <section>
                        <button
                          type="button"
                          disabled={!canUseComposer || activeRoomBusy || activeRoomAgents.length >= 4}
                          onClick={() => void handleOpenAddRoomAgent()}
                          className="grid w-full items-center rounded-xl text-left transition-colors hover:bg-[var(--kimix-panel-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                          style={{ gridTemplateColumns: "32px minmax(0, 1fr) auto", gap: 10, minHeight: 48, paddingLeft: 8, paddingRight: 8 }}
                          title={activeRoomAgents.length >= 4 ? "一个房间最多 4 个 Agent" : "添加使用独立上下文的 Agent"}
                        >
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--kimix-panel-soft-bg)] text-[var(--kimix-panel-text-secondary)]">
                            <Bot size={15} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13.5px] font-medium text-[var(--kimix-panel-text)]">添加 Agent</span>
                            <span className="block truncate text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">独立上下文与模型</span>
                          </span>
                          <span className="shrink-0 text-[12px] text-[var(--kimix-panel-text-muted)]">
                            {activeRoomAgents.length || 1}/4
                          </span>
                        </button>
                      </section>
                    )}

                    <section className={multiAgentRoomUiAvailable ? "border-t border-[var(--kimix-panel-divider)]" : undefined} style={multiAgentRoomUiAvailable ? { paddingTop: 14 } : undefined}>
                      <div className="flex items-center justify-between" style={{ gap: 10, marginBottom: 10 }}>
                        <div className="flex min-w-0 items-center gap-2 text-[13.5px] font-medium text-[var(--kimix-panel-text)]">
                          <Palette size={15} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />
                          <span>画板</span>
                        </div>
                        <span className="shrink-0 text-[12.5px] text-[var(--kimix-panel-text-muted)]">新建空白画布</span>
                      </div>
                      <div className="grid justify-between" style={{ gridTemplateColumns: "repeat(5, 38px)", gap: 6 }}>
                        {DRAWING_BOARD_RATIOS.map((ratio) => (
                          <button
                            key={ratio}
                            type="button"
                            onClick={() => openBlankDrawingBoard(ratio)}
                            className="kimix-icon-text-button is-compact justify-center rounded-lg text-[13px] text-text-secondary hover:bg-[var(--kimix-panel-hover)]"
                            style={{ width: 38, paddingLeft: 0, paddingRight: 0 }}
                          >
                            {ratio}
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className="border-t border-[var(--kimix-panel-divider)]" style={{ paddingTop: 14 }}>
                      <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2 text-[13.5px] font-medium text-[var(--kimix-panel-text)]">
                            <Zap size={15} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />
                            <span>Swarm 模式</span>
                          </div>
                          <p className="m-0 text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 6 }}>
                            多子代理并行推进
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={!canUseComposer || !hasUniqueMutationOwner}
                          onClick={() => {
                            setShowAddMenu(false);
                            void setSwarmModeForCurrentSession(!swarmModeEnabled, { feedback: "toast" });
                          }}
                          className={`kimix-icon-text-button is-compact justify-center rounded-lg text-[13px] disabled:cursor-not-allowed disabled:opacity-55 ${swarmModeEnabled ? "text-accent-primary" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                          style={{ minWidth: 72, height: 32, paddingLeft: 12, paddingRight: 12 }}
                          title={swarmModeEnabled
                            ? `关闭 ${activeMutationOwner?.displayName ?? "Agent"} 的 Swarm；运行中切换会在下一轮生效`
                            : `开启 ${activeMutationOwner?.displayName ?? "Agent"} 的 Swarm；运行中切换会在下一轮生效`
                          }
                        >
                          {swarmModeEnabled ? "关闭" : "开启"}
                        </button>
                      </div>
                    </section>

                  </div>
                </div>
              )}
            </div>

            <div ref={permissionBtnRef} className="relative min-w-0 shrink">
              <button
                disabled={!canUseComposer || !hasUniqueMutationOwner || isMutationOwnerRunning}
                onClick={() => setShowPermissionMenu((v) => !v)}
                className="kimix-icon-text-button kimix-muted-action is-compact max-w-[188px] min-w-0 disabled:cursor-not-allowed disabled:opacity-35"
                title={!hasUniqueMutationOwner
                  ? mutationOwnerError
                  : isMutationOwnerRunning
                    ? `${activeMutationOwner?.displayName ?? "Agent"} 正在运行，本轮结束后可切换权限`
                    : activeMutationOwner ? `修改 ${activeMutationOwner.displayName} 的权限` : undefined}
              >
                {(() => {
                  const PermissionIcon = permissionMenuIcons[mutationPermissionMode ?? permissionMode];
                  return <PermissionIcon size={14} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />;
                })()}
                <span className="truncate">{permissionLabel}</span>
                <ChevronDown size={12} className="shrink-0" />
              </button>
              {showPermissionMenu && (
                <div className="kimix-floating-panel absolute bottom-full left-0 z-30 mb-2 w-[216px] rounded-xl" style={{ paddingTop: 12, paddingBottom: 12 }}>
                  {PERMISSION_OPTIONS.map((opt) => {
                    const Icon = permissionMenuIcons[opt.value];
                    return (
                      <button key={opt.value} title={opt.tooltip} onClick={() => void handleSetPermissionMode(opt.value)} style={{ paddingLeft: 18, paddingRight: 18, paddingTop: 13, paddingBottom: 13, minHeight: 40 }} className={`flex w-full items-center gap-3.5 text-left text-[13px] leading-none hover:bg-[var(--kimix-panel-hover)] ${(mutationPermissionMode ?? permissionMode) === opt.value ? "text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)]"}`}>
                        <Icon size={13} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />
                        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                        {(mutationPermissionMode ?? permissionMode) === opt.value && <Check size={13} className="mr-1 shrink-0 text-[var(--kimix-panel-text)]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {multiAgentRoomUiAvailable && activeSession?.collaboration && activeRoomAgents.length > 1 && selectedRoomAgentIds.length > 0 && (
              <RoomAgentPicker
                session={activeSession}
                activities={roomAgentActivities}
                selectedAgentIds={selectedRoomAgentIds}
                busyAgentId={roomAgentMutationId}
                disabled={!canUseComposer}
                onSelectionChange={(roomAgentIds) => void handleSelectRoomAgents(roomAgentIds)}
                onEdit={handleEditRoomAgent}
                onRetry={(roomAgentId) => void handleRetryRoomAgent(roomAgentId)}
                onRemove={(roomAgentId) => void handleRemoveRoomAgent(roomAgentId)}
              />
            )}

            {multiAgentRoomUiAvailable && activeSession?.collaboration && activeRoomAgents.length > 1 && selectedRoomAgentIds.length > 0 && (
              <RoomContextPicker
                session={activeSession}
                selectedAgentIds={roomContextTargetAgentIds}
                selection={roomContextShareSelection}
                disabled={!canUseComposer}
                onChange={setRoomContextShareSelection}
              />
            )}
          </div>

          <div className="kimix-composer-toolbar-secondary flex shrink-0 items-center gap-1.5">
            {activeSession && (
              <button
                type="button"
                disabled={!canUseComposer || !hasUniqueMutationOwner}
                onClick={() => void setSwarmModeForCurrentSession(!swarmModeEnabled, { feedback: "toast" })}
                className="kimix-icon-text-button kimix-muted-action is-compact min-w-[104px] border disabled:cursor-not-allowed disabled:opacity-35"
                style={{
                  borderColor: swarmModeEnabled ? "var(--accent-primary-soft)" : "transparent",
                  backgroundColor: swarmModeEnabled ? "var(--accent-primary-light)" : "transparent",
                  color: swarmModeEnabled ? "var(--accent-primary-dark)" : undefined,
                  boxShadow: swarmModeEnabled ? "inset 0 0 0 1px rgba(25, 130, 255, 0.16)" : undefined,
                }}
                title={swarmModePending
                  ? `${activeMutationOwner?.displayName ?? "Agent"} 的 Swarm 将在下一轮${swarmModeEnabled ? "开启" : "关闭"}`
                  : swarmModeEnabled
                    ? `关闭 ${activeMutationOwner?.displayName ?? "Agent"} 的 Swarm 模式`
                    : `开启 ${activeMutationOwner?.displayName ?? "Agent"} 的 Swarm 模式`}
                aria-label={swarmModePending ? `Swarm 将在下一轮${swarmModeEnabled ? "开启" : "关闭"}` : `Swarm 模式已${swarmModeEnabled ? "开启" : "关闭"}`}
                aria-pressed={swarmModeEnabled}
              >
                <Zap size={14} className="shrink-0" />
                <span>Swarm {swarmModeEnabled ? "开" : "关"}{swarmModePending ? " · 下轮" : ""}</span>
              </button>
            )}
            <button
              disabled={!canTogglePlanMode}
              onClick={() => void handleTogglePlanMode()}
              className="kimix-icon-text-button kimix-muted-action is-compact min-w-[92px] border disabled:cursor-not-allowed disabled:opacity-35"
                style={{
                borderColor: mutationPlanMode ? "var(--accent-primary-soft)" : "transparent",
                backgroundColor: mutationPlanMode ? "var(--accent-primary-light)" : "transparent",
                color: mutationPlanMode ? "var(--accent-primary-dark)" : undefined,
                boxShadow: mutationPlanMode ? "inset 0 0 0 1px rgba(25, 130, 255, 0.16)" : undefined,
              }}
              title={mutationPlanMode ? `关闭 ${activeMutationOwner?.displayName ?? "Agent"} 的 Plan 模式` : `开启 ${activeMutationOwner?.displayName ?? "Agent"} 的 Plan 模式`}
              aria-pressed={mutationPlanMode}
            >
              <ClipboardList size={14} className="shrink-0" />
              <span>{mutationPlanMode ? "Plan 开" : "Plan 关"}</span>
            </button>
            <button
              disabled={!canUseComposer}
              onClick={() => {
                if (!canUseComposer) return;
                const next = !defaultThinking;
                setDefaultThinking(next);
                window.dispatchEvent(new CustomEvent("kimix:toast", {
                  detail: next ? "思考 开" : "思考 关",
                }));
              }}
              className="kimix-icon-text-button kimix-muted-action is-compact min-w-[100px] border disabled:cursor-not-allowed disabled:opacity-35"
              style={{
                borderColor: defaultThinking ? "var(--accent-primary-soft)" : "transparent",
                backgroundColor: defaultThinking ? "var(--accent-primary-light)" : "transparent",
                color: defaultThinking ? "var(--accent-primary-dark)" : undefined,
                boxShadow: defaultThinking ? "inset 0 0 0 1px rgba(25, 130, 255, 0.16)" : undefined,
              }}
              title={defaultThinking ? "关闭思考" : "开启思考"}
              aria-pressed={defaultThinking}
            >
              <Brain size={14} className="shrink-0" />
              <span>{defaultThinking ? "思考 开" : "思考 关"}</span>
            </button>

            <ContextRing />
            {isWindows() && (
              <button
                disabled={!canUseComposer}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void handleVoiceShortcut()}
                className={iconButtonClass}
                title={`语音快捷键：${voiceShortcut || "Win+H"}`}
                aria-label="语音"
              >
                <Mic size={16} />
              </button>
            )}

            <div ref={roomControlMenuRef} className="relative flex shrink-0 items-center" style={{ gap: 8 }}>
              {roomControlRequest && activeSession?.collaboration && (
                <div
                  className="kimix-floating-panel absolute right-0 z-30 rounded-[14px]"
                  style={{ bottom: 42, width: 268, padding: 10 }}
                >
                  <div
                    className="grid items-center"
                    style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, paddingLeft: 8, paddingRight: 4, paddingTop: 4, paddingBottom: 8 }}
                  >
                    <span className="truncate text-[13px] font-medium text-[var(--kimix-panel-text)]">{roomControlTitle}</span>
                    <button
                      type="button"
                      onClick={() => setRoomControlRequest(null)}
                      className="kimix-muted-action flex h-7 w-7 items-center justify-center rounded-lg"
                      title="关闭"
                      aria-label="关闭 Agent 控制菜单"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="flex flex-col" style={{ gap: 8 }}>
                    {visibleRoomControlTargets.map((target) => (
                      <button
                        key={target.roomAgentId}
                        type="button"
                        onClick={() => void handleRoomControlSelection(target.roomAgentId)}
                        className="grid w-full rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)] text-left transition-colors hover:bg-[var(--kimix-panel-hover)]"
                        style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, minHeight: 42, paddingLeft: 13, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}
                        title={`${roomControlRequest.action === "stop" ? "停止" : "引导"} ${target.displayName}`}
                      >
                        <span className="flex min-w-0 items-center" style={{ gap: 8 }}>
                          <Bot size={14} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />
                          <span className="truncate text-[13px] text-[var(--kimix-panel-text)]">{target.displayName}</span>
                        </span>
                        <span className="shrink-0 text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">
                          {target.runtimeSessionId ? roomControlStatusLabel(target.status) : "运行会话未就绪"}
                        </span>
                      </button>
                    ))}
                  </div>
                  {roomControlRequest.action === "stop" && visibleRoomControlTargets.length > 1 && (
                    <button
                      type="button"
                      onClick={() => void handleStopAllRoomAgents()}
                      className="kimix-icon-text-button w-full justify-center text-accent-red hover:bg-accent-red/10"
                      style={{ minHeight: 34, marginTop: 10, paddingLeft: 12, paddingRight: 12 }}
                    >
                      <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
                      <span>停止全部运行 Agent</span>
                    </button>
                  )}
                </div>
              )}

              {shouldShowStopButton ? (
                <>
                  {canSteerActiveTurn && canSendNow && (
                    <button
                      onClick={() => void handleSteer()}
                      className="flex h-8 shrink-0 items-center rounded-full bg-accent-primary text-white transition-colors hover:bg-accent-primary-dark"
                      style={{ gap: 6, paddingLeft: 12, paddingRight: 14 }}
                      title={roomSteerTargets.length > 1 ? "选择一个运行中的 Agent 并发送引导" : "立即引导当前任务：把输入插入运行中的对话（官方 Ctrl+S steer），不进排队"}
                      aria-label="引导当前任务"
                    >
                      <Zap size={14} strokeWidth={2.5} className="shrink-0" />
                      <span className="text-[13px]">引导</span>
                    </button>
                  )}
                  <button
                    onClick={() => void handleStop()}
                    className="kimix-strong-action flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
                    title={roomStopTargets.length > 1 ? "选择要停止的 Agent" : "停止"}
                    aria-label="停止"
                  >
                    <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
                  </button>
                </>
              ) : (
                <button onClick={handleSend} disabled={!canSendNow} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${canSendNow ? "bg-accent-primary text-white hover:bg-accent-primary-dark" : "bg-surface-hover text-text-muted"}`} title="发送" aria-label="发送">
                  <ArrowUp size={17} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {previewImage && (
        <ImagePreviewOverlay
          image={previewImage}
          images={imageAttachments.filter(isImageAttachment).map((attachment) => ({ id: attachment.id, name: attachment.name, dataUrl: attachment.dataUrl }))}
          onNavigate={setPreviewImage}
          onClose={() => setPreviewImage(null)}
          onSaveDrawing={handleSaveDrawingBoard}
        />
      )}

      {drawingBoardRequest && (
        <DrawingBoard
          request={drawingBoardRequest}
          onClose={() => setDrawingBoardRequest(null)}
          onSave={handleSaveDrawingBoard}
        />
      )}

      {showAddRoomAgentDialog && activeSession && activeSession.id === addRoomAgentTargetId && (
        <AddRoomAgentDialog
          open
          session={activeSession}
          busy={addRoomAgentBusy}
          error={addRoomAgentError}
          onClose={() => {
            if (!addRoomAgentBusy) {
              setShowAddRoomAgentDialog(false);
              setAddRoomAgentTargetId(null);
            }
          }}
          onSubmit={(draft) => void handleAddRoomAgent(draft)}
          onOpenModelSettings={openRoomAgentModelSettings}
        />
      )}

      {editingRoomAgent && (
        <EditRoomAgentDialog
          agent={editingRoomAgent}
          busy={editRoomAgentBusy}
          error={editRoomAgentError}
          onClose={() => {
            if (!editRoomAgentBusy) setEditingRoomAgentId(null);
          }}
          onSubmit={(input) => void handleRenameRoomAgent(input)}
        />
      )}
    </div>
  );
}
