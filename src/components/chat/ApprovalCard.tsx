import { AlertTriangle, Check, Copy, Expand, FileText, GitCompare, ShieldCheck, Wrench, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";
import { getRuntimeSessionId } from "@/utils/runtimeSession";

type ApprovalDiffPreview = {
  path: string;
  oldText?: string;
  newText?: string;
  additions?: number;
  deletions?: number;
};

interface ApprovalCardProps {
  event: Extract<TimelineEvent, { type: "approval_request" }>;
  diffPreviews?: ApprovalDiffPreview[];
}

type ApprovalSummary = {
  paths: string[];
  actionSummary: string;
  prettyDetails: string;
};

const PATH_KEYS = new Set(["file", "file_path", "filepath", "path", "target", "target_file", "target_path"]);

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function collectPaths(value: unknown, paths: string[] = []) {
  if (!value || typeof value !== "object") return paths;
  if (Array.isArray(value)) {
    value.forEach((item) => collectPaths(item, paths));
    return paths;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    const normalizedKey = key.toLowerCase();
    if (typeof item === "string" && (PATH_KEYS.has(normalizedKey) || normalizedKey.endsWith("path"))) {
      paths.push(item);
    } else if (item && typeof item === "object") {
      collectPaths(item, paths);
    }
  });
  return paths;
}

function parseApprovalSummary(event: Extract<TimelineEvent, { type: "approval_request" }>): ApprovalSummary {
  const raw = event.details.trim();
  const paths: string[] = [];
  let actionSummary = event.description;
  let prettyDetails = event.details;

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      collectPaths(parsed, paths);
      prettyDetails = JSON.stringify(parsed, null, 2);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const command = typeof record.command === "string" ? record.command : undefined;
        const action = typeof record.action === "string" ? record.action : undefined;
        const tool = typeof record.tool === "string" ? record.tool : undefined;
        actionSummary = command ?? action ?? tool ?? actionSummary;
      }
    } catch {
      const quotedPaths = raw.match(/(?:[A-Za-z]:\\|\.\.\\|\.\\|[\w.-]+[\\/])[^\s"'`]+/g) ?? [];
      paths.push(...quotedPaths.map((path) => path.replace(/[),.;:]+$/, "")));
      const firstLine = raw.split(/\r?\n/).find((line) => line.trim());
      if (firstLine) actionSummary = firstLine.trim().slice(0, 140);
    }
  }

  return {
    paths: uniqueValues(paths).slice(0, 6),
    actionSummary,
    prettyDetails,
  };
}

function riskLabel(riskLevel: "low" | "medium" | "high") {
  if (riskLevel === "high") return "高风险";
  if (riskLevel === "low") return "低风险";
  return "中风险";
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").toLowerCase();
}

function countChangedLines(oldText = "", newText = "") {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  let additions = 0;
  let deletions = 0;
  const max = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < max; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine) continue;
    if (newLine !== undefined) additions += 1;
    if (oldLine !== undefined) deletions += 1;
  }
  return { additions, deletions };
}

function buildUnifiedPreview(oldText = "", newText = "") {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const rows: { kind: "same" | "added" | "removed"; text: string }[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < max && rows.length < 18; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine) {
      rows.push({ kind: "same", text: oldLine ?? "" });
      continue;
    }
    if (oldLine !== undefined) rows.push({ kind: "removed", text: oldLine });
    if (newLine !== undefined) rows.push({ kind: "added", text: newLine });
  }
  return rows;
}

export function ApprovalCard({ event, diffPreviews = [] }: ApprovalCardProps) {
  const currentSession = useAppStore((s) => s.currentSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const summary = useMemo(() => parseApprovalSummary(event), [event]);
  const relatedDiffs = useMemo(() => {
    const summaryPaths = new Set(summary.paths.map((path) => normalizePath(path)));
    const filtered = summaryPaths.size > 0
      ? diffPreviews.filter((diff) => {
          const normalized = normalizePath(diff.path);
          return summaryPaths.has(normalized) || Array.from(summaryPaths).some((path) => path.endsWith(`/${normalized}`) || normalized.endsWith(`/${path}`));
        })
      : diffPreviews;
    return filtered.slice(0, 2).map((diff) => {
      const counted = countChangedLines(diff.oldText, diff.newText);
      return {
        ...diff,
        additions: diff.additions ?? counted.additions,
        deletions: diff.deletions ?? counted.deletions,
        lines: buildUnifiedPreview(diff.oldText, diff.newText),
      };
    });
  }, [diffPreviews, summary.paths]);

  const handleApprove = async (scope?: "once" | "session") => {
    if (!currentSession) return;
    const runtimeSessionId = getRuntimeSessionId(currentSession);
    if (!runtimeSessionId) return;
    try {
      await window.api.respondKimiCodeApproval({
        sessionId: runtimeSessionId,
        requestId: event.requestId,
        approved: true,
        scope,
      });
      updateSession(currentSession.id, (session) => ({
        ...session,
        events: session.events.map((e) =>
          e.id === event.id && e.type === "approval_request"
            ? { ...e, status: "approved" as const }
            : e
        ),
      }));
    } catch (err) {
      console.error("Approve failed:", err);
    }
  };

  const handleReject = async () => {
    if (!currentSession) return;
    const runtimeSessionId = getRuntimeSessionId(currentSession);
    if (!runtimeSessionId) return;
    try {
      await window.api.respondKimiCodeApproval({
        sessionId: runtimeSessionId,
        requestId: event.requestId,
        approved: false,
      });
      updateSession(currentSession.id, (session) => ({
        ...session,
        events: session.events.map((e) =>
          e.id === event.id && e.type === "approval_request"
            ? { ...e, status: "rejected" as const }
            : e
        ),
      }));
    } catch (err) {
      console.error("Reject failed:", err);
    }
  };

  const isPending = event.status === "pending";
  const detailPreview = summary.prettyDetails.trim();

  return (
    <div id={`kimix-approval-${event.id}`} className="flex justify-center">
      <div
        className="max-w-[90%] w-full rounded-2xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)] shadow-[0_10px_28px_rgba(15,23,42,0.06)]"
        style={{ padding: "14px 18px 16px" }}
      >
        <div className="flex items-center text-sm font-medium text-text-primary" style={{ gap: 10 }}>
          <AlertTriangle size={16} className="text-accent-orange shrink-0" />
          <span className="min-w-0 break-words">工具请求: {event.description}</span>
        </div>

        <div
          className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]"
          style={{ marginTop: 12, padding: "12px 14px" }}
        >
          <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "start" }}>
            <div className="min-w-0">
              <div className="flex items-center text-xs text-text-muted" style={{ gap: 8 }}>
                <Wrench size={14} className="shrink-0" />
                <span className="truncate">{event.toolName}</span>
              </div>
              <div className="text-sm text-text-primary break-words" style={{ marginTop: 8 }}>
                {summary.actionSummary}
              </div>
            </div>
            <span
              className="rounded-full border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)] text-xs text-text-secondary"
              style={{ padding: "4px 10px", lineHeight: "18px" }}
            >
              {riskLabel(event.riskLevel)}
            </span>
          </div>

          {summary.paths.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="flex items-center text-xs text-text-muted" style={{ gap: 8 }}>
                <FileText size={14} className="shrink-0" />
                <span>涉及文件</span>
              </div>
              <div className="flex flex-col" style={{ gap: 8, marginTop: 8 }}>
                {summary.paths.map((path) => (
                  <code
                    key={path}
                    className="rounded-lg border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)] text-xs text-text-secondary break-all"
                    style={{ padding: "7px 10px" }}
                  >
                    {path}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>

        {relatedDiffs.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="flex items-center text-xs text-text-muted" style={{ gap: 8 }}>
              <GitCompare size={14} className="shrink-0" />
              <span>Diff 预览</span>
            </div>
            <div className="flex flex-col" style={{ gap: 10, marginTop: 8 }}>
              {relatedDiffs.map((diff) => (
                <div
                  key={diff.path}
                  className="overflow-hidden rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]"
                >
                  <div className="grid items-center border-b border-[var(--kimix-panel-divider)]" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, padding: "9px 12px" }}>
                    <code className="min-w-0 truncate text-xs text-text-secondary">{diff.path}</code>
                    <span className="shrink-0 text-xs">
                      <span className="text-accent-green">+{diff.additions ?? 0}</span>
                      <span className="text-text-muted" style={{ marginLeft: 7, marginRight: 7 }}>/</span>
                      <span className="text-accent-red">-{diff.deletions ?? 0}</span>
                    </span>
                  </div>
                  <div className="max-h-44 overflow-auto" style={{ paddingTop: 6, paddingBottom: 6 }}>
                    {diff.lines.map((line, index) => (
                      <div
                        key={`${diff.path}-${index}`}
                        className="grid font-mono text-[12px] leading-5"
                        style={{
                          gridTemplateColumns: "24px minmax(0, 1fr)",
                          paddingLeft: 10,
                          paddingRight: 12,
                          backgroundColor: line.kind === "added" ? "var(--accent-success-light)" : line.kind === "removed" ? "var(--accent-danger-light)" : "transparent",
                          color: line.kind === "added" ? "var(--accent-success)" : line.kind === "removed" ? "var(--accent-danger)" : "var(--text-secondary)",
                        }}
                      >
                        <span className="select-none text-text-muted">{line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}</span>
                        <span className="min-w-0 whitespace-pre-wrap break-words">{line.text || " "}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {detailPreview && (
          <div style={{ marginTop: 12 }}>
            <div className="flex items-center justify-between" style={{ gap: 12 }}>
              <span className="text-xs text-text-muted">审批详情</span>
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="kimix-icon-text-button text-text-secondary hover:bg-[var(--kimix-panel-hover)]"
                style={{ minHeight: 32, paddingLeft: 12, paddingRight: 12 }}
              >
                <Expand size={14} />
                <span>全屏查看</span>
              </button>
            </div>
            <pre
              className="text-xs text-text-secondary bg-[var(--kimix-panel-bg)] rounded-xl overflow-x-hidden border border-[var(--kimix-panel-border-soft)] font-mono leading-relaxed"
              style={{ marginTop: 8, maxHeight: 180, padding: "12px 14px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {detailPreview}
            </pre>
          </div>
        )}

        {isPending ? (
          <div className="flex flex-wrap" style={{ gap: 10, marginTop: 14 }}>
            <button
              onClick={() => handleApprove("once")}
              className="kimix-icon-text-button kimix-success-action text-sm"
            >
              <Check size={14} />
              <span>允许一次</span>
            </button>
            <button
              onClick={() => handleApprove("session")}
              className="kimix-icon-text-button bg-accent-primary text-text-inverse text-sm hover:bg-accent-primary-dark"
            >
              <ShieldCheck size={14} />
              <span>本会话允许</span>
            </button>
            <button
              onClick={handleReject}
              className="kimix-icon-text-button bg-bg-hover text-text-primary text-sm hover:bg-bg-tertiary"
            >
              <X size={14} />
              <span>拒绝</span>
            </button>
          </div>
        ) : (
          <div className="text-sm text-text-muted" style={{ marginTop: 12 }}>
            {event.status === "approved" ? (
              <span className="flex items-center text-accent-green" style={{ gap: 6 }}>
                <Check size={14} /> 已批准
              </span>
            ) : (
              <span className="flex items-center text-accent-red" style={{ gap: 6 }}>
                <X size={14} /> 已拒绝
              </span>
            )}
          </div>
        )}
      </div>

      {detailsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px]"
          style={{ padding: 24 }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="flex max-h-[88vh] w-full max-w-5xl flex-col rounded-2xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)] shadow-floating-token"
            style={{ padding: 20 }}
          >
            <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14, alignItems: "center" }}>
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-primary">审批详情</div>
                <div className="text-xs text-text-muted truncate" style={{ marginTop: 6 }}>
                  {event.toolName} · {riskLabel(event.riskLevel)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
                className="kimix-icon-text-button text-text-secondary hover:bg-[var(--kimix-panel-hover)]"
                style={{ minHeight: 32, paddingLeft: 12, paddingRight: 12 }}
              >
                <X size={14} />
                <span>关闭</span>
              </button>
            </div>

            {summary.paths.length > 0 && (
              <div className="flex flex-wrap" style={{ gap: 8, marginTop: 14 }}>
                {summary.paths.map((path) => (
                  <code
                    key={`modal-${path}`}
                    className="rounded-lg border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)] text-xs text-text-secondary break-all"
                    style={{ padding: "7px 10px" }}
                  >
                    {path}
                  </code>
                ))}
              </div>
            )}

            <pre
              className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)] font-mono text-xs leading-relaxed text-text-secondary"
              style={{ marginTop: 14, padding: "14px 16px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {detailPreview}
            </pre>

            <div className="flex justify-end" style={{ gap: 10, marginTop: 14 }}>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(detailPreview)}
                className="kimix-icon-text-button text-text-secondary hover:bg-[var(--kimix-panel-hover)]"
                style={{ minHeight: 32, paddingLeft: 12, paddingRight: 12 }}
              >
                <Copy size={14} />
                <span>复制详情</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
