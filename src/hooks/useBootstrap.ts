import { useEffect, useRef } from "react";
import type { Theme, ThemePaletteColors, ThemePaletteId, UiStyleId, PermissionMode, StatusUpdateDisplay, NotificationMode, Project, KimiThemePreset, ThinkingTranslationDisplayMode, ThinkingTranslationProvider } from "@/types/ui";
import type { UiStyleDocumentV1 } from "@/utils/uiStyleContract";
import { writeCachedThemeSnapshot } from "@/utils/themeSnapshot";

interface BootstrapSetters {
  setTheme: (theme: Theme) => void;
  setUiStyle: (id: UiStyleId) => void;
  setCustomUiStyles: (documents: UiStyleDocumentV1[]) => void;
  setThemePalette: (palette: ThemePaletteId) => void;
  setCustomThemePalette: (colors: ThemePaletteColors) => void;
  setKimiThemePalettes: (presets: KimiThemePreset[]) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setDefaultThinking: (v: boolean) => void;
  setDefaultThinkingEffort: (v: string) => void;
  setDefaultPlanMode: (v: boolean) => void;
  setFontSize: (v: number) => void;
  setChatNavigationRailEnabled: (v: boolean) => void;
  setChatNavigationRailSide: (v: "left" | "right") => void;
  setChatNavigationRailWidth: (v: number) => void;
  setAdditionalWorkDirs: (dirs: string[]) => void;
  setDetailedContext: (v: boolean) => void;
  setStatusUpdateDisplay: (v: StatusUpdateDisplay) => void;
  setSessionRecommendationEnabled: (v: boolean) => void;
  setSessionRecommendationTurnLimit: (v: number) => void;
  setVoiceShortcut: (v: string) => void;
  setNotificationMode: (v: NotificationMode) => void;
  setThinkingTranslationProvider: (v: ThinkingTranslationProvider) => void;
  setThinkingTranslationIntervalMs: (v: number) => void;
  setThinkingTranslationDisplayMode: (v: ThinkingTranslationDisplayMode) => void;
  setFilePreviewExtensions: (v: string[]) => void;
  setRecentProjects: (projects: Project[]) => void;
}

export function useBootstrap(setters: BootstrapSetters) {
  const settingsHydratedRef = useRef(false);

  useEffect(() => {
    if (!settingsHydratedRef.current) {
      settingsHydratedRef.current = true;
      window.api.getSettings().then((res) => {
        if (res.success) {
          writeCachedThemeSnapshot({
            theme: res.data.theme,
            themePalette: res.data.themePalette,
            customThemePalette: res.data.customThemePalette,
            kimiThemePalettes: res.data.kimiThemePalettes ?? [],
            uiStyle: res.data.uiStyle,
            customUiStyles: res.data.customUiStyles ?? [],
          });
          setters.setTheme(res.data.theme);
          setters.setCustomUiStyles(res.data.customUiStyles ?? []);
          setters.setUiStyle(res.data.uiStyle);
          setters.setThemePalette(res.data.themePalette);
          setters.setCustomThemePalette(res.data.customThemePalette);
          setters.setKimiThemePalettes(res.data.kimiThemePalettes ?? []);
          setters.setPermissionMode(res.data.defaultPermissionMode);
          setters.setDefaultThinkingEffort(res.data.defaultThinkingEffort ?? (res.data.defaultThinking ? "on" : "off"));
          setters.setDefaultPlanMode(res.data.defaultPlanMode);
          setters.setFontSize(res.data.fontSize);
          setters.setChatNavigationRailEnabled(res.data.chatNavigationRailEnabled);
          setters.setChatNavigationRailSide(res.data.chatNavigationRailSide);
          setters.setChatNavigationRailWidth(res.data.chatNavigationRailWidth);
          setters.setAdditionalWorkDirs(res.data.additionalWorkDirs ?? []);
          setters.setDetailedContext(res.data.detailedContext);
          setters.setStatusUpdateDisplay(res.data.statusUpdateDisplay);
          setters.setSessionRecommendationEnabled(res.data.sessionRecommendationEnabled);
          setters.setSessionRecommendationTurnLimit(res.data.sessionRecommendationTurnLimit);
          setters.setVoiceShortcut(res.data.voiceShortcut);
          setters.setNotificationMode(res.data.notificationMode);
          setters.setFilePreviewExtensions(res.data.filePreviewExtensions ?? ["md", "txt"]);
          setters.setThinkingTranslationProvider(res.data.thinkingTranslationProvider ?? (res.data.thinkingTranslationEnabled ? "azure" : "off"));
          setters.setThinkingTranslationIntervalMs(res.data.thinkingTranslationIntervalMs ?? 2500);
          setters.setThinkingTranslationDisplayMode(res.data.thinkingTranslationDisplayMode ?? "translated");
        } else {
          console.warn("[useBootstrap] getSettings failed:", res.error);
        }
      }).catch((err) => {
        console.warn("[useBootstrap] getSettings threw:", err);
      });
    }

    window.api.listRecentProjects().then((res) => {
      if (res.success) {
        setters.setRecentProjects(res.data);
      } else {
        console.warn("[useBootstrap] listRecentProjects failed:", res.error);
      }
    }).catch((err) => {
      console.warn("[useBootstrap] listRecentProjects threw:", err);
    });
  }, [setters]);
}
