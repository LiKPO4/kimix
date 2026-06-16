import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import type { Theme, ThemePaletteColors, ThemePaletteId, PermissionMode, StatusUpdateDisplay, NotificationMode, ClarificationToolMode, Project, KimiThemePreset } from "@/types/ui";
import { writeCachedThemeSnapshot } from "@/utils/themeSnapshot";

interface BootstrapSetters {
  setTheme: (theme: Theme) => void;
  setThemePalette: (palette: ThemePaletteId) => void;
  setCustomThemePalette: (colors: ThemePaletteColors) => void;
  setKimiThemePalettes: (presets: KimiThemePreset[]) => void;
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
          });
          setters.setTheme(res.data.theme);
          setters.setThemePalette(res.data.themePalette);
          setters.setCustomThemePalette(res.data.customThemePalette);
          setters.setKimiThemePalettes(res.data.kimiThemePalettes ?? []);
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
          setters.setFilePreviewExtensions(res.data.filePreviewExtensions ?? ["md", "txt"]);
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
