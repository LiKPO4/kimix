export type Theme = "dark" | "light" | "system";
export type ThemePaletteId = "warm-paper" | "neutral-gray" | "soft-green" | "warm-orange" | "custom" | `kimi:${string}`;
export interface ThemePaletteColors {
  primary: string;
  surface: string;
  accent: string;
}

export interface KimiThemePalette {
  primary: string;
  accent: string;
  text: string;
  textStrong: string;
  textDim: string;
  textMuted: string;
  border: string;
  borderFocus: string;
  success: string;
  warning: string;
  error: string;
  diffAdded: string;
  diffRemoved: string;
  diffAddedStrong: string;
  diffRemovedStrong: string;
  diffGutter: string;
  diffMeta: string;
  roleUser: string;
}

export interface KimiThemePreset {
  id: string;
  name: string;
  displayName: string;
  path?: string;
  base?: "light" | "dark";
  palette: KimiThemePalette;
  colors?: ThemePaletteColors;
  createdAt?: number;
  updatedAt?: number;
}

export type PermissionMode = "manual" | "auto" | "yolo";
export type ClarificationToolMode = "off" | "on" | "auto";
export type NotificationMode = "never" | "unfocused" | "always";
export type ComposerDockCard = "todo" | "pending" | "goal" | "swarm";
export type RightSidebarCardId = "longTaskStatus" | "background" | "bigPlan" | "rounds" | "review" | "confirmed" | "hidden" | "longTask" | "kimi" | "git" | "goal" | "btw" | "plan" | "serverTree" | "session" | "diffs";
export type WorkspaceView = "chat" | "plugins" | "hooks" | "mcp" | "settings";

export interface AppState {
  currentProject: Project | null;
  currentSession: Session | null;
  permissionMode: PermissionMode;
  isRunning: boolean;
  runningSessionId: string | null;
  creatingSessionProjectPath: string | null;
  defaultThinking: boolean;
  defaultPlanMode: boolean;
  additionalWorkDirs: string[];
  detailedContext: boolean;
  statusUpdateDisplay: StatusUpdateDisplay;
  sessionRecommendationEnabled: boolean;
  sessionRecommendationTurnLimit: number;
  voiceShortcut: string;
  notificationMode: NotificationMode;
  clarificationToolMode: ClarificationToolMode;
  processDisplayMode: ProcessDisplayMode;
  filePreviewExtensions: string[];
  longTasksOpen: boolean;
  longTaskInspectorOpen: boolean;
  diffPanelOpen: boolean;
  hiddenComposerCards: Record<string, ComposerDockCard[]>;
  rightSidebarCardOrder: RightSidebarCardId[];
  handoffSessionId: string | null;
  workspaceView: WorkspaceView;
  sidebarOpen: boolean;
  theme: Theme;
  themePalette: ThemePaletteId;
  customThemePalette: ThemePaletteColors;
  kimiThemePalettes: KimiThemePreset[];
}

export type StatusUpdateDisplay = "each" | "turn_end" | "never";
export type ProcessDisplayMode = "kimix" | "kimi-web";

export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
  gitBranch?: string;
  pinned?: boolean;
  sortOrder?: number;
}

export interface Session {
  id: string;
  engine?: "prompt" | "kimi-code";
  runtimeSessionId?: string;
  /** 官方 kimi session id（从 wire/screen 抓取并持久化），用于重启后 `kimi -S` 恢复上下文。 */
  officialSessionId?: string;
  /** 当前官方 runtime 已加载到的本地 Agent Skill 最新修改时间。 */
  skillRegistrySyncedAt?: number;
  /** Kimix 为刷新 Skill 注册表创建的透明 fork 父会话，用于历史加载兜底与目录折叠。 */
  skillForkParentSessionId?: string;
  /** Kimix 官方历史映射格式版本，用于一次性刷新旧的本地事件缓存。 */
  kimiHistoryCacheVersion?: number;
  /** 最近一次被官方 Server/SDK 会话目录确认可见的时间。 */
  officialCatalogConfirmedAt?: number;
  titleLocked?: boolean;
  model?: string | null;
  /** 最近一次会话模型切换时间，用于阻止空闲状态污染上一轮消息元信息。 */
  modelSwitchedAt?: number;
  /** 正在切换到的目标模型（API 返回前即写入），用于早于 store 更新的 SDK 事件判断。 */
  switchedToModel?: string;
  longTask?: LongTaskSessionMeta;
  title: string;
  projectPath: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  btwRounds?: BtwRound[];
  officialGoal?: OfficialGoalState;
  events: TimelineEvent[];
  isLoading: boolean;
}

export interface OfficialGoalState {
  goal: OfficialGoalSnapshot | null;
  updatedAt: number;
  error?: string | null;
}

export interface OfficialGoalSnapshot {
  goalId?: string;
  objective: string;
  completionCriterion?: string;
  status: string;
  turnsUsed?: number;
  tokensUsed?: number;
  wallClockMs?: number;
  terminalReason?: string;
}

export interface BtwRound {
  id: string;
  userContent: string;
  assistantContent?: string;
  thinking?: string;
  timestamp: number;
}

export interface LongTaskSessionMeta {
  taskId: string;
  title: string;
  stage: "drafting" | "planning" | "ready" | "running" | "reviewing" | "paused" | "completed";
  activeAgent: "executor" | "reviewer";
  recovery?: {
    status: "none" | "failed" | "interrupted" | "paused";
    reason: string;
    suggestedAction: string;
    updatedAt: number;
  } | null;
  executorSessionId: string;
  reviewerSessionId: string;
  bigPlanPath: string;
  reviewQueuePath: string;
  reviewedReviewItems?: string[];
  currentStep: number;
  targetStep: number | null;
}

export type TimelineEvent =
  | UserMessageEvent
  | SteerMessageEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
  | QuestionRequestEvent
  | StatusUpdateEvent
  | FileArtifactEvent
  | ChangeSummaryEvent
  | SessionRecommendationEvent
  | SubagentEvent
  | HookEvent
  | CompactionEvent
  | ErrorEvent
  | DiffEvent
  | TodoEvent;

export interface UserMessageEvent {
  id: string;
  type: "user_message";
  timestamp: number;
  content: string;
  images?: UserMessageImage[];
}

export interface UserMessageImage {
  id?: string;
  kind?: "image" | "file";
  name: string;
  dataUrl?: string;
  filePath?: string;
}

export interface SteerMessageEvent {
  id: string;
  type: "steer_message";
  timestamp: number;
  content: string;
  images?: UserMessageImage[];
  status: "sending" | "accepted" | "sent" | "failed";
  error?: string;
}

export interface AssistantMessageEvent {
  id: string;
  type: "assistant_message";
  timestamp: number;
  agentId?: string;
  agentRole?: "executor" | "reviewer";
  content: string;
  thinking?: string;
  thinkingParts?: ThinkingPart[];
  model?: string;
  isThinking: boolean;
  isComplete: boolean;
  durationMs?: number;
}

export interface ThinkingPart {
  id: string;
  timestamp: number;
  text: string;
}

export interface ToolCallEvent {
  id: string;
  type: "tool_call";
  timestamp: number;
  agentId?: string;
  toolCallId: string;
  toolName: string;
  status: "running" | "success" | "error";
  arguments: Record<string, unknown>;
  rawArguments?: string;
  result?: unknown;
  durationMs?: number;
}

export interface ToolResultEvent {
  id: string;
  type: "tool_result";
  timestamp: number;
  agentId?: string;
  toolCallId: string;
  toolName: string;
  result: unknown;
  display?: ToolDisplay;
}

export interface HookEvent {
  id: string;
  type: "hook";
  timestamp: number;
  phase: "triggered" | "resolved";
  eventName: string;
  target: string;
  action?: "allow" | "block";
  reason?: string;
  hookCount?: number;
  durationMs?: number;
}

export interface ToolDisplay {
  diff?: FileDiff;
  todo?: TodoItem[];
  status?: string;
}

export interface FileDiff {
  path: string;
  oldText: string;
  newText: string;
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "done";
}

export interface ApprovalRequestEvent {
  id: string;
  type: "approval_request";
  timestamp: number;
  requestId: string;
  toolName: string;
  description: string;
  details: string;
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected";
}

export interface QuestionRequestEvent {
  id: string;
  type: "question_request";
  timestamp: number;
  requestId: string;
  rpcRequestId: string;
  toolCallId: string;
  questions: QuestionRequestItem[];
  status: "pending" | "answered" | "skipped";
  answers?: Record<string, string>;
}

export interface QuestionRequestItem {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionRequestOption[];
}

export interface QuestionRequestOption {
  label: string;
  description?: string;
}

export interface StatusUpdateEvent {
  id: string;
  type: "status_update";
  timestamp: number;
  agentId?: string;
  agentRole?: "executor" | "reviewer";
  step?: number;
  totalSteps?: number;
  tokenCount?: number;
  inputTokenCount?: number;
  contextSize?: number;
  contextLimit?: number;
  planMode?: boolean;
  message?: string;
  source?: "runtime" | "slash" | "ui" | "ipc";
  tone?: "default" | "info" | "success" | "warning" | "danger";
  parentEventId?: string;
}

export interface FileArtifactEvent {
  id: string;
  type: "file_artifact";
  timestamp: number;
  filePath: string;
  fileType?: string;
}

export interface ChangeSummaryFile {
  path: string;
  additions?: number;
  deletions?: number;
}

export interface ChangeSummaryEvent {
  id: string;
  type: "change_summary";
  timestamp: number;
  projectPath?: string;
  files: ChangeSummaryFile[];
  additions: number;
  deletions: number;
}

export interface SessionRecommendationEvent {
  id: string;
  type: "session_recommendation";
  timestamp: number;
  reason: "turn_limit";
  turnCount: number;
  turnLimit: number;
  handoffStatus?: "running" | "completed" | "error";
  handoffError?: string;
  handoffRecovered?: boolean;
}

export interface SubagentEvent {
  id: string;
  type: "subagent";
  timestamp: number;
  agentId?: string;
  parentToolCallId?: string;
  swarmIndex?: number;
  description?: string;
  agentName: string;
  status: "queued" | "running" | "suspended" | "completed" | "error";
  resultSummary?: string;
  error?: string;
  events: TimelineEvent[];
}

export interface CompactionEvent {
  id: string;
  type: "compaction";
  timestamp: number;
  phase: "begin" | "end";
}

export interface ErrorEvent {
  id: string;
  type: "error";
  timestamp: number;
  message: string;
  source?: "sdk" | "ipc" | "ui";
  canDismiss?: boolean;
}

export interface DiffEvent {
  id: string;
  type: "diff";
  timestamp: number;
  filePath: string;
  oldText: string;
  newText: string;
}

export interface TodoEvent {
  id: string;
  type: "todo";
  timestamp: number;
  items: TodoItem[];
}
