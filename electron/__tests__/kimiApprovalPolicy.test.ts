import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hostSource = readFileSync(resolve(process.cwd(), "electron/kimiCodeHost.ts"), "utf8");

function sourceSection(start: string, end: string): string {
  const startIndex = hostSource.indexOf(start);
  const endIndex = hostSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return hostSource.slice(startIndex, endIndex);
}

describe("Kimi Code approval boundary", () => {
  it("surfaces Server approval requests even when the session profile is YOLO", () => {
    const branch = sourceSection(
      'if (frame.type === "event.approval.requested")',
      'if (frame.type === "event.question.requested")',
    );

    expect(branch).not.toContain('permission === "yolo"');
    expect(branch).not.toContain("resolveApproval(");
    expect(branch).toContain("serverApprovalIds.add");
    expect(branch).toContain('setStatus(sessionId, "waiting_approval")');
  });

  it("surfaces SDK approval callbacks instead of auto-approving the YOLO profile", () => {
    const handler = sourceSection(
      "function attachInteractionHandlers(session: KimiCodeSessionLike)",
      "session.setQuestionHandler?.",
    );

    expect(handler).not.toContain('permission === "yolo"');
    expect(handler).not.toContain('decision: "approved"');
    expect(handler).toContain("pendingApprovals.set");
    expect(handler).toContain('setStatus(session.id, "waiting_approval")');
  });
});
