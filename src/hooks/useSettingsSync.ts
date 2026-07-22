import { useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { writeCachedThemeSnapshot } from "@/utils/themeSnapshot";

export function useSettingsSync() {
  useEffect(() => {
    const unsub = useAppStore.subscribe((state, prev) => {
      if (
        state.theme !== prev.theme ||
        state.themePalette !== prev.themePalette ||
        state.customThemePalette !== prev.customThemePalette ||
        state.kimiThemePalettes !== prev.kimiThemePalettes ||
        state.permissionMode !== prev.permissionMode ||
        state.defaultThinking !== prev.defaultThinking ||
        state.defaultThinkingEffort !== prev.defaultThinkingEffort ||
        state.defaultPlanMode !== prev.defaultPlanMode ||
        state.fontSize !== prev.fontSize ||
        state.additionalWorkDirs !== prev.additionalWorkDirs ||
        state.detailedContext !== prev.detailedContext ||
        state.statusUpdateDisplay !== prev.statusUpdateDisplay ||
        state.sessionRecommendationEnabled !== prev.sessionRecommendationEnabled ||
        state.sessionRecommendationTurnLimit !== prev.sessionRecommendationTurnLimit ||
        state.voiceShortcut !== prev.voiceShortcut ||
        state.notificationMode !== prev.notificationMode ||
        state.filePreviewExtensions !== prev.filePreviewExtensions
      ) {
        writeCachedThemeSnapshot({
          theme: state.theme,
          themePalette: state.themePalette,
          customThemePalette: state.customThemePalette,
          kimiThemePalettes: state.kimiThemePalettes,
        });
        window.api.saveSettings({
          theme: state.theme,
          themePalette: state.themePalette,
          customThemePalette: state.customThemePalette,
          kimiThemePalettes: state.kimiThemePalettes,
          defaultPermissionMode: state.permissionMode,
          defaultThinking: state.defaultThinking,
          defaultThinkingEffort: state.defaultThinkingEffort,
          defaultPlanMode: state.defaultPlanMode,
          fontSize: state.fontSize,
          additionalWorkDirs: state.additionalWorkDirs,
          detailedContext: state.detailedContext,
          statusUpdateDisplay: state.statusUpdateDisplay,
          sessionRecommendationEnabled: state.sessionRecommendationEnabled,
          sessionRecommendationTurnLimit: state.sessionRecommendationTurnLimit,
          voiceShortcut: state.voiceShortcut,
          notificationMode: state.notificationMode,
          filePreviewExtensions: state.filePreviewExtensions,
        }).then((res) => {
          if (res && typeof res === "object" && (res as { success?: unknown }).success === false) {
            window.dispatchEvent(new CustomEvent("kimix:toast", {
              detail: `设置保存失败：${(res as { error?: string }).error || "未知错误"}`,
            }));
          }
        }).catch((err) => {
          console.warn("[SettingsSync] 设置保存失败，UI 状态与磁盘可能不一致:", err);
          window.dispatchEvent(new CustomEvent("kimix:toast", {
            detail: `设置保存失败：${err instanceof Error ? err.message : String(err)}`,
          }));
        });
      }
    });

    return () => {
      unsub();
    };
  }, []);
}
