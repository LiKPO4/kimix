import type { LocalActiveContext } from "./persistence";
import type { Project } from "@/types/ui";
import { isSamePath } from "./pathCase";

type StartupSession = {
  projectPath: string;
};

export function selectStartupLocalSession<T extends StartupSession>(input: {
  activeContext: LocalActiveContext | null;
  activeContextSession?: T;
  latestLocalSession?: T;
}): T | undefined {
  if (input.activeContextSession) return input.activeContextSession;
  const hasSavedActiveContext = Boolean(input.activeContext?.sessionId || input.activeContext?.project);
  return hasSavedActiveContext ? undefined : input.latestLocalSession;
}

export function selectStartupProject(input: {
  activeContext: LocalActiveContext | null;
  activeLocalSession?: StartupSession;
  recentProjects: Project[];
  fallbackProject: Project;
}): Project {
  if (input.activeLocalSession) {
    return input.recentProjects.find((project) => isSamePath(project.path, input.activeLocalSession?.projectPath))
      ?? (input.activeContext?.project && isSamePath(input.activeContext.project.path, input.activeLocalSession.projectPath)
        ? input.activeContext.project
        : input.fallbackProject);
  }
  if (input.activeContext?.project) {
    return input.recentProjects.find((project) => isSamePath(project.path, input.activeContext?.project?.path))
      ?? input.activeContext.project;
  }
  return input.fallbackProject;
}
