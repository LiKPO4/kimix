import { useLayoutEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { applyThemeSnapshot } from "@/utils/themeSnapshot";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useAppStore((s) => s.theme);
  const themePalette = useAppStore((s) => s.themePalette);
  const customThemePalette = useAppStore((s) => s.customThemePalette);
  const kimiThemePalettes = useAppStore((s) => s.kimiThemePalettes);

  useLayoutEffect(() => {
    const applyMode = (mode: "light" | "dark") => {
      applyThemeSnapshot({ theme: mode, themePalette, customThemePalette, kimiThemePalettes });
    };

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        applyMode(e.matches ? "dark" : "light");
      };
      applyMode(mq.matches ? "dark" : "light");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      applyMode(theme);
    }
  }, [theme, themePalette, customThemePalette, kimiThemePalettes]);

  return <>{children}</>;
}
