import { create } from "zustand";
import type { AppState, Project, Session, PermissionMode, Theme, StatusUpdateDisplay, ClarificationToolMode, NotificationMode, ComposerDockCard } from "@/types/ui";

interface AppStore extends AppState {
  setCurrentProject: (project: Project | null) => void;
  setCurrentSession: (session: Session | null) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setIsRunning: (running: boolean) => void;
  setRunningSessionId: (sessionId: string | null) => void;
  setCreatingSessionProjectPath: (projectPath: string | null) => void;
  setDefaultThinking: (thinking: boolean) => void;
  setDefaultPlanMode: (enabled: boolean) => void;
  setDefaultAfkMode: (enabled: boolean) => void;
  setAdditionalWorkDirs: (dirs: string[]) => void;
  setDetailedContext: (enabled: boolean) => void;
  setStatusUpdateDisplay: (display: StatusUpdateDisplay) => void;
  setSessionRecommendationEnabled: (enabled: boolean) => void;
  setSessionRecommendationTurnLimit: (limit: number) => void;
  setVoiceShortcut: (shortcut: string) => void;
  setNotificationMode: (mode: NotificationMode) => void;
  setClarificationToolMode: (mode: ClarificationToolMode) => void;
  setLongTasksOpen: (open: boolean) => void;
  setLongTaskInspectorOpen: (open: boolean) => void;
  setDiffPanelOpen: (open: boolean) => void;
  setComposerCardHidden: (sessionId: string, card: ComposerDockCard, hidden: boolean) => void;
  setHandoffSessionId: (sessionId: string | null) => void;
  toggleSidebar: () => void;
  setTheme: (theme: Theme) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  focusInputTrigger: number;
  triggerFocusInput: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  skillsOpen: boolean;
  setSkillsOpen: (open: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  currentProject: null,
  currentSession: null,
  permissionMode: "manual",
  isRunning: false,
  runningSessionId: null,
  creatingSessionProjectPath: null,
  defaultThinking: true,
  defaultPlanMode: false,
  defaultAfkMode: false,
  additionalWorkDirs: [],
  detailedContext: false,
  statusUpdateDisplay: "turn_end",
  sessionRecommendationEnabled: true,
  sessionRecommendationTurnLimit: 10,
  voiceShortcut: "Win+H",
  notificationMode: "unfocused",
  clarificationToolMode: "auto",
  longTasksOpen: false,
  longTaskInspectorOpen: false,
  diffPanelOpen: false,
  hiddenComposerCards: {},
  handoffSessionId: null,
  sidebarOpen: true,
  theme: "light",
  settingsOpen: false,
  focusInputTrigger: 0,
  searchQuery: "",
  searchOpen: false,
  skillsOpen: false,

  setCurrentProject: (project) => set({ currentProject: project }),
  setCurrentSession: (session) => set({ currentSession: session }),
  setPermissionMode: (mode) => set({ permissionMode: mode }),
  setIsRunning: (running) => set({ isRunning: running }),
  setRunningSessionId: (sessionId) => set({ runningSessionId: sessionId, isRunning: Boolean(sessionId) }),
  setCreatingSessionProjectPath: (projectPath) => set({ creatingSessionProjectPath: projectPath }),
  setDefaultThinking: (thinking) => set({ defaultThinking: thinking }),
  setDefaultPlanMode: (enabled) => set({ defaultPlanMode: enabled }),
  setDefaultAfkMode: (enabled) => set({ defaultAfkMode: enabled }),
  setAdditionalWorkDirs: (dirs) => set({ additionalWorkDirs: dirs }),
  setDetailedContext: (enabled) => set({ detailedContext: enabled }),
  setStatusUpdateDisplay: (display) => set({ statusUpdateDisplay: display }),
  setSessionRecommendationEnabled: (enabled) => set({ sessionRecommendationEnabled: enabled }),
  setSessionRecommendationTurnLimit: (limit) => set({ sessionRecommendationTurnLimit: Math.max(1, Math.min(200, Math.round(limit))) }),
  setVoiceShortcut: (shortcut) => set({ voiceShortcut: shortcut.trim() || "Win+H" }),
  setNotificationMode: (mode) => set({ notificationMode: mode }),
  setClarificationToolMode: (mode) => set({ clarificationToolMode: mode }),
  setLongTasksOpen: (open) => set({ longTasksOpen: open }),
  setLongTaskInspectorOpen: (open) => set({ longTaskInspectorOpen: open }),
  setDiffPanelOpen: (open) => set({ diffPanelOpen: open }),
  setComposerCardHidden: (sessionId, card, hidden) => set((state) => {
    const current = state.hiddenComposerCards[sessionId] ?? [];
    const next = hidden
      ? Array.from(new Set([...current, card]))
      : current.filter((item) => item !== card);
    return {
      hiddenComposerCards: {
        ...state.hiddenComposerCards,
        [sessionId]: next,
      },
    };
  }),
  setHandoffSessionId: (sessionId) => set({ handoffSessionId: sessionId }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  triggerFocusInput: () => set({ focusInputTrigger: Date.now() }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setSkillsOpen: (open) => set({ skillsOpen: open }),
  setTheme: (theme) => set({ theme }),
}));
