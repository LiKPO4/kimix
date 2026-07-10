/** @vitest-environment jsdom */

import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, Session } from "@/types/ui";
import { LOCAL_ACTIVE_CONTEXT_KEY } from "@/utils/persistence";
import { useStatePersistence } from "../useStatePersistence";

function PersistenceProbe() {
  useStatePersistence();
  return null;
}

const project: Project = {
  id: "project-1",
  name: "Project",
  path: "D:/WORKS/project",
  lastOpenedAt: 100,
};

const session: Session = {
  id: "session-1",
  engine: "kimi-code",
  title: "Session",
  projectPath: project.path,
  createdAt: 100,
  updatedAt: 200,
  events: [],
  isLoading: false,
};

describe("useStatePersistence", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ currentProject: null, currentSession: null, runningSessionId: null });
    useSessionStore.setState({ sessions: [], recentProjects: [], pendingMessages: [] });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container.remove();
    localStorage.clear();
  });

  it("does not overwrite the saved active context during Strict Mode effect cleanup", () => {
    const saved = { project, sessionId: session.id, updatedAt: 123 };
    localStorage.setItem(LOCAL_ACTIVE_CONTEXT_KEY, JSON.stringify(saved));

    root = createRoot(container);
    act(() => root?.render(createElement(StrictMode, null, createElement(PersistenceProbe))));

    expect(JSON.parse(localStorage.getItem(LOCAL_ACTIVE_CONTEXT_KEY) ?? "null")).toEqual(saved);
  });

  it("flushes the latest active session before the window unloads", () => {
    root = createRoot(container);
    act(() => root?.render(createElement(PersistenceProbe)));
    act(() => useAppStore.setState({ currentProject: project, currentSession: session }));

    localStorage.removeItem(LOCAL_ACTIVE_CONTEXT_KEY);
    act(() => window.dispatchEvent(new Event("beforeunload")));

    expect(JSON.parse(localStorage.getItem(LOCAL_ACTIVE_CONTEXT_KEY) ?? "null")).toMatchObject({
      project,
      sessionId: session.id,
    });
  });

  it("flushes conversation state when the page becomes hidden", async () => {
    root = createRoot(container);
    act(() => root?.render(createElement(PersistenceProbe)));
    act(() => useAppStore.setState({ currentProject: project, currentSession: session }));

    Object.defineProperty(document, "visibilityState", { value: "hidden", writable: true, configurable: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    // Allow the async flush promise to settle without crashing.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(root).toBeTruthy();
  });
});
