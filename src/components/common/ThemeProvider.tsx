import { useEffect } from "react";
import { useAppStore } from "@/stores/appStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      };
      document.documentElement.setAttribute("data-theme", mq.matches ? "dark" : "light");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme]);

  return <>{children}</>;
}
