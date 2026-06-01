import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import type { Theme, PermissionMode, StatusUpdateDisplay, NotificationMode, ClarificationToolMode, Project } from "@/types/ui";

interface BootstrapSetters {
  setTheme: (theme: Theme) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setDefaultThinking: (v: boolean) => void;
  setDefaultPlanMode: (v: boolean) => void;
  setAdditionalWorkDirs: (dirs: string[]) => void;
  setDetailedContext: (v: boolean) => void;
  setStatusUpdateDisplay: (v: StatusUpdateDisplay) => void;
  setSessionRecommendationEnabled: (v: boolean) => void;
  setSessionRecommendationTurnLimit: (v: number) => void;
  setVoiceShortcut: (v: string) => void;
  setNotificationMode: (v: NotificationMode) => void;
  setClarificationToolMode: (v: ClarificationToolMode) => void;
  setRecentProjects: (projects: Project[]) => void;
}

export function useBootstrap(setters: BootstrapSetters) {
  const settingsHydratedRef = useRef(false);

  useEffect(() => {
    if (!settingsHydratedRef.current) {
      settingsHydratedRef.current = true;
      window.api.getSettings().then((res) => {
        if (res.success) {
          setters.setTheme(res.data.theme);
          setters.setPermissionMode(res.data.defaultPermissionMode);
          setters.setDefaultThinking(res.data.defaultThinking);
          setters.setDefaultPlanMode(res.data.defaultPlanMode);
          setters.setAdditionalWorkDirs(res.data.additionalWorkDirs ?? []);
          setters.setDetailedContext(res.data.detailedContext);
          setters.setStatusUpdateDisplay(res.data.statusUpdateDisplay);
          setters.setSessionRecommendationEnabled(res.data.sessionRecommendationEnabled);
          setters.setSessionRecommendationTurnLimit(res.data.sessionRecommendationTurnLimit);
          setters.setVoiceShortcut(res.data.voiceShortcut);
          setters.setNotificationMode(res.data.notificationMode);
          setters.setClarificationToolMode(res.data.clarificationToolMode);
        }
      }).catch(() => {});
    }

    window.api.listRecentProjects().then((res) => {
      if (res.success) {
        setters.setRecentProjects(res.data);
        if (!useAppStore.getState().currentProject && res.data[0]) {
          useAppStore.setState({ currentProject: res.data[0] });
        }
      }
    }).catch(() => {});
  }, [setters]);
}
