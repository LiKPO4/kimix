import { useEffect } from "react";
import { useAppStore } from "@/stores/appStore";

export function useSettingsSync() {
  useEffect(() => {
    const unsub = useAppStore.subscribe((state, prev) => {
      if (
        state.theme !== prev.theme ||
        state.permissionMode !== prev.permissionMode ||
        state.defaultThinking !== prev.defaultThinking ||
        state.defaultPlanMode !== prev.defaultPlanMode ||
        state.defaultAfkMode !== prev.defaultAfkMode ||
        state.additionalWorkDirs !== prev.additionalWorkDirs ||
        state.detailedContext !== prev.detailedContext ||
        state.statusUpdateDisplay !== prev.statusUpdateDisplay ||
        state.sessionRecommendationEnabled !== prev.sessionRecommendationEnabled ||
        state.sessionRecommendationTurnLimit !== prev.sessionRecommendationTurnLimit ||
        state.voiceShortcut !== prev.voiceShortcut ||
        state.notificationMode !== prev.notificationMode ||
        state.clarificationToolMode !== prev.clarificationToolMode
      ) {
        window.api.saveSettings({
          theme: state.theme,
          defaultPermissionMode: state.permissionMode,
          defaultThinking: state.defaultThinking,
          defaultPlanMode: state.defaultPlanMode,
          defaultAfkMode: state.defaultAfkMode,
          additionalWorkDirs: state.additionalWorkDirs,
          detailedContext: state.detailedContext,
          statusUpdateDisplay: state.statusUpdateDisplay,
          sessionRecommendationEnabled: state.sessionRecommendationEnabled,
          sessionRecommendationTurnLimit: state.sessionRecommendationTurnLimit,
          voiceShortcut: state.voiceShortcut,
          notificationMode: state.notificationMode,
          clarificationToolMode: state.clarificationToolMode,
        }).catch(() => {});
      }
    });

    return () => {
      unsub();
    };
  }, []);
}
