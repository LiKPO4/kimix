import { describe, expect, it } from "vitest";
import type { LocalActiveContext } from "../persistence";
import { selectStartupLocalSession, selectStartupProject } from "../startupContext";
import type { Project, Session } from "@/types/ui";

const projectA: Project = { id: "project-a", name: "A", path: "D:/A", lastOpenedAt: 100 };
const projectB: Project = { id: "project-b", name: "B", path: "D:/B", lastOpenedAt: 200 };
const sessionA = { id: "session-a", projectPath: projectA.path } as Session;
const sessionB = { id: "session-b", projectPath: projectB.path } as Session;

function activeContext(project: Project | null, sessionId: string | null): LocalActiveContext {
  return { project, sessionId, updatedAt: 300 };
}

describe("startup context selection", () => {
  it("restores the saved session instead of the latest local session", () => {
    expect(selectStartupLocalSession({
      activeContext: activeContext(projectA, sessionA.id),
      activeContextSession: sessionA,
      latestLocalSession: sessionB,
    })).toBe(sessionA);
  });

  it("keeps the saved project empty instead of opening another project's latest session", () => {
    const context = activeContext(projectA, null);
    const session = selectStartupLocalSession({
      activeContext: context,
      latestLocalSession: sessionB,
    });

    expect(session).toBeUndefined();
    expect(selectStartupProject({
      activeContext: context,
      activeLocalSession: session,
      recentProjects: [projectB, projectA],
      fallbackProject: projectB,
    })).toBe(projectA);
  });

  it("does not replace a stale saved context with an unrelated latest session", () => {
    const context = activeContext(projectA, "missing-session");

    expect(selectStartupLocalSession({
      activeContext: context,
      latestLocalSession: sessionB,
    })).toBeUndefined();
  });

  it("uses the latest local session only when no saved context exists", () => {
    const session = selectStartupLocalSession({
      activeContext: null,
      latestLocalSession: sessionB,
    });

    expect(session).toBe(sessionB);
    expect(selectStartupProject({
      activeContext: null,
      activeLocalSession: session,
      recentProjects: [projectA, projectB],
      fallbackProject: projectA,
    })).toBe(projectB);
  });
});
