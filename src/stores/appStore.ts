import { create } from "zustand";
import type { AppState, Project, Session, PermissionMode, Theme } from "@/types/ui";

interface AppStore extends AppState {
  setCurrentProject: (project: Project | null) => void;
  setCurrentSession: (session: Session | null) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setIsRunning: (running: boolean) => void;
  setRunningSessionId: (sessionId: string | null) => void;
  setDefaultThinking: (thinking: boolean) => void;
  setDetailedContext: (enabled: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (theme: Theme) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  focusInputTrigger: number;
  triggerFocusInput: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  currentProject: null,
  currentSession: null,
  permissionMode: "manual",
  isRunning: false,
  runningSessionId: null,
  defaultThinking: true,
  detailedContext: false,
  sidebarOpen: true,
  theme: "light",
  settingsOpen: false,
  focusInputTrigger: 0,
  searchQuery: "",

  setCurrentProject: (project) => set({ currentProject: project }),
  setCurrentSession: (session) => set({ currentSession: session }),
  setPermissionMode: (mode) => set({ permissionMode: mode }),
  setIsRunning: (running) => set({ isRunning: running }),
  setRunningSessionId: (sessionId) => set({ runningSessionId: sessionId, isRunning: Boolean(sessionId) }),
  setDefaultThinking: (thinking) => set({ defaultThinking: thinking }),
  setDetailedContext: (enabled) => set({ detailedContext: enabled }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  triggerFocusInput: () => set({ focusInputTrigger: Date.now() }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setTheme: (theme) => set({ theme }),
}));
