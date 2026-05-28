import type { LongTaskDetail } from "@electron/types/ipc";

export type ParsedBigPlanStep = {
  index: number;
  title: string;
  goal: string;
  scope: string;
  acceptance: string;
  status: string;
};

export type ParsedLongTaskDetail = {
  goal: string;
  initialRequest: string;
  steps: ParsedBigPlanStep[];
  reviewItems: string[];
  rounds: ParsedLongTaskRound[];
};

export type ParsedLongTaskRoundEntry = {
  title: string;
  phase: string;
  role: string;
  conclusion: string;
  content: string;
};

export type ParsedLongTaskRound = {
  step: number;
  filePath: string;
  updatedAt: number;
  entries: ParsedLongTaskRoundEntry[];
};

function extractMarkdownSection(content: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^##\\s+${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "m"));
  return match?.[1]?.trim() ?? "";
}

function extractField(block: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`^${escaped}：\\s*(.*)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

export function parseBigPlanSteps(content: string): ParsedBigPlanStep[] {
  const steps: ParsedBigPlanStep[] = [];
  const stepRegex = /^###\s+Step\s+(\d+)([^\r\n]*)\r?\n([\s\S]*?)(?=^###\s+Step\s+\d+|^##\s+|(?![\s\S]))/gm;
  for (const match of content.matchAll(stepRegex)) {
    const index = Number(match[1]);
    const suffix = match[2]?.trim();
    const block = match[3] ?? "";
    steps.push({
      index,
      title: suffix || `Step ${index}`,
      goal: extractField(block, "目标"),
      scope: extractField(block, "范围"),
      acceptance: extractField(block, "验收标准"),
      status: extractField(block, "状态") || "未标记",
    });
  }
  return steps;
}

export function parseReviewItems(content: string) {
  const pending = extractMarkdownSection(content, "待处理") || content;
  return pending
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line && line !== "暂无");
}

function extractBulletField(block: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`^-\\s+${escaped}：\\s*(.*)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

export function parseRoundEntries(content: string): ParsedLongTaskRoundEntry[] {
  const entries: ParsedLongTaskRoundEntry[] = [];
  const entryRegex = /^##\s+([^\r\n]+)\r?\n([\s\S]*?)(?=^##\s+|(?![\s\S]))/gm;
  for (const match of content.matchAll(entryRegex)) {
    const block = match[2] ?? "";
    const recordMatch = block.match(/^###\s+记录\s*\r?\n([\s\S]*)$/m);
    entries.push({
      title: match[1]?.trim() || "轮次记录",
      phase: extractBulletField(block, "阶段"),
      role: extractBulletField(block, "角色"),
      conclusion: extractBulletField(block, "结论"),
      content: (recordMatch?.[1] ?? block).trim(),
    });
  }
  if (entries.length > 0) return entries;
  const fallback = content.replace(/^#\s+[^\r\n]+\r?\n+/, "").trim();
  return fallback ? [{
    title: "轮次记录",
    phase: "",
    role: "",
    conclusion: "",
    content: fallback,
  }] : [];
}

export function parseLongTaskRounds(detail: LongTaskDetail) {
  return detail.rounds.map((round) => ({
    step: round.step,
    filePath: round.filePath,
    updatedAt: round.updatedAt,
    entries: parseRoundEntries(round.content),
  }));
}

export function parseLongTaskDetail(detail: LongTaskDetail | null): ParsedLongTaskDetail | null {
  if (!detail) return null;
  return {
    goal: extractMarkdownSection(detail.bigPlanContent, "目标") || detail.title,
    initialRequest: extractMarkdownSection(detail.bigPlanContent, "初始需求") || detail.initialRequest,
    steps: parseBigPlanSteps(detail.bigPlanContent),
    reviewItems: parseReviewItems(detail.reviewQueueContent),
    rounds: parseLongTaskRounds(detail),
  };
}

export function normalizeReviewItem(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
