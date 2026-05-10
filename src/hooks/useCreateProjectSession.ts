import { useCallback } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project } from "@/types/ui";

function projectNameFromPath(projectPath: string): string {
  return projectPath.split(/[\\/]/).filter(Boolean).at(-1) || "项目";
}

export function useCreateProjectSession() {
  const currentProject = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const creatingSessionProjectPath = useAppStore((s) => s.creatingSessionProjectPath);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setCreatingSessionProjectPath = useAppStore((s) => s.setCreatingSessionProjectPath);
  const addSession = useSessionStore((s) => s.addSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);

  const createSession = useCallback(async (projectOverride?: Project) => {
    const projectPath = projectOverride?.path ?? currentProject?.path ?? currentSession?.projectPath;
    if (!projectPath || useAppStore.getState().creatingSessionProjectPath) return;
    const project = projectOverride ?? currentProject ?? {
      id: crypto.randomUUID(),
      name: projectNameFromPath(projectPath),
      path: projectPath,
      lastOpenedAt: Date.now(),
    };
    const previousSession = useAppStore.getState().currentSession;
    const placeholder = {
      id: `creating-${crypto.randomUUID()}`,
      title: "新对话",
      projectPath: project.path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      events: [],
      isLoading: true,
    };
    setCreatingSessionProjectPath(project.path);
    addSession(placeholder);
    setCurrentProject(project);
    setCurrentSession(placeholder);
    try {
      const sessionRes = await window.api.startSession({
        workDir: project.path,
        model: "kimi-code/kimi-for-coding",
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
      });
      if (!sessionRes.success) {
        deleteSession(placeholder.id);
        setCurrentSession(previousSession?.id === placeholder.id ? null : previousSession);
        return;
      }
      const session = {
        ...placeholder,
        id: sessionRes.data.sessionId,
        title: "新会话",
        updatedAt: Date.now(),
        isLoading: false,
      };
      updateSession(placeholder.id, () => session);
      setCurrentSession(session);
    } finally {
      setCreatingSessionProjectPath(null);
    }
  }, [addSession, currentProject, currentSession?.projectPath, defaultThinking, deleteSession, permissionMode, setCreatingSessionProjectPath, setCurrentProject, setCurrentSession, updateSession]);

  return {
    createSession,
    creating: Boolean(creatingSessionProjectPath),
  };
}
