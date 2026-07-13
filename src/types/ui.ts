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
export type RoomAgentActivityStatus =
  | "idle"
  | "creating"
  | "queued"
  | "sending"
  | "accepted"
  | "running"
  | "waiting_approval"
  | "waiting_question"
  | "completed"
  | "interrupted"
  | "error";

export interface RoomAgentActivity {
  roomId: string;
  roomAgentId: string;
  runtimeSessionId?: string;
  status: RoomAgentActivityStatus;
  roomMessageId?: string;
  activeTurnId?: string;
  startedAt?: number;
  updatedAt: number;
}

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
  roomAgentActivities: Record<string, RoomAgentActivity>;
  creatingSessionProjectPath: string | null;
  defaultThinking: boolean;
  defaultPlanMode: boolean;
  fontSize: number;
  additionalWorkDirs: string[];
  detailedContext: boolean;
  statusUpdateDisplay: StatusUpdateDisplay;
  sessionRecommendationEnabled: boolean;
  sessionRecommendationTurnLimit: number;
  voiceShortcut: string;
  notificationMode: NotificationMode;
  notificationShowContent: boolean;
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

export type RoomAgentDeliveryStatus =
  | "queued"
  | "sending"
  | "accepted"
  | "running"
  | "waiting_approval"
  | "waiting_question"
  | "completed"
  | "failed"
  | "indeterminate"
  | "cancelled";

export interface RoomAgentDeliveryAttempt {
  dispatchAttemptId: string;
  agentTurnId: string;
  status: RoomAgentDeliveryStatus;
  officialPromptId?: string;
  officialUserEventId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RoomAgentDelivery {
  status: RoomAgentDeliveryStatus;
  agentTurnId: string;
  dispatchAttemptId?: string;
  officialPromptId?: string;
  officialUserEventId?: string;
  error?: string;
  createdAt?: number;
  updatedAt?: number;
  previousAttempts?: RoomAgentDeliveryAttempt[];
}

export interface RoomUserMessage {
  id: string;
  content: string;
  /** 已移除 Kimix 房间路由 token、可直接发送给每个接收 Agent 的冻结正文。 */
  outboundContent?: string;
  images?: UserMessageImage[];
  recipientAgentIds: string[];
  deliveries: Record<string, RoomAgentDelivery>;
  timestamp: number;
}

export interface RoomAgent {
  id: string;
  displayName: string;
  mentionName: string;
  modelAlias: string | null;
  modelLabelSnapshot?: string;
  providerLabelSnapshot?: string;
  permissionMode: PermissionMode;
  runtimeSessionId?: string;
  officialSessionId?: string;
  provisioningError?: string;
  skillRegistrySyncedAt?: number;
  skillForkParentSessionId?: string;
  kimiHistoryCacheVersion?: number;
  officialCatalogConfirmedAt?: number;
  swarmModeLockedAt?: number;
  swarmMode?: boolean;
  swarmModeDesired?: boolean;
  modelSwitchedAt?: number;
  switchedToModel?: string;
  officialGoal?: OfficialGoalState;
  btwRounds?: BtwRound[];
  createdAt: number;
  removedAt?: number;
  archivedAt?: number;
  missingSince?: number;
  recoveryIssue?: {
    status: "error" | "unavailable";
    message: string;
    updatedAt: number;
  };
  lifecycleIssue?: {
    operation: "archive" | "restore";
    message: string;
    updatedAt: number;
  };
}

export interface CollaborationState {
  schemaVersion: 1;
  /** 最近一次由支持房间结构的版本同步顶层 primary 兼容镜像的时间。 */
  primaryMirrorUpdatedAt: number;
  primaryAgentId: string;
  defaultRecipientIds: string[];
  focusedAgentId?: string;
  agents: RoomAgent[];
  messages: RoomUserMessage[];
  agentEvents: Record<string, TimelineEvent[]>;
}

export interface UnsupportedCollaborationState {
  reason: "unsupported-schema" | "invalid-schema";
  schemaVersion?: number;
  /** 仅在运行时保存；持久化时重新写回 collaboration 原字段。 */
  raw: unknown;
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
  /** 本会话曾为 Swarm 迁移到 SDK；保持同一官方会话 ID 走 SDK 路由，不代表 Swarm 当前开启。 */
  swarmModeLockedAt?: number;
  /** 官方会话当前报告的 Swarm 模式状态，仅用于精确显示端内状态。 */
  swarmMode?: boolean;
  /** 运行中切换 Swarm 时记录的下一轮目标状态；应用成功后清除。 */
  swarmModeDesired?: boolean;
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
  /** 用户控制的多 Agent 房间；缺失时按单一 synthetic primary Agent 兼容读取。 */
  collaboration?: CollaborationState;
  /** 未知或损坏的协同结构保持原样，当前版本不得降级覆盖。 */
  unsupportedCollaboration?: UnsupportedCollaborationState;
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

export interface RoomEventScope {
  /** 房间参与者所有权；缺失时兼容解释为 primary Agent。 */
  roomAgentId?: string;
  /** 房间级用户消息身份。 */
  roomMessageId?: string;
  /** 单个 Agent 回复块的稳定身份。 */
  agentTurnId?: string;
  /** 用户消息的实际房间接收者。 */
  recipientAgentIds?: string[];
  /** 仅用于房间时间线投影的 delivery 状态提示。 */
  roomDeliveryStatus?: RoomAgentDeliveryStatus;
}

export type TimelineEvent = (
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
  | TodoEvent
) & RoomEventScope;

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
  signature?: string;
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
  description?: string;
  display?: ToolDisplay;
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
  kind?: string;
  command?: string;
  cwd?: string;
  description?: string;
  language?: string;
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
  display?: ApprovalDisplay;
}

export interface ApprovalDisplay {
  kind?: string;
  title?: string;
  description?: string;
  plan?: string;
  path?: string;
  options?: ApprovalDisplayOption[];
}

export interface ApprovalDisplayOption {
  label: string;
  description?: string;
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
  id?: string;
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionRequestOption[];
}

export interface QuestionRequestOption {
  id?: string;
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
  swarmMode?: boolean;
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
  /** SHA-256 of the file content after the Agent modification. Used to detect subsequent user edits before revert. */
  snapshotHash?: string;
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
  summary?: string;
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
