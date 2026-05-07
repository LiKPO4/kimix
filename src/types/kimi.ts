// Kimi SDK related types
// Re-export from SDK or define local wrappers as needed

export interface KimiSessionConfig {
  workDir: string;
  sessionId?: string;
  model?: string;
  thinking?: boolean;
  yoloMode?: boolean;
}

export type KimiEventType =
  | "TurnBegin"
  | "StepBegin"
  | "StepInterrupted"
  | "ContentPart"
  | "ToolCall"
  | "ToolCallPart"
  | "ToolResult"
  | "SubagentEvent"
  | "StatusUpdate"
  | "CompactionBegin"
  | "CompactionEnd"
  | "ApprovalRequest"
  | "TurnEnd";
