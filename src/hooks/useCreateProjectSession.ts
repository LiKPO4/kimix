import { useCallback } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, Session } from "@/types/ui";

const FALLBACK_KIMI_MODEL = "kimi-for-coding";

function projectNameFromPath(projectPath: string): string {
  return projectPath.split(/[\\/]/).filter(Boolean).at(-1) || "项目";
}

async function getDefaultKimiModel() {
  try {
    const res = await window.api.getKimiModelConfig();
    if (res.success) return res.data.defaultModel?.trim() || FALLBACK_KIMI_MODEL;
  } catch {
    // Ignore and use the official built-in default below.
  }
  return FALLBACK_KIMI_MODEL;
}

export function useCreateProjectSession() {
  const currentProject = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const creatingSessionProjectPath = useAppStore((s) => s.creatingSessionProjectPath);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setCreatingSessionProjectPath = useAppStore((s) => s.setCreatingSessionProjectPath);
  const addSession = useSessionStore((s) => s.addSession);

  const createSession = useCallback(async (projectOverride?: Project) => {
    const projectPath = projectOverride?.path ?? currentProject?.path ?? currentSession?.projectPath;
    if (!projectPath || useAppStore.getState().creatingSessionProjectPath) return;
    const project = projectOverride ?? currentProject ?? {
      id: crypto.randomUUID(),
      name: projectNameFromPath(projectPath),
      path: projectPath,
      lastOpenedAt: Date.now(),
    };
    setCreatingSessionProjectPath(project.path);
    try {
      const session: Session = {
        id: crypto.randomUUID(),
        engine: "kimi-code",
        model: await getDefaultKimiModel(),
        title: "新会话",
        projectPath: project.path,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        events: [],
        isLoading: false,
      };
      addSession(session);
      setCurrentProject(project);
      setCurrentSession(session);
    } finally {
      setCreatingSessionProjectPath(null);
    }
  }, [addSession, currentProject, currentSession?.projectPath, setCreatingSessionProjectPath, setCurrentProject, setCurrentSession]);

  return {
    createSession,
    creating: Boolean(creatingSessionProjectPath),
  };
}
