import { useState, useRef, useEffect } from "react";
import { Plus, AlertTriangle, ArrowUp, ChevronDown, Check, Send, Edit2, Trash2, Mic, Hand, ShieldAlert, Brain, X, GripVertical, MoreHorizontal, AtSign, TerminalSquare, FileText, Bot, Puzzle, CircleHelp, ClipboardList, Palette, Zap, Target, Loader2 } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useLiveSession } from "@/hooks/useLiveSession";
import type { ComposerDockCard, Session, TimelineEvent, PermissionMode, ClarificationToolMode, OfficialGoalSnapshot, ThemePaletteColors, KimiThemePalette } from "@/types/ui";
import { kimiThemePaletteId } from "@/utils/themePalettes";
import { ComposerInput, type ComposerInputHandle } from "./ComposerInput";
import { TodoPanel, getVisibleTodos } from "./TodoPanel";
import { SwarmPanel, getVisibleSwarmAgents } from "./SwarmPanel";
import { ContextRing } from "./ContextRing";
import { DrawingBoard, type DrawingBoardRequest } from "./DrawingBoard";
import { ImagePreviewOverlay } from "./ImagePreviewOverlay";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import { isSessionRuntimeRunning } from "@/utils/sessionActivity";
import { isKimiActiveTurnError, sendKimiCodePromptWithRetry } from "@/utils/kimiCodeSendRetry";
import { kimiCodeRouteStatus } from "@/utils/kimiCodeRouteStatus";
import { reconcileOfficialGoalSnapshot } from "@/utils/officialGoalState";
import { classifySlashCommand } from "@/utils/slashRouting";

function genId(): string {
  return Math.random().toString(36).substring(2, 11);
}

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
  auto: Brain,
  yolo: ShieldAlert,
};

const CLARIFICATION_OPTIONS: { value: ClarificationToolMode; label: string; desc: string }[] = [
  { value: "on", label: "开启", desc: "优先澄清不明确需求" },
  { value: "off", label: "关闭", desc: "直接发送原消息" },
  { value: "auto", label: "自动", desc: "由 AI 判断是否需要澄清" },
];

const DRAWING_BOARD_RATIOS: DrawingBoardRequest["ratio"][] = ["1:1", "4:3", "3:4", "16:9", "9:16"];
const FALLBACK_KIMI_MODEL = "kimi-for-coding";

const CLARIFICATION_PROMPTS: Record<Exclude<ClarificationToolMode, "off">, string> = {
  auto: "【Kimix 需求澄清：自动判断】\n请先判断用户需求是否足够明确。若缺少会影响目标、范围、验收或风险边界的关键信息，且当前环境允许提问，请使用官方结构化提问能力提出 1-3 个简短问题；若当前环境不允许提问，请基于最合理假设继续，并在回复中说明关键假设和风险。若需求已足够明确，直接执行，不要为了澄清而打断用户。",
  on: "【Kimix 需求澄清：开启】\n请在开始执行前做需求澄清检查。若缺少会影响目标、范围、验收或风险边界的关键信息，且当前环境允许提问，请优先使用官方结构化提问能力提出 1-3 个简短问题；若当前环境不允许提问，请基于最合理假设继续，并在回复中说明关键假设和风险。若需求已足够明确，直接执行，不要为了澄清而打断用户。",
};

function withClarificationBehavior(content: string, mode: ClarificationToolMode): string {
  const trimmed = content.trim();
  if (!trimmed || mode === "off") return content;
  return `${CLARIFICATION_PROMPTS[mode]}\n\n用户原始需求：\n${content}`;
}

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
    "【Kimix 官方 /custom-theme 兼容执行】",
    "",
    "当前 Kimix 通过 Kimi Code SDK 发送消息，SDK 不会触发官方 TUI 的 slash dispatcher；因此请你直接完成官方 /custom-theme 本该做的工作。",
    "",
    `用户主题需求：${themeRequest}`,
    "",
    "请直接在本机写入一个 Kimi Code 自定义主题 JSON，不要只给建议，不要询问是否打开预览或本地 URL。",
    "",
    "写入位置必须严格按下面步骤解析，不能猜测用户目录：",
    "- Windows PowerShell 先执行：`$profile = [Environment]::GetFolderPath('UserProfile')`",
    "- 然后目标目录必须是：`Join-Path $profile '.kimi-code\\themes'`",
    "- 目标文件必须是：`Join-Path (Join-Path $profile '.kimi-code\\themes') '<theme-name>.json'`",
    "- 其他系统先用 `$HOME`，目标目录为：`$HOME/.kimi-code/themes`",
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
    "    \"roleUser\": \"#9A4A00\"",
    "  }",
    "}",
    "```",
    "",
    "主题质量要求（必须先按这些规则设计，再写 JSON）：",
    "- 这 18 个 token 不是三色主题映射，必须按语义分别设计，不能只改 primary/accent/text 后复制默认值。",
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

type ImageAttachment = {
  id: string;
  kind?: "image" | "file";
  name: string;
  dataUrl?: string;
  filePath?: string;
};

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
  kind: "agent" | "plugin" | "file" | "slash";
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
  { id: "slash-goal", label: "/goal", detail: "Goal 总入口；直接跟目标会启动", insertText: "/goal ", commandName: "goal", kind: "slash" },
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
  { id: "slash-swarm", label: "/swarm", detail: "官方 Swarm 总入口；可跟任务或 on/off", insertText: "/swarm ", commandName: "swarm", kind: "slash" },
  { id: "slash-swarm-template", label: "/swarm 并行检查最近改动并给出修复建议", detail: "通过官方链路发起 Swarm 任务", insertText: "/swarm 并行检查最近改动并给出修复建议", commandName: "swarm", kind: "slash" },
  { id: "slash-swarm-on", label: "/swarm on", detail: "开启官方 Swarm 模式", insertText: "/swarm on ", commandName: "swarm", kind: "slash" },
  { id: "slash-swarm-off", label: "/swarm off", detail: "关闭官方 Swarm 模式", insertText: "/swarm off ", commandName: "swarm", kind: "slash" },
  { id: "slash-theme", label: "/theme", detail: "打开 Kimix 主题设置；官方 TUI 主题仅供参考", insertText: "/theme", commandName: "theme", kind: "slash" },
  { id: "slash-custom-theme", label: "/custom-theme", detail: "Kimix 兼容生成官方主题 JSON", insertText: "/custom-theme ", commandName: "custom-theme", kind: "slash" },
  { id: "slash-custom-theme-template", label: "/custom-theme 做一套低饱和绿色主题", detail: "Kimix 兼容生成官方主题 JSON", insertText: "/custom-theme 做一套低饱和绿色主题", commandName: "custom-theme", kind: "slash" },
  { id: "slash-import-from-cc-codex", label: "/import-from-cc-codex", detail: "预览并导入 Claude Code / Codex 配置", insertText: "/import-from-cc-codex", commandName: "import-from-cc-codex", kind: "slash" },
  { id: "slash-compact", label: "/compact", detail: "静默压缩当前上下文，可附带保留指令，如：保留本轮测试结果和待办", insertText: "/compact ", commandName: "compact", kind: "slash" },
  { id: "slash-compact-template", label: "/compact 保留本轮测试结果和待办", detail: "带保留指令模板：压缩当前上下文", insertText: "/compact 保留本轮测试结果和待办", commandName: "compact", kind: "slash" },
  { id: "slash-plan", label: "/plan", detail: "切换 Plan 模式", insertText: "/plan ", commandName: "plan", kind: "slash" },
  { id: "slash-plan-on", label: "/plan on", detail: "开启 Plan 模式", insertText: "/plan on ", commandName: "plan", kind: "slash" },
  { id: "slash-plan-off", label: "/plan off", detail: "关闭 Plan 模式", insertText: "/plan off ", commandName: "plan", kind: "slash" },
  { id: "slash-status", label: "/status", detail: "显示当前 Kimi Code 会话状态", insertText: "/status", commandName: "status", kind: "slash" },
  { id: "slash-usage", label: "/usage", detail: "显示当前 Kimi Code 会话用量", insertText: "/usage", commandName: "usage", kind: "slash" },
  { id: "slash-reload", label: "/reload", detail: "重载当前 Kimi Code 会话配置", insertText: "/reload", commandName: "reload", kind: "slash" },
  { id: "slash-btw", label: "/btw", detail: "侧问，不影响主轮次", insertText: "/btw ", commandName: "btw", kind: "slash" },
  { id: "slash-btw-template", label: "/btw 这个函数是谁调用的", detail: "带问题模板：侧问，不影响主轮次", insertText: "/btw 这个函数是谁调用的", commandName: "btw", kind: "slash" },
  { id: "slash-undo", label: "/undo", detail: "撤回最近一次官方历史", insertText: "/undo ", commandName: "undo", kind: "slash" },
  { id: "slash-undo-template", label: "/undo 1", detail: "带次数模板：撤回最近 1 次官方历史", insertText: "/undo 1", commandName: "undo", kind: "slash" },
  { id: "slash-skill", label: "/skill:", detail: "通过官方链路调用 Skill", insertText: "/skill:", commandName: "skill", kind: "slash" },
];

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
  const [previewImage, setPreviewImage] = useState<ImageAttachment | null>(null);
  const [drawingBoardRequest, setDrawingBoardRequest] = useState<DrawingBoardRequest | null>(null);
  const [slashCommands, setSlashCommands] = useState<CompletionItem[]>([]);
  const [themeImportPreview, setThemeImportPreview] = useState<ThemeImportPreview | null>(null);
  const [themeImportApplyingId, setThemeImportApplyingId] = useState<string | null>(null);
  const [fileItems, setFileItems] = useState<CompletionItem[]>([]);
  const [activeCompletionIndex, setActiveCompletionIndex] = useState(0);
  const inputRef = useRef<ComposerInputHandle>(null);
  const completionListRef = useRef<HTMLDivElement>(null);
  const completionItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

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
  const setDefaultPlanMode = useAppStore((s) => s.setDefaultPlanMode);
  const setThemePalette = useAppStore((s) => s.setThemePalette);
  const upsertKimiThemePalette = useAppStore((s) => s.upsertKimiThemePalette);
  const setWorkspaceView = useAppStore((s) => s.setWorkspaceView);
  const hiddenComposerCards = useAppStore((s) => s.hiddenComposerCards);
  const setComposerCardHidden = useAppStore((s) => s.setComposerCardHidden);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const focusInputTrigger = useAppStore((s) => s.focusInputTrigger);
  const voiceShortcut = useAppStore((s) => s.voiceShortcut);
  const clarificationToolMode = useAppStore((s) => s.clarificationToolMode);
  const setClarificationToolMode = useAppStore((s) => s.setClarificationToolMode);
  const clarificationLockedByYolo = permissionMode === "yolo";
  const effectiveClarificationToolMode = clarificationLockedByYolo ? "off" : clarificationToolMode;

  const updateSession = useSessionStore((s) => s.updateSession);
  const addSession = useSessionStore((s) => s.addSession);
  const addPendingMessage = useSessionStore((s) => s.addPendingMessage);
  const allPendingMessages = useSessionStore((s) => s.pendingMessages);
  const removePendingMessage = useSessionStore((s) => s.removePendingMessage);
  const reorderPendingMessage = useSessionStore((s) => s.reorderPendingMessage);
  const liveSession = useLiveSession(currentSession?.id);

  const [showPermissionMenu, setShowPermissionMenu] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [editingPendingId, setEditingPendingId] = useState<string | null>(null);
  const [draggingPendingId, setDraggingPendingId] = useState<string | null>(null);

  const permissionBtnRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLDivElement>(null);
  const activeSession = liveSession ?? currentSession;
  const pendingMessages = currentSession
    ? allPendingMessages.filter((msg) => msg.sessionId === currentSession.id)
    : [];
  const activeRuntimeSessionId = activeSession ? getRuntimeSessionId(activeSession) : undefined;
  const isCurrentSessionRunning = isSessionRuntimeRunning(activeSession, runningSessionId);
  const isCurrentSessionHandoff = Boolean(activeSession && handoffSessionId === activeSession.id);
  const hasActiveAssistantTurn = isCurrentSessionRunning;
  const canSteerActiveTurn = Boolean(
    activeRuntimeSessionId &&
    isCurrentSessionRunning
  );
  const shouldShowStopButton = isCurrentSessionRunning;
  const canUseComposer = Boolean(currentSession || currentProject) && !isCurrentSessionHandoff;
  const canTogglePlanMode = canUseComposer && !hasActiveAssistantTurn;

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (permissionBtnRef.current && !permissionBtnRef.current.contains(e.target as Node)) {
        setShowPermissionMenu(false);
      }
      if (addBtnRef.current && !addBtnRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (focusInputTrigger > 0) inputRef.current?.focus();
  }, [focusInputTrigger]);

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
    if (!currentSession) {
      setSlashCommands([]);
      return;
    }
    if (currentSession.engine === "kimi-code") {
      setSlashCommands(sdkSlashCommandItems);
      return;
    }
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
      setSlashCommands(res.data.map((command) => ({
        id: `slash-${command.name}`,
        label: `/${command.name}`,
        detail: command.description,
        insertText: `/${command.name} `,
        commandName: command.name,
        kind: "slash",
      })));
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
  const slashCompletionSource = slashCommands.length > 0 ? slashCommands : sdkSlashCommandItems;
  const filteredSlashItems = activeCompletion?.mode === "slash"
    ? slashCompletionSource.filter((item) => {
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
  const filteredMentionBaseItems = activeCompletion?.mode === "mention"
    ? mentionBaseItems.filter((item) => {
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
        query,
        limit: 12,
      }).then((res) => {
        if (cancelled || !res.success) return;
        setFileItems(res.data.map((file) => ({
          id: `file-${file.path}`,
          label: file.name,
          detail: file.path,
          insertText: `@${file.path} `,
          kind: "file",
        })));
      });
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeCompletion?.mode, activeCompletion?.query, currentProject?.path]);

  const addImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const attachments = await Promise.all(
      imageFiles.map((file) => new Promise<ImageAttachment>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
          id: genId(),
          kind: "image",
          name: file.name || "粘贴图片",
          dataUrl: String(reader.result),
        });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      })),
    );
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

  const ensureSession = async () => {
    if (currentSession) {
      return useSessionStore.getState().sessions.find((session) => session.id === currentSession.id) ?? currentSession;
    }
    if (!currentProject) return null;
    const model = await getDefaultKimiModel();
    // Kimi Code 主链路：仅创建本地会话对象，真实官方 session 延迟到首条消息发送时再创建。
    const session = {
      id: genId(),
      engine: "kimi-code" as const,
      model,
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

  const sendPromptContent = async (content: string, options?: { addUserEvent?: boolean; images?: ImageAttachment[]; outboundContent?: string; skipClarification?: boolean; postUserStatusMessage?: string }) => {
    const ensuredSession = await ensureSession();
    if (!ensuredSession) return false;
    let targetSession = ensuredSession;
    const images = options?.images ?? [];

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
    targetSession = syncCurrentSessionFromStore(targetSession.id) ?? targetSession;

    const effectiveEngine = "kimi-code";
    const contentWithAttachments = buildAttachmentPromptContent(content, images);
    const outboundContent = options?.outboundContent ?? (targetSession.longTask || options?.skipClarification
      ? contentWithAttachments
      : withClarificationBehavior(contentWithAttachments, effectiveClarificationToolMode));
    setRunningSessionId(targetSession.id);
    if (effectiveEngine === "kimi-code") {
      const imagesForApi = toPromptImages(images);
      const sameWorkDir = (a?: string, b?: string) =>
        Boolean(a && b) && a!.replace(/\\/g, "/").toLowerCase() === b!.replace(/\\/g, "/").toLowerCase();
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
        const knownRuntimeSessionId = targetSession.runtimeSessionId;
        if (knownRuntimeSessionId) {
          // Fast path: a Kimix-created runtime id is already bound to this UI
          // session. Do not re-resume it before every prompt; if it is stale,
          // sendPrompt below will return a session/not-active error and we will
          // rebuild the runtime once. This avoids a full preflight handshake on
          // the hot path.
          updateLinkStatus("消息发送中", "info");
          return knownRuntimeSessionId;
        }

        const knownOfficialSessionId = targetSession.officialSessionId;
        if (knownOfficialSessionId) {
          updateLinkStatus("消息发送中", "info");
          const resumeRes = await window.api.resumeKimiCodeSession({ sessionId: knownOfficialSessionId });
          // Only adopt the resumed runtime when it points at this project's
          // workDir. A stale binding to the plugin-management temp session would
          // otherwise make the assistant run against the wrong directory; drop it
          // and fall through to create a fresh session at projectPath.
          if (resumeRes.success && (!targetSession.projectPath || sameWorkDir(resumeRes.data.workDir, targetSession.projectPath))) {
            const model = resumeRes.data.model ?? targetSession.model ?? await getDefaultKimiModel();
            targetSession = {
              ...targetSession,
              engine: "kimi-code",
              runtimeSessionId: resumeRes.data.sessionId,
              officialSessionId: resumeRes.data.sessionId,
              model,
            };
            updateSession(targetSession.id, (session) => ({
              ...session,
              engine: "kimi-code",
              runtimeSessionId: resumeRes.data.sessionId,
              officialSessionId: resumeRes.data.sessionId,
              model,
              updatedAt: Date.now(),
            }));
            targetSession = syncCurrentSessionFromStore(targetSession.id) ?? targetSession;
            // Re-apply the current UI permission mode so a resumed session honours
            // full-access (yolo) instead of keeping its persisted permission.
            await window.api.setKimiCodePermission({ sessionId: resumeRes.data.sessionId, mode: permissionMode }).catch(() => {});
            updateLinkStatus("消息发送中", "info");
            return resumeRes.data.sessionId;
          }
          updateLinkStatus("消息发送中", "info");
        } else {
          updateLinkStatus("消息发送中", "info");
        }

        const createRes = await window.api.createKimiCodeSession({
          workDir: targetSession.projectPath,
          permission: permissionMode,
          planMode: defaultPlanMode,
        });
        if (!createRes.success) throw new Error(createRes.error);
        const model = createRes.data.model ?? targetSession.model ?? await getDefaultKimiModel();
        targetSession = {
          ...targetSession,
          engine: "kimi-code",
          runtimeSessionId: createRes.data.sessionId,
          officialSessionId: createRes.data.sessionId,
          model,
        };
        updateSession(targetSession.id, (session) => ({
          ...session,
          engine: "kimi-code",
          runtimeSessionId: createRes.data.sessionId,
          officialSessionId: createRes.data.sessionId,
          model,
          updatedAt: Date.now(),
        }));
        targetSession = syncCurrentSessionFromStore(targetSession.id) ?? targetSession;
        updateLinkStatus("消息发送中", "info");
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
          setRunningSessionId(targetSession.id);
          updateSession(targetSession.id, (session) => ({
            ...session,
            events: removeLocalSendAttempt(session.events, userEvent.id, responsePlaceholder.id, shouldAddUserEvent),
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

  const settlePendingClarifications = (sessionId: string, status: "skipped" | "answered" = "skipped") => {
    updateSession(sessionId, (session) => ({
      ...session,
      events: session.events.map((event) => (
        event.type === "question_request" && event.status === "pending"
          ? { ...event, status, answers: event.answers ?? {} }
          : event
      )),
      updatedAt: Date.now(),
    }));
  };

  const appendLocalEvent = async (event: TimelineEvent) => {
    const targetSession = await ensureSession();
    if (!targetSession) return null;
    updateSession(targetSession.id, (session) => ({
      ...session,
      events: [...session.events, event],
      updatedAt: Date.now(),
    }));
    return syncCurrentSessionFromStore(targetSession.id) ?? targetSession;
  };

  const appendStatusMessage = async (message: string) => {
    await appendLocalEvent({
      id: genId(),
      type: "status_update",
      timestamp: Date.now(),
      message,
    });
  };

  const appendSlashNotice = async (command: string) => {
    await appendLocalEvent({
      id: genId(),
      type: "status_update",
      timestamp: Date.now(),
      message: `已接收本地指令：${command}`,
      source: "slash",
      tone: "info",
    });
  };

  const appendAssistantNotice = async (content: string) => {
    await appendLocalEvent({
      id: genId(),
      type: "assistant_message",
      timestamp: Date.now(),
      content,
      isThinking: false,
      isComplete: true,
      durationMs: 0,
    });
  };

  const ensureOfficialRuntimeForSession = async () => {
    const targetSession = await ensureSession();
    if (!targetSession) return null;
    const knownSessionId = targetSession.runtimeSessionId ?? targetSession.officialSessionId;
    if (knownSessionId) {
      const resumeRes = await window.api.resumeKimiCodeSession({ sessionId: knownSessionId });
      if (resumeRes.success) {
        updateSession(targetSession.id, (session) => ({
          ...session,
          engine: "kimi-code",
          runtimeSessionId: resumeRes.data.sessionId,
          officialSessionId: resumeRes.data.sessionId,
          updatedAt: Date.now(),
        }));
        const updated = useSessionStore.getState().sessions.find((session) => session.id === targetSession.id);
        if (updated) setCurrentSession(updated);
        return { uiSessionId: targetSession.id, runtimeSessionId: resumeRes.data.sessionId };
      }
    }
    const createRes = await window.api.createKimiCodeSession({
      workDir: targetSession.projectPath,
      permission: permissionMode,
      planMode: defaultPlanMode,
    });
    if (!createRes.success) throw new Error(createRes.error);
    updateSession(targetSession.id, (session) => ({
      ...session,
      engine: "kimi-code",
      runtimeSessionId: createRes.data.sessionId,
      officialSessionId: createRes.data.sessionId,
      updatedAt: Date.now(),
    }));
    const updated = useSessionStore.getState().sessions.find((session) => session.id === targetSession.id);
    if (updated) setCurrentSession(updated);
    return { uiSessionId: targetSession.id, runtimeSessionId: createRes.data.sessionId };
  };

  const syncOfficialGoal = (uiSessionId: string, goal: unknown, error?: string | null) => {
    updateSession(uiSessionId, (session) => ({
      ...session,
      officialGoal: {
        goal: reconcileOfficialGoalSnapshot(goal && typeof goal === "object" ? goal as NonNullable<Session["officialGoal"]>["goal"] : null, session.officialGoal?.goal),
        error: error ?? null,
        updatedAt: Date.now(),
      },
      updatedAt: Date.now(),
    }));
    const updated = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (updated) setCurrentSession(updated);
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
      syncOfficialGoal(runtime.uiSessionId, null, res.error);
      await appendStatusMessage(`官方 Goal 状态读取失败：${res.error}`);
      return false;
    }
    syncOfficialGoal(runtime.uiSessionId, res.data.goal);
    if (options?.feedback === "assistant") {
      await appendAssistantNotice(formatGoalStatusNotice(res.data.goal));
    } else {
      await appendStatusMessage(res.data.goal ? `官方 Goal：${goalStatusLabel(res.data.goal.status)} · ${res.data.goal.objective}` : "当前没有官方 Goal。");
    }
    return true;
  };

  const handleGoalSlashCommand = async (rawCommand: string, rawArgs: string) => {
    if (imageAttachments.length > 0) {
      await appendStatusMessage("/goal 命令暂不接收图片附件，请先移除图片。");
      return true;
    }
    const args = rawArgs.trim();
    const [subcommandRaw, ...restParts] = args.split(/\s+/);
    const subcommand = (subcommandRaw || "status").toLowerCase();
    const rest = restParts.join(" ").trim();
    const runtime = await ensureOfficialRuntimeForSession();
    if (!runtime) return true;

    const runGoalAction = async (message: string, action: () => Promise<{ success: true; data: { goal: unknown } } | { success: false; error: string }>) => {
      const res = await action();
      if (!res.success) {
        syncOfficialGoal(runtime.uiSessionId, null, res.error);
        await appendStatusMessage(`${message}失败：${res.error}`);
        return true;
      }
      syncOfficialGoal(runtime.uiSessionId, res.data.goal);
      await appendStatusMessage(message);
      return true;
    };

    if (!args || subcommand === "status" || subcommand === "show") {
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
      await appendStatusMessage("请输入 Goal 目标，例如：/goal 完成项目构建并修复失败。");
      return true;
    }
    if (subcommand === "next") {
      const current = await window.api.getKimiCodeGoal({ sessionId: runtime.runtimeSessionId });
      if (current.success && current.data.goal) {
        syncOfficialGoal(runtime.uiSessionId, current.data.goal);
        await appendStatusMessage("Kimi Code 0.12.0 已默认提供 Goal 队列；当前 Kimix 依赖的 SDK 尚未暴露队列管理 API。当前已有 Goal 时，请先完成/取消当前 Goal，或使用 /goal replace 替换。");
        return true;
      }
    }
    const res = await window.api.createKimiCodeGoal({
      sessionId: runtime.runtimeSessionId,
      objective,
      replace,
    });
    if (!res.success) {
      syncOfficialGoal(runtime.uiSessionId, null, res.error);
      await appendStatusMessage(`${replace ? "替换" : "启动"}官方 Goal 失败：${res.error}`);
      return true;
    }
    syncOfficialGoal(runtime.uiSessionId, res.data.goal);
    await sendPromptContent(rawCommand, {
      outboundContent: buildGoalKickoffPrompt(objective),
      skipClarification: true,
    });
    return true;
  };

  const handleSdkSlashCommand = async (content: string) => {
    const match = content.trim().match(slashCommandPattern);
    if (!match) return false;
    const name = match[1].toLowerCase();
    const args = (match[2] ?? "").trim();
    const routing = classifySlashCommand(name);
    if (routing !== "local") return false;
    const commandNotice = args ? `/${name} ${args}` : `/${name}`;
    if (name === "theme") {
      await appendSlashNotice(commandNotice);
      setWorkspaceView("settings");
      await appendStatusMessage("已打开 Kimix 主题设置。官方 /theme 是终端 Kimi Code 的 TUI 主题选择器，Kimix 使用独立的全局主题色板。");
      return true;
    }
    if (name === "custom-theme") {
      await sendPromptContent(content.trim(), {
        outboundContent: buildCustomThemeKickoffPrompt(args),
        skipClarification: true,
        postUserStatusMessage: `已接收本地指令：${commandNotice}`,
      });
      return true;
    }
    if (name === "import-from-cc-codex") {
      await appendSlashNotice(commandNotice);
      const [subcommand, previewId] = args.split(/\s+/);
      if (subcommand === "apply") {
        if (!previewId) {
          await appendStatusMessage("请输入预览 ID，例如：/import-from-cc-codex apply abc12345。");
          return true;
        }
        const res = await window.api.applyImportFromCcCodex({ previewId });
        if (!res.success) {
          await appendStatusMessage(`导入失败：${res.error}`);
          return true;
        }
        const imported = res.data.imported.length;
        const skipped = res.data.skipped.length;
        const backups = res.data.backups.length;
        await appendStatusMessage(`导入完成：已写入 ${imported} 项，跳过 ${skipped} 项，创建备份 ${backups} 个。请在设置/插件面板刷新确认，必要时重启 Kimi Code 会话。`);
        return true;
      }
      if (args) {
        await appendStatusMessage("当前仅支持 /import-from-cc-codex 生成安全预览，或 /import-from-cc-codex apply <预览ID> 应用预览。");
        return true;
      }
      const res = await window.api.previewImportFromCcCodex({ workDir: currentProject?.path });
      if (!res.success) {
        await appendStatusMessage(`生成导入预览失败：${res.error}`);
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
      await appendStatusMessage(previewLines.join("\n"));
      return true;
    }
    return false;
  };

  const handleFallbackSlashCommand = async (content: string, images: ImageAttachment[] = []) => {
    const match = content.trim().match(slashCommandPattern);
    if (!match) return false;
    const name = match[1].toLowerCase();
    const args = (match[2] ?? "").trim();
    if (classifySlashCommand(name) !== "official-first") return false;
    const commandNotice = args ? `/${name} ${args}` : `/${name}`;
    if (name.startsWith("skill:")) {
      const skillName = name.slice("skill:".length);
      const applied = await applySkillCommand(skillName, args || undefined);
      if (applied === "enabled" && (args || images.length > 0)) {
        await sendPromptContent(args, { images, skipClarification: true });
      }
      return Boolean(applied);
    }
    if (name === "goal") {
      await appendSlashNotice(commandNotice);
      return handleGoalSlashCommand(content.trim(), args);
    }
    if (name === "swarm") {
      const normalized = args.toLowerCase();
      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      if (!args) {
        await appendSlashNotice(commandNotice);
        await appendStatusMessage("请输入 Swarm 任务，例如：/swarm 并行检查最近改动并给出修复建议；也可使用 /swarm on 或 /swarm off 切换模式。");
        return true;
      }
      if (normalized === "on" || normalized === "off") {
        await appendSlashNotice(commandNotice);
        const enabled = normalized === "on";
        const res = await window.api.swarmKimiCode({ sessionId: runtime.runtimeSessionId, enabled, trigger: "manual" });
        await appendStatusMessage(res.success ? (enabled ? "Swarm 模式已开启。" : "Swarm 模式已关闭。") : `Swarm 模式切换失败：${res.error}`);
        return true;
      }

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
      updateSession(runtime.uiSessionId, (session) => ({
        ...session,
        events: [...session.events, userEvent, statusEvent],
        updatedAt: Date.now(),
      }));
      setRunningSessionId(runtime.uiSessionId);
      const modeRes = await window.api.swarmKimiCode({ sessionId: runtime.runtimeSessionId, enabled: true, trigger: "task" });
      const res = modeRes.success ? await window.api.swarmKimiCode({ sessionId: runtime.runtimeSessionId, content: args }) : modeRes;
      if (!res.success) {
        setRunningSessionId(null);
        updateSession(runtime.uiSessionId, (session) => ({
          ...session,
          events: [
            ...session.events,
            {
              id: genId(),
              type: "error",
              timestamp: Date.now(),
              message: `Swarm 启动失败：${res.error}`,
              source: "ipc",
            },
          ],
          updatedAt: Date.now(),
        }));
      }
      return true;
    }
    if (name === "compact") {
      await appendSlashNotice(commandNotice);
      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      const res = await window.api.compactKimiCodeSession({ sessionId: runtime.runtimeSessionId, instruction: args || undefined });
      if (!res.success) await appendStatusMessage(`压缩失败：${res.error}`);
      return true;
    }
    if (name === "plan") {
      await appendSlashNotice(commandNotice);
      const normalized = args.toLowerCase();
      const next = normalized === "on" || normalized === "true" || normalized === "1"
        ? true
        : normalized === "off" || normalized === "false" || normalized === "0"
          ? false
          : !defaultPlanMode;
      setDefaultPlanMode(next);
      const runtime = activeSession?.runtimeSessionId ?? activeSession?.officialSessionId ?? null;
      if (runtime) {
        const res = await window.api.setKimiCodePlanMode({ sessionId: runtime, enabled: next });
        if (!res.success) await appendStatusMessage(`Plan 模式切换失败：${res.error}`);
        else await appendStatusMessage(next ? "Plan 模式已开启。" : "Plan 模式已关闭。");
      } else {
        await appendStatusMessage(next ? "Plan 模式已开启，新会话发送时生效。" : "Plan 模式已关闭。");
      }
      return true;
    }
    if (name === "reload") {
      await appendSlashNotice(commandNotice);
      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      const res = await window.api.reloadKimiCodeSession({ sessionId: runtime.runtimeSessionId });
      await appendStatusMessage(res.success ? "已重载当前 Kimi Code 会话配置。" : `重载失败：${res.error}`);
      return true;
    }
    if (name === "status") {
      await appendSlashNotice(commandNotice);
      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      const res = await window.api.getKimiCodeStatus({ sessionId: runtime.runtimeSessionId });
      await appendAssistantNotice(res.success ? formatKimiCodeStatus(res.data as Record<string, unknown>) : `读取 Kimi Code 状态失败：${res.error}`);
      return true;
    }
    if (name === "usage") {
      await appendSlashNotice(commandNotice);
      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      const res = await window.api.getKimiCodeUsage({ sessionId: runtime.runtimeSessionId });
      await appendAssistantNotice(res.success ? formatKimiCodeUsage(res.data) : `读取 Kimi Code 会话用量失败：${res.error}`);
      return true;
    }
    if (name === "btw") {
      await appendSlashNotice(commandNotice);
      if (!args) {
        await appendStatusMessage("请输入侧问内容，例如：/btw 这个函数是谁调用的？");
        return true;
      }
      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      const roundId = `btw-round-${Date.now()}`;
      updateSession(runtime.uiSessionId, (session) => ({
        ...session,
        btwRounds: [...(session.btwRounds ?? []), { id: roundId, userContent: args, timestamp: Date.now() }],
        updatedAt: Date.now(),
      }));
      const res = await window.api.askKimiCodeBtw({ sessionId: runtime.runtimeSessionId, content: args });
      updateSession(runtime.uiSessionId, (session) => ({
        ...session,
        btwRounds: (session.btwRounds ?? []).map((round) => round.id === roundId
          ? { ...round, assistantContent: res.success ? res.data.content || "没有返回正文。" : `侧问失败：${res.error}`, thinking: res.success ? res.data.thinking || undefined : undefined }
          : round),
        updatedAt: Date.now(),
      }));
      await appendStatusMessage(res.success ? "BTW 侧问已完成，结果在右侧会话栏。" : `BTW 侧问失败：${res.error}`);
      return true;
    }
    if (name === "undo") {
      await appendSlashNotice(commandNotice);
      const runtime = await ensureOfficialRuntimeForSession();
      if (!runtime) return true;
      const rawCount = Number(args || "1");
      const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(Math.floor(rawCount), 10)) : 1;
      const res = await window.api.undoKimiCodeHistory({ sessionId: runtime.runtimeSessionId, count });
      await appendStatusMessage(res.success ? `已撤回最近 ${count} 次官方历史。` : `撤回失败：${res.error}`);
      return true;
    }
    return false;
  };

  const applySkillCommand = async (skillName: string, args?: string) => {
    const runtime = await ensureOfficialRuntimeForSession();
    if (!runtime) return false;
    const officialSkillRes = await window.api.listKimiCodeSkills({ sessionId: runtime.runtimeSessionId });
    if (officialSkillRes.success) {
      const normalizedName = skillName.trim().toLowerCase();
      const officialSkill = officialSkillRes.data.find((item) => item.name.toLowerCase() === normalizedName);
      if (officialSkill) {
        const activateRes = await window.api.activateKimiCodeSkill({
          sessionId: runtime.runtimeSessionId,
          name: officialSkill.name,
          args: args || undefined,
        });
        await appendLocalEvent({
          id: genId(),
          type: activateRes.success ? "status_update" : "error",
          timestamp: Date.now(),
          message: activateRes.success ? `已激活官方 Skill：${officialSkill.name}` : `激活 Skill 失败：${activateRes.error}`,
          source: "ui",
        });
        return activateRes.success ? "activated" as const : false;
      }
    }

    const skillRes = await window.api.listSkills();
    if (!skillRes.success) {
      await appendLocalEvent({
        id: genId(),
        type: "error",
        timestamp: Date.now(),
        message: `启用 Skill 失败：${skillRes.error}`,
        source: "ui",
      });
      return false;
    }

    const normalizedName = skillName.trim().toLowerCase();
    const skill = skillRes.data.skills.find((item) => (
      item.name.toLowerCase() === normalizedName ||
      item.path.toLowerCase().includes(`\\${normalizedName}\\skill.md`) ||
      item.path.toLowerCase().includes(`/${normalizedName}/skill.md`)
    ));
    if (!skill) {
      await appendLocalEvent({
        id: genId(),
        type: "error",
        timestamp: Date.now(),
        message: `未找到 Skill：${skillName}。请在左侧“技能”面板确认名称后再发送。`,
        source: "ui",
      });
      return false;
    }

    const nextNames = Array.from(new Set([...skillRes.data.enabledNames, skill.name]));
    const saveRes = await window.api.saveEnabledSkills({ names: nextNames });
    if (!saveRes.success) {
      await appendLocalEvent({
        id: genId(),
        type: "error",
        timestamp: Date.now(),
        message: `启用 Skill 失败：${saveRes.error}`,
        source: "ui",
      });
      return false;
    }

    const targetSession = await ensureSession();
    if (!targetSession) return false;
    setSlashCommands([]);
    updateSession(targetSession.id, (session) => ({
      ...session,
      events: [
        ...session.events,
        {
          id: genId(),
          type: "status_update",
          timestamp: Date.now(),
          message: `已启用 Skill：${skill.name}`,
        },
      ],
      updatedAt: Date.now(),
    }));
    return "enabled" as const;
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    const imagesToSend = imageAttachments;
    if ((!trimmed && imagesToSend.length === 0) || !canUseComposer) return;
    if (hasActiveAssistantTurn && currentSession) {
      setInput("");
      setImageAttachments([]);
      setEditingPendingId(null);
      inputRef.current?.reset();
      addPendingMessage(currentSession.id, trimmed, toUserAttachments(imagesToSend));
      return;
    }
    const slashHandled = trimmed.startsWith("/") ? await handleSdkSlashCommand(trimmed) : false;
    if (slashHandled) {
      setInput("");
      setImageAttachments([]);
      setEditingPendingId(null);
      inputRef.current?.reset();
      return;
    }
    setInput("");
    setImageAttachments([]);
    setEditingPendingId(null);
    inputRef.current?.reset();

    if (!hasActiveAssistantTurn && activeSession) {
      settlePendingClarifications(activeSession.id);
    }

    const sent = await sendPromptContent(trimmed, { images: imagesToSend, skipClarification: trimmed.startsWith("/") });
    if (!sent && trimmed.startsWith("/")) {
      await handleFallbackSlashCommand(trimmed, imagesToSend);
    }
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
  const updateSteerStatus = (sessionId: string, steerId: string, status: "accepted" | "sent" | "failed", error?: string) => {
    updateSession(sessionId, (session) => ({
      ...session,
      events: session.events.map((event) => event.id === steerId && event.type === "steer_message"
        ? event.status === "sent" && status === "accepted"
          ? event
          : { ...event, status, error: status === "failed" ? error : undefined }
        : event
      ),
      updatedAt: Date.now(),
    }));
    const updated = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
    if (updated) setCurrentSession(updated);
  };

  const insertLocalSteerMessage = (sessionId: string, content: string, images: ImageAttachment[] = []): string => {
    const steerId = genId();
    updateSession(sessionId, (session) => ({
      ...session,
      events: [
        ...session.events,
        {
          id: steerId,
          type: "steer_message" as const,
          timestamp: Date.now(),
          content,
          images: toUserAttachments(images),
          status: "sending" as const,
        },
      ],
      updatedAt: Date.now(),
    }));
    const updated = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
    if (updated) setCurrentSession(updated);
    return steerId;
  };

  const handleSteer = async () => {
    const trimmed = input.trim();
    const imagesToSend = imageAttachments;
    if ((!trimmed && imagesToSend.length === 0) || !canUseComposer) return;
    const runtimeSessionId = getRuntimeSessionId(activeSession);
    if (!activeSession || !canSteerActiveTurn || !runtimeSessionId) {
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: "当前没有可引导的 SDK 运行轮次，消息会留在队列里等待本轮结束。" }));
      return;
    }
    const steerId = insertLocalSteerMessage(activeSession.id, trimmed || (imagesToSend.length > 0 ? "[附件]" : ""), imagesToSend);
    setInput("");
    setImageAttachments([]);
    setEditingPendingId(null);
    inputRef.current?.reset();
    const res = await window.api.steerKimiCode({
      sessionId: runtimeSessionId,
      content: buildAttachmentPromptContent(trimmed, imagesToSend),
      images: toPromptImages(imagesToSend),
    });
    if (!res.success) {
      updateSteerStatus(activeSession.id, steerId, "failed", res.error);
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `引导失败：${res.error}` }));
      return;
    }
    updateSteerStatus(activeSession.id, steerId, "accepted");
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: "已发送引导请求",
    }));
  };

  const handleStop = async () => {
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
    const res = await window.api.triggerShortcut({ shortcut });
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: res.success ? `已触发语音快捷键：${shortcut}` : `语音快捷键失败：${res.error}`,
    }));
  };

  const handleSetClarificationToolMode = (mode: ClarificationToolMode) => {
    if (clarificationLockedByYolo) {
      if (clarificationToolMode !== "off") setClarificationToolMode("off");
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: "官方 yolo 模式不支持开启需求澄清工具",
      }));
      return;
    }
    setClarificationToolMode(mode);
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: `需求澄清工具：${CLARIFICATION_OPTIONS.find((option) => option.value === mode)?.label ?? mode}`,
    }));
  };

  const handleSetPermissionMode = async (mode: PermissionMode) => {
    const previousMode = permissionMode;
    setPermissionMode(mode);
    if (mode === "yolo" && clarificationToolMode !== "off") {
      setClarificationToolMode("off");
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: "已关闭需求澄清工具：官方 yolo 模式不支持开启",
      }));
    }
    setShowPermissionMenu(false);
    // Only push to the SDK when a real runtime session exists. Using the UI-id
    // fallback here would hit "session not active" before the first message is
    // sent and wrongly roll the UI mode back. New sessions carry permissionMode
    // into createKimiCodeSession at send time, so the local update is enough.
    const runtimeSessionId = activeSession?.runtimeSessionId ?? activeSession?.officialSessionId;
    if (!runtimeSessionId || previousMode === mode) return;
    const res = await window.api.setKimiCodePermission({ sessionId: runtimeSessionId, mode });
    if (!res.success) {
      setPermissionMode(previousMode);
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `权限切换失败：${res.error}`,
      }));
      return;
    }
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: "权限模式已切换",
    }));
  };

  const handleTogglePlanMode = async () => {
    if (!canTogglePlanMode) return;
    const next = !defaultPlanMode;
    setDefaultPlanMode(next);
    const runtimeSessionId = activeSession?.runtimeSessionId ?? activeSession?.officialSessionId ?? null;
    if (!runtimeSessionId) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: next ? "Plan 模式已开启，新会话发送时生效" : "Plan 模式已关闭",
      }));
      return;
    }
    const res = await window.api.setKimiCodePlanMode({ sessionId: runtimeSessionId, enabled: next });
    if (!res.success) {
      setDefaultPlanMode(!next);
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `Plan 模式切换失败：${res.error}`,
      }));
      return;
    }
    setDefaultPlanMode(next);
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: next ? "Plan 模式已开启" : "Plan 模式已关闭",
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
      images: pendingAttachments,
    });
  };

  const handleSteerPending = async (id: string) => {
    const pending = pendingMessages.find((msg) => msg.id === id);
    if (!pending || !canUseComposer) return;
    const runtimeSessionId = activeSession ? getRuntimeSessionId(activeSession) : null;
    if (!runtimeSessionId || !activeSession || !canSteerActiveTurn) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: "当前没有可引导的 SDK 运行轮次，这条消息会继续排队等待本轮结束。",
      }));
      return;
    }
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
        updateSession(activeSession.id, (session) => ({ ...session, runtimeSessionId: undefined }));
      }
      updateSteerStatus(activeSession.id, steerId, "failed", res.error);
      addPendingMessage(activeSession.id, pending.content, pending.images);
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `引导失败：${res.error}` }));
      return;
    }
    updateSteerStatus(activeSession.id, steerId, "accepted");
    window.dispatchEvent(new CustomEvent("kimix:toast", { detail: "已发送引导请求" }));
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
    setEditingPendingId(id);
    removePendingMessage(id);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleCancelPendingEdit = () => {
    setInput("");
    setEditingPendingId(null);
    inputRef.current?.reset();
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
  }[permissionMode];

  const placeholder = canUseComposer
    ? "向 Agent 询问任何事。输入 @ 使用插件或提及文件"
    : isCurrentSessionHandoff
      ? "正在生成交接内容..."
      : "请先选择项目";
  const composerCardSessionId = activeSession?.id ?? "__global__";
  const hiddenCards = hiddenComposerCards[composerCardSessionId] ?? [];
  const visibleTodos = activeSession ? getVisibleTodos(activeSession.events) : [];
  const visibleSwarmAgents = activeSession ? getVisibleSwarmAgents(activeSession.events) : [];
  const todoHidden = hiddenCards.includes("todo");
  const swarmHidden = hiddenCards.includes("swarm");
  const pendingHidden = hiddenCards.includes("pending");
  const goalHidden = hiddenCards.includes("goal");
  const currentGoal = activeSession?.officialGoal?.goal ?? null;
  const goalStatus = currentGoal?.status ?? "";
  const showGoalModeCard = Boolean(currentGoal && !goalHidden && !["complete", "cancelled", "canceled"].includes(goalStatus));
  const goalToneClass = goalStatus === "blocked"
    ? "text-accent-danger"
    : goalStatus === "paused"
      ? "text-accent-warning"
      : "text-accent-primary";
  const canSendNow = canUseComposer && (input.trim().length > 0 || imageAttachments.length > 0);
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

      {activeSession && visibleSwarmAgents.length > 0 && !swarmHidden && (
        <SwarmPanel
          events={activeSession.events}
          onDismiss={() => hideComposerCard("swarm", "Swarm 子进程")}
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
            {pendingMessages.map((msg) => (
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
                  <button className="kimix-muted-action flex h-7 w-7 items-center justify-center rounded-lg transition-colors" title="更多" aria-label="更多">
                    <MoreHorizontal size={14} />
                  </button>
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
        style={{ paddingLeft: 17, paddingRight: 17, paddingTop: 14, paddingBottom: 10 }}
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
                <div className="px-2 pb-1.5 text-[13px] text-[var(--kimix-panel-text-muted)]">命令</div>
                {completionItems.length > 0 ? completionItems.map((item, index) => (
                  <button
                    ref={(node) => { completionItemRefs.current[item.id] = node; }}
                    key={item.id}
                    type="button"
                    onClick={() => applyCompletion(item)}
                    className={`flex h-9 w-full items-center gap-2.5 rounded-xl text-left transition-colors ${activeCompletionIndex === index ? "bg-[var(--kimix-panel-hover)] text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                    style={{ paddingLeft: 10, paddingRight: 12 }}
                  >
                    <TerminalSquare size={15} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />
                    <span className="shrink-0">{item.label}</span>
                    {item.detail && <span className="min-w-0 truncate text-[var(--kimix-panel-text-muted)]">{item.detail}</span>}
                  </button>
                )) : (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-[var(--kimix-panel-text-muted)]">
                    <AtSign size={14} />
                    <span>正在从 Agent 加载命令，或当前会话未返回 slash_commands</span>
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
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => isImage && setPreviewImage(attachment as ImageAttachment & { dataUrl: string })}
                  className={`kimix-media-thumb group relative overflow-hidden rounded-xl text-left shadow-[0_1px_2px_rgba(25,23,20,0.05)] transition-colors ${isImage ? "h-20 w-20" : "h-20 w-[176px]"}`}
                  title={isImage ? "点击查看图片" : attachment.filePath || attachment.name}
                  aria-label={`${isImage ? "查看图片" : "附件文件"} ${attachment.name}`}
                >
                  {isImage ? (
                    <img src={attachment.dataUrl} alt={attachment.name} className="h-full w-full object-cover" />
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
                    className="absolute rounded-full bg-accent-danger/85 text-white opacity-95 transition-colors hover:bg-accent-danger"
                    style={{
                      top: 6,
                      right: 6,
                      width: 25,
                      height: 25,
                      display: "grid",
                      placeItems: "center",
                      padding: 0,
                      lineHeight: 0,
                    }}
                    title={isImage ? "移除图片" : "移除附件"}
                    aria-label={isImage ? "移除图片" : "移除附件"}
                  >
                    <X size={13} style={{ display: "block" }} />
                  </button>
                </button>
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

        <div className="mt-2 flex h-9 min-w-0 flex-nowrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1" style={{ marginLeft: -6 }}>
            {editingPendingId && (
              <button onClick={handleCancelPendingEdit} className="kimix-muted-action shrink-0 rounded-xl px-2.5 py-1 text-[13px]">
                取消修改
              </button>
            )}
            <div ref={addBtnRef} className="relative">
              <button disabled={!canUseComposer} onClick={() => setShowAddMenu((value) => !value)} className={iconButtonClass} title="更多工具" aria-label="更多工具">
                <Plus size={18} />
              </button>
              {showAddMenu && (
                <div className="kimix-floating-panel absolute bottom-full left-0 z-30 mb-2 w-[260px] rounded-xl" style={{ padding: "14px 14px 14px" }}>
                  <div className="flex flex-col" style={{ gap: 14 }}>
                    <section>
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
                      <div className="flex items-center justify-between" style={{ gap: 10 }}>
                        <div className="flex min-w-0 items-center gap-2 text-[13.5px] font-medium text-[var(--kimix-panel-text)]">
                          <CircleHelp size={15} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />
                          <span>需求澄清</span>
                        </div>
                        <div
                          className="flex w-[132px] shrink-0 rounded-xl bg-[var(--kimix-panel-soft-bg)]"
                          style={{ gap: 4, padding: 4, opacity: clarificationLockedByYolo ? 0.72 : 1 }}
                          title={clarificationLockedByYolo ? "官方 yolo 模式不支持开启需求澄清工具" : undefined}
                        >
                          {CLARIFICATION_OPTIONS.map((option) => {
                            const active = effectiveClarificationToolMode === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                title={clarificationLockedByYolo ? "官方 yolo 模式不支持开启需求澄清工具" : option.desc}
                                onClick={() => handleSetClarificationToolMode(option.value)}
                                className={`h-8 flex-1 rounded-lg text-[13px] transition-colors ${active ? "bg-surface-elevated text-accent-primary shadow-[0_1px_2px_rgba(25,23,20,0.08)]" : "text-[var(--kimix-panel-text-secondary)] hover:bg-surface-elevated/70"}`}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </section>

                  </div>
                </div>
              )}
            </div>

            <div ref={permissionBtnRef} className="relative min-w-0 shrink">
              <button disabled={!canUseComposer} onClick={() => setShowPermissionMenu((v) => !v)} className="kimix-icon-text-button kimix-muted-action is-compact max-w-[188px] min-w-0 disabled:cursor-not-allowed disabled:opacity-35">
                <AlertTriangle size={14} className="shrink-0 text-accent-warning" />
                <span className="truncate">{permissionLabel}</span>
                <ChevronDown size={12} className="shrink-0" />
              </button>
              {showPermissionMenu && (
                <div className="kimix-floating-panel absolute bottom-full left-0 z-30 mb-2 w-[216px] rounded-xl" style={{ paddingTop: 12, paddingBottom: 12 }}>
                  {PERMISSION_OPTIONS.map((opt) => {
                    const Icon = permissionMenuIcons[opt.value];
                    return (
                      <button key={opt.value} title={opt.tooltip} onClick={() => void handleSetPermissionMode(opt.value)} style={{ paddingLeft: 18, paddingRight: 18, paddingTop: 13, paddingBottom: 13, minHeight: 40 }} className={`flex w-full items-center gap-3.5 text-left text-[13px] leading-none hover:bg-[var(--kimix-panel-hover)] ${permissionMode === opt.value ? "text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)]"}`}>
                        <Icon size={13} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />
                        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                        {permissionMode === opt.value && <Check size={13} className="mr-1 shrink-0 text-[var(--kimix-panel-text)]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              disabled={!canTogglePlanMode}
              onClick={() => void handleTogglePlanMode()}
              className="kimix-icon-text-button kimix-muted-action is-compact min-w-[92px] border disabled:cursor-not-allowed disabled:opacity-35"
              style={{
                borderColor: defaultPlanMode ? "var(--accent-primary-soft)" : "transparent",
                backgroundColor: defaultPlanMode ? "var(--accent-primary-light)" : "transparent",
                color: defaultPlanMode ? "var(--accent-primary-dark)" : undefined,
                boxShadow: defaultPlanMode ? "inset 0 0 0 1px rgba(25, 130, 255, 0.16)" : undefined,
              }}
              title={defaultPlanMode ? "关闭 Plan 模式。Plan 模式会先生成计划，等待确认后再执行。" : "开启 Plan 模式。Plan 模式会先生成计划，等待确认后再执行。"}
              aria-pressed={defaultPlanMode}
            >
              <ClipboardList size={14} className="shrink-0" />
              <span>{defaultPlanMode ? "Plan 开" : "Plan 关"}</span>
            </button>
            <button
              disabled={!canUseComposer}
              onClick={() => {
                if (!canUseComposer) return;
                const next = !defaultThinking;
                setDefaultThinking(next);
                window.dispatchEvent(new CustomEvent("kimix:toast", {
                  detail: next ? "思考开" : "思考关",
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
              <span>{defaultThinking ? "思考开" : "思考关"}</span>
            </button>

            <ContextRing />
            <button disabled={!canUseComposer} onClick={() => void handleVoiceShortcut()} className={iconButtonClass} title={`语音快捷键：${voiceShortcut || "Win+H"}`} aria-label="语音">
              <Mic size={16} />
            </button>

            {shouldShowStopButton ? (
              <>
                {canSteerActiveTurn && canSendNow && (
                  <button
                    onClick={() => void handleSteer()}
                    className="flex h-8 shrink-0 items-center rounded-full bg-accent-primary text-white transition-colors hover:bg-accent-primary-dark"
                    style={{ gap: 6, paddingLeft: 12, paddingRight: 14 }}
                    title="立即引导当前任务：把输入插入运行中的对话（官方 Ctrl+S steer），不进排队"
                    aria-label="引导当前任务"
                  >
                    <Zap size={14} strokeWidth={2.5} className="shrink-0" />
                    <span className="text-[13px]">引导</span>
                  </button>
                )}
                <button onClick={handleStop} className="kimix-strong-action flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors" title="停止" aria-label="停止">
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
                </button>
              </>
            ) : (
              <button onClick={handleSend} disabled={!canSendNow} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${canSendNow ? "bg-accent-primary text-white hover:bg-accent-primary-dark" : "bg-surface-hover text-text-muted"}`} title={editingPendingId ? "保存修改" : "发送"} aria-label={editingPendingId ? "保存修改" : "发送"}>
                <ArrowUp size={17} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>

      {previewImage && (
        <ImagePreviewOverlay
          image={previewImage}
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
    </div>
  );
}
