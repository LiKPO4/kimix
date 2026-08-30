import type { StatusNotificationDetail, TimelineEvent } from "@/types/ui";
import { reliableAssistantDurationMs } from "./duration";
import { STALE_TIMELINE_WORK_MS } from "./sessionActivity";
import { extractFileAttachmentText } from "./userFileAttachments";

export function isLegacyKimiWorkDirError(message: string) {
  return /unknown option\s+['"]?--work-dir['"]?/i.test(message);
}

export function parseKimiSkillActivation(content: string): { name: string; args: string; trigger: string } | null {
  const marker = content.match(/<kimi-skill-loaded\b([^>]*)>/i);
  if (!marker) return null;
  const readAttribute = (name: string) => marker[1].match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? "";
  const skillName = readAttribute("name").trim();
  if (!skillName) return null;
  return {
    name: skillName,
    args: readAttribute("args").trim(),
    trigger: readAttribute("trigger").trim().toLowerCase(),
  };
}

export interface AgentEnvelopeSummary {
  kind: "notification" | "cron-fire";
  tone: "info" | "success" | "warning";
  summary: string;
  /** 结构化信封字段，供通知详情卡渲染（v2.20.269 起随 status_update 持久化）。 */
  notification: StatusNotificationDetail;
}

function envelopeAttr(attrs: string, name: string): string | undefined {
  return attrs.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] || undefined;
}

/**
 * 官方运行时会话历史中的代理循环信封（后台任务完成/丢失通知、定时任务触发）
 * 以 role=user 持久化。它们不是用户输入，渲染时必须折叠为状态摘要，
 * 否则原始 XML 信封会出现在用户气泡里。
 */
export function parseKimiAgentEnvelope(content: string): AgentEnvelopeSummary | null {
  const trimmed = content.trim();
  const notification = trimmed.match(/^<notification\b([^>]*)>([\s\S]*?)<\/notification>\s*$/i);
  if (notification) {
    const attrs = notification[1];
    const type = envelopeAttr(attrs, "type") ?? "";
    const inner = notification[2];
    // 对齐官方：解析 <output-file path bytes>，卡片展示输出文件行与复制路径入口。
    const outputFileMatch = inner.match(/<output-file\b([^>]*)>/i);
    const outputPath = outputFileMatch ? envelopeAttr(outputFileMatch[1], "path") : undefined;
    const outputBytes = outputFileMatch ? Number(envelopeAttr(outputFileMatch[1], "bytes")) : NaN;
    const outputFile = outputPath
      ? { path: outputPath, bytes: Number.isFinite(outputBytes) ? outputBytes : undefined }
      : undefined;
    const text = inner.replace(/<output-file\b[\s\S]*?(<\/output-file>|$)/gi, "").trim();
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const title = lines.find((line) => /^Title:/i.test(line))?.replace(/^Title:\s*/i, "") ?? "";
    const severity = lines.find((line) => /^Severity:/i.test(line))?.replace(/^Severity:\s*/i, "") ?? "";
    const description = lines.filter((line) => !/^(Title|Severity):/i.test(line)).join(" ").trim();
    const target = description.replace(/\s+(completed|lost|failed|stopped|timed out|killed)\.?$/i, "").trim() || description || title;
    const sourceKind = envelopeAttr(attrs, "source_kind");
    const detail: StatusNotificationDetail = {
      kind: "notification",
      type,
      category: envelopeAttr(attrs, "category"),
      sourceKind,
      sourceId: envelopeAttr(attrs, "source_id"),
      agentId: envelopeAttr(attrs, "agent_id"),
      title: title || undefined,
      severity: severity || undefined,
      body: description || undefined,
      raw: trimmed,
      outputFile,
    };
    // 对齐官方：来源名按 source_kind 区分 子代理/后台任务；状态按 type 后缀识别
    // （completed/failed/timed_out/killed/lost，其余按通知兜底）。
    const kindLabel = sourceKind === "subagent" ? "子代理" : "后台任务";
    if (type.endsWith(".completed")) return { kind: "notification", tone: "success", summary: `${kindLabel}已完成：${target}`, notification: detail };
    if (type.endsWith(".lost")) return { kind: "notification", tone: "warning", summary: `${kindLabel}已丢失：${target}`, notification: detail };
    if (type.endsWith(".failed")) return { kind: "notification", tone: "warning", summary: `${kindLabel}已失败：${target}`, notification: detail };
    if (type.endsWith(".timed_out")) return { kind: "notification", tone: "warning", summary: `${kindLabel}已超时：${target}`, notification: detail };
    if (type.endsWith(".killed")) return { kind: "notification", tone: "warning", summary: `${kindLabel}已终止：${target}`, notification: detail };
    return { kind: "notification", tone: "info", summary: `${kindLabel}通知：${target}`, notification: detail };
  }
  const cronFire = trimmed.match(/^<cron-fire\b([^>]*)>([\s\S]*?)<\/cron-fire>\s*$/i);
  if (cronFire) {
    const attrs = cronFire[1];
    const prompt = cronFire[2].match(/<prompt>([\s\S]*?)<\/prompt>/i)?.[1].trim() ?? "";
    const firstLine = prompt.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? "";
    const detail: StatusNotificationDetail = {
      kind: "cron-fire",
      type: "cron.fire",
      category: "cron",
      sourceKind: "cron",
      sourceId: envelopeAttr(attrs, "jobId"),
      title: "Cron job fired",
      severity: "info",
      body: prompt || undefined,
      raw: trimmed,
    };
    return { kind: "cron-fire", tone: "info", summary: `定时任务触发：${firstLine.slice(0, 80)}`, notification: detail };
  }
  return null;
}

/**
 * 前缀兜底只接受与前缀模板"高度匹配"的整句：剩余尾巴超过该长度时视为普通
 * 用户消息，不折叠。官方续跑消息的追加说明最长约 53 字符（历史脏数据全保留），
 * 用户长指令（典型误伤场景）被挡在门槛外，避免不可逆的渲染语义变化。
 */
const GOAL_CONTINUATION_MAX_TAIL_LEN = 60;
const GOAL_CONTINUATION_PREFIXES = [
  "Continue working toward the active goal.",
  "The previous goal turn reached the per-turn step limit",
] as const;

/**
 * goal 模式内部续跑提示词判定。官方运行时把系统触发的 goal 续跑作为 role=user
 * 消息持久化（快照消息带 metadata.origin、wire turn.prompt 记录带 origin），
 * 它不是用户输入，渲染时必须折叠为状态摘要，否则原文会出现在用户气泡里。
 * 判定以 origin 为主（kind==="system_trigger" && name==="goal_continuation"），
 * 历史/清洗层拿不到 origin 时用文本前缀兜底。
 * 注意：首轮 /goal 原文与 "Resume the active goal." 是正常用户消息，不命中。
 */
export function parseKimiGoalContinuation(content: string, origin?: unknown): { kind: "goal-continuation" } | null {
  if (typeof origin === "object" && origin !== null && !Array.isArray(origin)) {
    const record = origin as Record<string, unknown>;
    if (record.kind === "system_trigger" && record.name === "goal_continuation") {
      return { kind: "goal-continuation" };
    }
  }
  const trimmed = content.trim();
  if (!trimmed) return null;
  // 文本前缀只是拿不到 origin 时的兜底：仅接受整句与前缀模板高度匹配
  // （剩余尾巴极短），不能只要 startsWith 就折叠。
  for (const prefix of GOAL_CONTINUATION_PREFIXES) {
    if (
      trimmed.startsWith(prefix) &&
      trimmed.length - prefix.length <= GOAL_CONTINUATION_MAX_TAIL_LEN
    ) {
      return { kind: "goal-continuation" };
    }
  }
  return null;
}

const BUILTIN_SKILL_COMMAND_NAMES = new Set(["custom-theme", "import-from-cc-codex", "mcp-config"]);

export function formatKimiSkillActivationCommand(name: string, args = "") {
  const normalizedName = name.trim();
  const command = BUILTIN_SKILL_COMMAND_NAMES.has(normalizedName.toLowerCase())
    ? `/${normalizedName}`
    : `/skill:${normalizedName}`;
  return `${command}${args.trim() ? ` ${args.trim()}` : ""}`;
}

export function sanitizeKimiSkillActivationTitle(title: string) {
  const match = title.match(/^User activated the skill\s+["“]([^"”]+)["”]/i);
  return match ? `使用 ${match[1]}` : title;
}

function hasUnclosedStrongEmphasisLine(content: string) {
  let insideFence = false;
  for (const line of content.split(/\r?\n/)) {
    const fenceCount = line.match(/```/g)?.length ?? 0;
    const visibleLine = insideFence ? "" : line.replace(/```[\s\S]*$/, "");
    if (visibleLine) {
      const asteriskPairs = visibleLine.match(/\*\*/g)?.length ?? 0;
      const underscorePairs = visibleLine.match(/__/g)?.length ?? 0;
      if (asteriskPairs % 2 === 1 || underscorePairs % 2 === 1) return true;
    }
    if (fenceCount % 2 === 1) insideFence = !insideFence;
  }
  return false;
}

export function hasMalformedAssistantMarkdown(events: TimelineEvent[]) {
  return events.some((event) => (
    event.type === "assistant_message" && hasUnclosedStrongEmphasisLine(event.content)
  ));
}

export function sanitizePersistedEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.flatMap<TimelineEvent>((event) => {
    if (event.type === "error" && isLegacyKimiWorkDirError(event.message)) return [];
    if (event.type !== "user_message") return [event];
    const envelope = parseKimiAgentEnvelope(event.content);
    if (envelope) {
      return [{
        id: event.id,
        type: "status_update" as const,
        timestamp: event.timestamp,
        message: envelope.summary,
        source: "runtime" as const,
        tone: envelope.tone,
        notification: envelope.notification,
      }];
    }
    // 历史脏数据修复：goal 续跑提示词曾以 user_message 持久化，恢复路径
    // 拿不到 origin，按文本前缀折叠为状态摘要（轮次边界由事件位置保留）。
    const goalContinuation = parseKimiGoalContinuation(event.content);
    if (goalContinuation) {
      return [{
        id: event.id,
        type: "status_update" as const,
        timestamp: event.timestamp,
        message: "目标续跑",
        source: "runtime" as const,
        tone: "info" as const,
      }];
    }
    const activation = parseKimiSkillActivation(event.content);
    if (!activation) return [event];
    if (activation.trigger === "model-tool") {
      return [{
        id: event.id,
        type: "status_update" as const,
        timestamp: event.timestamp,
        message: `已调用 Skill：${activation.name}`,
        source: "skill",
        tone: "info" as const,
      }];
    }
    return [{
      ...event,
      content: formatKimiSkillActivationCommand(activation.name, activation.args),
    }];
  });
}

export function latestAssistantContent(events: TimelineEvent[]) {
  return [...events].reverse().find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => (
    event.type === "assistant_message" && event.content.trim().length > 0
  ))?.content.trim() ?? "";
}

export function latestAssistantVisibleOrThinkingContent(events: TimelineEvent[]) {
  const content = latestAssistantContent(events);
  if (content) return content;
  const assistant = [...settleInactiveEvents(events)].reverse().find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => (
    event.type === "assistant_message" &&
    (Boolean(event.thinking?.trim()) || Boolean(event.thinkingParts?.some((part) => part.text.trim().length > 0)))
  ));
  if (!assistant) return "";
  const parts = assistant.thinkingParts?.map((part) => part.text).join("").trim();
  return parts || assistant.thinking?.trim() || "";
}

function isEmptyAssistantEvent(event: Extract<TimelineEvent, { type: "assistant_message" }>) {
  return !event.content.trim() &&
    !event.thinking?.trim() &&
    !event.thinkingParts?.some((part) => part.text.trim());
}

function isLocalSendStatus(event: Extract<TimelineEvent, { type: "status_update" }>) {
  const message = event.message?.trim() ?? "";
  return event.source === "ipc" ||
    /消息(?:发送中|处理中|处理失败|发送失败)/.test(message);
}

function isRealTurnOutput(event: TimelineEvent) {
  return event.type === "tool_call" ||
    event.type === "tool_result" ||
    event.type === "subagent" ||
    event.type === "hook" ||
    event.type === "approval_request" ||
    event.type === "question_request" ||
    event.type === "change_summary" ||
    event.type === "diff" ||
    event.type === "file_artifact" ||
    event.type === "session_recommendation" ||
    event.type === "todo" ||
    event.type === "compaction";
}

export function hasLocalFailedSendAttempt(events: TimelineEvent[], userEventId: string): boolean {
  const userIndex = events.findIndex((event) => event.type === "user_message" && event.id === userEventId);
  if (userIndex === -1) return false;

  let sawLocalSendMarker = false;
  for (let index = userIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "user_message" || event.type === "steer_message") break;
    if (event.type === "status_update") {
      if (event.parentEventId === userEventId || (!event.parentEventId && isLocalSendStatus(event))) {
        sawLocalSendMarker = true;
      }
      continue;
    }
    if (event.type === "assistant_message") {
      if (isEmptyAssistantEvent(event)) continue;
      return false;
    }
    if (event.type === "error") return true;
    if (isRealTurnOutput(event)) return false;
  }
  return sawLocalSendMarker;
}

export function hasLocalOrphanUserSendAttempt(events: TimelineEvent[], userEventId: string): boolean {
  const userIndex = events.findIndex((event) => event.type === "user_message" && event.id === userEventId);
  if (userIndex === -1) return false;

  for (let index = userIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "user_message" || event.type === "steer_message") return false;
    if (event.type === "status_update") continue;
    if (event.type === "assistant_message") {
      if (isEmptyAssistantEvent(event)) continue;
      return false;
    }
    if (event.type === "error") return true;
    if (isRealTurnOutput(event)) return false;
  }
  return true;
}

export function isLatestUserInputEvent(events: TimelineEvent[], userEventId: string): boolean {
  const latestUserInput = events.findLast((event) => event.type === "user_message" || event.type === "steer_message");
  return latestUserInput?.type === "user_message" && latestUserInput.id === userEventId;
}

/**
 * Echo normalization for matching a local user message against official
 * history: strip the attachment section and collapse whitespace.
 */
function normalizeUserContentForEcho(content: string): string {
  const extracted = extractFileAttachmentText(content).content;
  const legacyMarker = extracted.search(/(?:^|\n)附件文件：/);
  const visibleContent = legacyMarker >= 0 ? extracted.slice(0, legacyMarker) : extracted;
  return visibleContent.replace(/\s+/g, " ").trim();
}

/**
 * Whether the official (canonical) history contains this user message as its
 * latest user turn. A message that was dispatched but never answered leaves
 * no official turn evidence, yet still lives in the official history;
 * withdrawing it only locally keeps it in the model context and the next
 * prompt sees the content twice. Used to decide whether a withdrawal must
 * call the official undo API. The message must be the latest official user
 * turn, because the official undo removes exactly one latest turn.
 */
export function officialHistoryHasUserMessageAsLatest(
  events: TimelineEvent[],
  match: { content: string; officialUserEventId?: string },
): boolean {
  const userIndexes = events.flatMap((event, index) => (
    event.type === "user_message" ? [index] : []
  ));
  const latestIndex = userIndexes.at(-1);
  if (latestIndex === undefined) return false;
  const latest = events[latestIndex];
  if (latest.type !== "user_message") return false;
  if (match.officialUserEventId && latest.id === match.officialUserEventId) return true;
  const expected = normalizeUserContentForEcho(match.content);
  if (!expected) return false;
  return normalizeUserContentForEcho(latest.content) === expected;
}

export function hasOfficialTurnEvidenceAfterUser(events: TimelineEvent[], userEventId: string): boolean {
  const userIndex = events.findIndex((event) => event.type === "user_message" && event.id === userEventId);
  if (userIndex === -1) return false;
  for (let index = userIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "user_message" || event.type === "steer_message") break;
    if (event.type === "assistant_message") {
      if (!isEmptyAssistantEvent(event)) return true;
      continue;
    }
    if (event.type === "error") {
      if (event.source === "sdk") return true;
      continue;
    }
    if (event.type === "status_update") {
      if (event.source === "runtime") return true;
      continue;
    }
    if (isRealTurnOutput(event)) return true;
  }
  return false;
}

export function truncateLatestUserTurn(events: TimelineEvent[], userEventId: string): TimelineEvent[] {
  if (!isLatestUserInputEvent(events, userEventId)) return events;
  const userIndex = events.findIndex((event) => event.type === "user_message" && event.id === userEventId);
  if (userIndex === -1) return events;
  return events.slice(0, userIndex);
}

export function removeLocalUserSendAttempt(events: TimelineEvent[], userEventId: string): TimelineEvent[] {
  const userIndex = events.findIndex((event) => event.type === "user_message" && event.id === userEventId);
  if (userIndex === -1) return events;

  const removeIds = new Set<string>([userEventId]);
  for (let index = userIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "user_message" || event.type === "steer_message") break;
    if (event.type === "status_update") {
      if (event.parentEventId === userEventId || (!event.parentEventId && isLocalSendStatus(event))) {
        removeIds.add(event.id);
        continue;
      }
      continue;
    }
    if (event.type === "assistant_message") {
      if (isEmptyAssistantEvent(event)) {
        removeIds.add(event.id);
        continue;
      }
      break;
    }
    if (event.type === "error") {
      removeIds.add(event.id);
      continue;
    }
    if (isRealTurnOutput(event)) {
      break;
    }
  }
  return events.filter((event) => !removeIds.has(event.id));
}

/**
 * Whether the latest user turn (events after the last user_message) has
 * received any displayable Assistant body, thinking, tool, subagent, or error
 * event. Used by the terminal-status polling path to detect a premature
 * terminal report: 0.27 Server may report idle/completed before the assistant
 * body streams. A turn that never received body must not be settled, or the
 * empty optimistic placeholder is deleted and the message header disappears
 * leaving only a status bubble. status_update events (e.g. "Context: X%")
 * do not count as body.
 */
export function hasTurnReceivedBody(events: TimelineEvent[]): boolean {
  const latestUserIndex = events.findLastIndex((event) => event.type === "user_message");
  if (latestUserIndex < 0) return false;
  return events.slice(latestUserIndex + 1).some((event) => (
    (event.type === "assistant_message" && (
      event.content.trim() ||
      Boolean(event.thinking?.trim()) ||
      Boolean(event.thinkingParts?.some((part) => part.text.trim()))
    )) ||
    event.type === "tool_call" ||
    event.type === "tool_result" ||
    event.type === "subagent" ||
    event.type === "error"
  ));
}

function isStaleRunningEvent(event: TimelineEvent, settledAt: number) {
  return settledAt - event.timestamp > STALE_TIMELINE_WORK_MS;
}

/**
 * Guarded settle for non-authoritative paths (status polling, one-shot
 * hydration queries, persistence). A transient terminal report must not
 * force-complete a turn that is still producing events: when any event in the
 * timeline is younger than the stale-work window, open assistants stay open
 * and empty placeholders are preserved. Once the whole timeline has been
 * silent past the window, guarded mode settles exactly like the immediate
 * path. Authoritative completions (prompt.completed status events) keep the
 * immediate behavior.
 */
export function settleInactiveEvents(events: TimelineEvent[], settledAt = Date.now(), preserveEmptyAssistant = false, guardRecentActivity = false): TimelineEvent[] {
  const hasRecentActivity = guardRecentActivity && events.some((event) => (
    settledAt - event.timestamp <= STALE_TIMELINE_WORK_MS
  ));
  const settled = events.flatMap<TimelineEvent>((event) => {
    if (event.type === "subagent") {
      if (
        (event.status === "queued" || event.status === "running" || event.status === "suspended") &&
        isStaleRunningEvent(event, settledAt)
      ) {
        // 平静收敛路径：stale 的 queued/running/suspended 一并收尾为 completed，
        // 否则侧栏 open 判定（queued/running/suspended 视为活动）永久残留。
        // queued 超时视为 abandoned 收尾、suspended 超时视为挂起失效收尾；
        // 统一 completed 与 running 既有语义一致（subagent 状态类型无 cancelled）。
        return [{ ...event, status: "completed" as const }];
      }
      return [event];
    }
    if (event.type === "tool_call") {
      if (event.status === "running" && isStaleRunningEvent(event, settledAt)) {
        return [{
          ...event,
          status: "error" as const,
          result: event.result ?? "工具执行已中断，未收到完成结果。",
          durationMs: undefined,
        }];
      }
      return [event];
    }
    if (event.type !== "assistant_message" || event.isComplete) return [event];
    const hasContent = event.content.trim().length > 0;
    const hasThinking = Boolean(
      event.thinking?.trim() ||
      event.thinkingParts?.some((part) => part.text.trim().length > 0)
    );
    if (!hasContent && !hasThinking) {
      // A turn that never received body may be a premature terminal report
      // (0.27 Server can report idle before the body streams). When
      // preserveEmptyAssistant is set, keep the placeholder as isComplete=false
      // so the message header stays visible and the turn is not settled; the
      // real body can still arrive and fill it. Without this flag the empty
      // placeholder is deleted (genuinely failed/orphaned turns). Guarded
      // settles never delete placeholders while the timeline is still active.
      return (preserveEmptyAssistant || hasRecentActivity) ? [event] : [];
    }
    if (hasRecentActivity) return [event];
    return [{ ...event, isComplete: true, isThinking: false, durationMs: reliableAssistantDurationMs(event.durationMs) }];
  });
  return closeOpenCompaction(settled);
}

export function settleFailedEvents(
  events: TimelineEvent[],
  message = "当前轮执行失败。",
  settledAt = Date.now(),
): TimelineEvent[] {
  const settled = events.flatMap<TimelineEvent>((event) => {
    if (event.type === "subagent" && ["queued", "running", "suspended"].includes(event.status)) {
      return [{ ...event, status: "error" as const, error: event.error ?? message }];
    }
    if (event.type === "tool_call" && event.status === "running") {
      return [{
        ...event,
        status: "error" as const,
        result: event.result ?? message,
        durationMs: Math.max(0, settledAt - event.timestamp),
      }];
    }
    if (event.type !== "assistant_message" || event.isComplete) return [event];
    const hasContent = event.content.trim().length > 0;
    const hasThinking = Boolean(
      event.thinking?.trim() ||
      event.thinkingParts?.some((part) => part.text.trim().length > 0)
    );
    if (!hasContent && !hasThinking) return [];
    return [{
      ...event,
      isThinking: false,
      isComplete: true,
      durationMs: reliableAssistantDurationMs(event.durationMs ?? Math.max(0, settledAt - event.timestamp)),
    }];
  });
  return closeOpenCompaction(settled);
}

export function findUnmatchedCompactionBeginIndex(events: TimelineEvent[]): number {
  let endCount = 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "compaction") continue;
    if (event.phase === "end") {
      endCount += 1;
    } else if (event.phase === "begin") {
      if (endCount === 0) return index;
      endCount -= 1;
    }
  }
  return -1;
}

export function closeOpenCompaction(events: TimelineEvent[]): TimelineEvent[] {
  const beginIndex = findUnmatchedCompactionBeginIndex(events);
  if (beginIndex === -1) return events;
  const begin = events[beginIndex] as Extract<TimelineEvent, { type: "compaction" }>;
  const endEvent: TimelineEvent = {
    id: Math.random().toString(36).substring(2, 11),
    type: "compaction",
    timestamp: Date.now(),
    phase: "end",
    source: begin.source,
  };
  return [...events.slice(0, beginIndex + 1), endEvent, ...events.slice(beginIndex + 1)];
}

/**
 * 压缩事件显示归一。官方一次压缩可能从多个通道各发一对 begin/end
 * （compaction.started / full_compaction.begin …），时间线里会堆出多条
 * 「压缩中」气泡；旧折叠只删「下一条压缩事件恰好是 end」的 begin，嵌套
 * 重复序列（b,b,b,e,e）会漏掉中间的 begin。按「连续压缩事件簇」归一：
 * - 簇内有 end：已配对 begin 全删，只留一个 end（优先带摘要者，并列取靠后的）；
 * - 簇内只有 begin（仍在压缩）：只留最后一条 begin，保证同时只有一个
 *   「压缩中」气泡；
 * - 簇内 end 之后又有未配对 begin（上一轮刚收尾、新一轮已开始）：保留该 begin。
 */
export function normalizeCompactionDisplay(events: TimelineEvent[]): TimelineEvent[] {
  const result: TimelineEvent[] = [];
  let index = 0;
  while (index < events.length) {
    const event = events[index];
    if (event.type !== "compaction") {
      result.push(event);
      index += 1;
      continue;
    }
    let clusterEnd = index;
    while (clusterEnd < events.length && events[clusterEnd].type === "compaction") {
      clusterEnd += 1;
    }
    const cluster = events.slice(index, clusterEnd) as Extract<TimelineEvent, { type: "compaction" }>[];
    // 栈式配对 begin→end（嵌套重复通道时内层先配对）；配对结束后仍留在栈里的
    // begin 就是仍在进行的压缩。
    const openBegins: number[] = [];
    const matchedBegins = new Set<number>();
    const endIndexes: number[] = [];
    cluster.forEach((item, offset) => {
      if (item.phase === "begin") {
        openBegins.push(offset);
        return;
      }
      endIndexes.push(offset);
      const begin = openBegins.pop();
      if (begin !== undefined) matchedBegins.add(begin);
    });
    // 未配对 begin 只有在最后一条 end 之后才代表「新一轮压缩进行中」；
    // 嵌套重复通道残留的 begin 排在 end 之前，随已结束的簇一并删除。
    const lastEnd = endIndexes.length > 0 ? endIndexes[endIndexes.length - 1] : -1;
    const pendingBegins = openBegins.filter((offset) => offset > lastEnd);
    const keepBegin = pendingBegins.length > 0 ? pendingBegins[pendingBegins.length - 1] : -1;
    let keepEnd = -1;
    for (const offset of endIndexes) {
      if (keepEnd === -1) {
        keepEnd = offset;
        continue;
      }
      const hasSummary = Boolean(cluster[offset].summary);
      const keptHasSummary = Boolean(cluster[keepEnd].summary);
      // 优先带摘要的 end；摘要状态相同则取靠后的（信息更新）。
      if (hasSummary !== keptHasSummary ? hasSummary : true) keepEnd = offset;
    }
    cluster.forEach((item, offset) => {
      if (item.phase === "begin") {
        if (!matchedBegins.has(offset) && offset === keepBegin) result.push(item);
      } else if (offset === keepEnd) {
        result.push(item);
      }
    });
    index = clusterEnd;
  }
  return result;
}

/**
 * Extract a numeric sequence number from a snapshotMessageId that ends with
 * `_<digits>`. Returns undefined when no tail digit is present.
 */
function snapshotSeq(snapshotMessageId?: string): number | undefined {
  if (!snapshotMessageId) return undefined;
  const match = /_(\d+)$/.exec(snapshotMessageId);
  return match ? Number(match[1]) : undefined;
}

/**
 * Repair in-place event ordering broken by the barrier-binding timestamp bug
 * (f510c91 fix for future; this repairs already-persisted data on load).
 *
 * Within each user-message-delimited turn segment, collect all assistant
 * events that carry a stable snapshotMessageId with a numeric tail sequence
 * number (e.g. `87f_000008` → seq 8). If any two within the same segment
 * have the same prefix and are out of order relative to their sequence
 * numbers, reorder them in-place (content slots are swapped so the event
 * objects retain their original array positions, only the stable content
 * moves to the correct sequence slot). Idempotent: correctly ordered
 * segments are untouched.
 *
 * Does NOT handle collaboration agentEvents — that must be done by the
 * caller if needed.
 */
export function repairStableAssistantOrder(events: TimelineEvent[]): TimelineEvent[] {
  // Find turn boundaries: user_message / steer_message.
  const turnBreaks: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === "user_message" || events[i].type === "steer_message") {
      turnBreaks.push(i);
    }
  }
  turnBreaks.push(events.length); // sentinel

  let result = events;
  let startIdx = 0;
  for (const endIdx of turnBreaks) {
    if (endIdx - startIdx < 2) { startIdx = endIdx; continue; }

    // Collect stable assistant positions and their seq numbers in this segment.
    const slots: Array<{ index: number; seq: number; prefix: string }> = [];
    for (let i = startIdx; i < endIdx; i++) {
      const event = result[i];
      if (event.type !== "assistant_message") continue;
      if (!event.snapshotMessageIdStable && !event.snapshotMessageId) continue;
      const seq = snapshotSeq(event.snapshotMessageId);
      if (seq === undefined) continue;
      // Extract prefix (everything before the final _<digits>).
      const lastUnderscore = event.snapshotMessageId!.lastIndexOf("_");
      const prefix = lastUnderscore > 0 ? event.snapshotMessageId!.slice(0, lastUnderscore) : "";
      slots.push({ index: i, seq, prefix });
    }

    if (slots.length < 2) { startIdx = endIdx; continue; }

    // Group by prefix — only events with the same prefix are from the same sequence.
    const byPrefix = new Map<string, typeof slots>();
    for (const slot of slots) {
      const group = byPrefix.get(slot.prefix) ?? [];
      group.push(slot);
      byPrefix.set(slot.prefix, group);
    }

    for (const [, group] of byPrefix) {
      if (group.length < 2) continue;

      // Check if already sorted.
      let sorted = true;
      for (let i = 1; i < group.length; i++) {
        if (group[i].seq < group[i - 1].seq) { sorted = false; break; }
      }
      if (sorted) continue;

      // Reorder: keep positions, swap event objects into correct seq order.
      // lowest seq → earliest position, highest seq → latest position.
      if (result === events) result = [...events];
      const originalOrder = [...group]; // sorted by position (ascending index)
      const sortedBySeq = [...group].sort((a, b) => a.seq - b.seq);
      const eventsToAssign = sortedBySeq.map((slot) => result[slot.index]);
      for (let i = 0; i < originalOrder.length; i++) {
        result[originalOrder[i].index] = eventsToAssign[i];
      }
    }

    startIdx = endIdx;
  }

  return result;
}

/**
 * 历史重放后对齐「已解决」的澄清提问。
 *
 * server 快照只在会话真处于 waiting_question 时重放 pending_questions 帧；
 * idle 会话（web 端已回答 / 提问已过期）的历史里残留的 question_request 没有
 * 「已解决」标记可覆盖。当会话当前并不在等待提问时，把历史中的 pending 澄清
 * 视为已解决（answered），避免显示成未回答的卡片。
 *
 * 仅当明确不在等待提问（isWaitingQuestion === false）时才 settle；状态未知
 * （undefined，如 getStatus 失败）时保守保留 pending，避免把真实等待中的
 * 提问误标成已解决导致用户无法回答。
 */
export function settleHistoricalQuestions(
  events: TimelineEvent[],
  options: { isWaitingQuestion?: boolean } = {},
): TimelineEvent[] {
  if (options.isWaitingQuestion !== false) return events;
  let changed = false;
  const settled = events.map((event) => {
    if (event.type !== "question_request" || event.status !== "pending") return event;
    changed = true;
    return { ...event, status: "answered" as const };
  });
  return changed ? settled : events;
}
