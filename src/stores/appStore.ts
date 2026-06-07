import { create } from "zustand";
import type { AppState, Project, Session, PermissionMode, Theme, StatusUpdateDisplay, ClarificationToolMode, NotificationMode, ComposerDockCard, RightSidebarCardId, WorkspaceView } from "@/types/ui";

const RIGHT_SIDEBAR_CARD_ORDER_KEY = "kimix_right_sidebar_card_order";
const DEFAULT_RIGHT_SIDEBAR_CARD_ORDER: RightSidebarCardId[] = ["longTaskStatus", "background", "bigPlan", "rounds", "review", "confirmed", "hidden", "longTask", "kimi", "git", "goal", "btw", "plan", "session", "diffs"];

function readRightSidebarCardOrder(): RightSidebarCardId[] {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_RIGHT_SIDEBAR_CARD_ORDER;
    const parsed = JSON.parse(localStorage.getItem(RIGHT_SIDEBAR_CARD_ORDER_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return DEFAULT_RIGHT_SIDEBAR_CARD_ORDER;
    const known = new Set<RightSidebarCardId>(DEFAULT_RIGHT_SIDEBAR_CARD_ORDER);
    const filtered = parsed.filter((item): item is RightSidebarCardId => known.has(item));
    if (!filtered.includes("longTaskStatus")) {
      return [
        "longTaskStatus",
        ...filtered,
        ...DEFAULT_RIGHT_SIDEBAR_CARD_ORDER.filter((item) => item !== "longTaskStatus" && !filtered.includes(item)),
      ];
    }
    return [...filtered, ...DEFAULT_RIGHT_SIDEBAR_CARD_ORDER.filter((item) => !filtered.includes(item))];
  } catch {
    return DEFAULT_RIGHT_SIDEBAR_CARD_ORDER;
  }
}

function writeRightSidebarCardOrder(order: RightSidebarCardId[]) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(RIGHT_SIDEBAR_CARD_ORDER_KEY, JSON.stringify(order));
  } catch {
    // Ignore local persistence errors; the in-memory order still updates.
  }
}

export interface AppStore extends AppState {
  setCurrentProject: (project: Project | null) => void;
  setCurrentSession: (session: Session | null) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setIsRunning: (running: boolean) => void;
  setRunningSessionId: (sessionId: string | null) => void;
  setCreatingSessionProjectPath: (projectPath: string | null) => void;
  setDefaultThinking: (thinking: boolean) => void;
  setDefaultPlanMode: (enabled: boolean) => void;
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
  setRightSidebarCardOrder: (order: RightSidebarCardId[]) => void;
  setHandoffSessionId: (sessionId: string | null) => void;
  setWorkspaceView: (view: WorkspaceView) => void;
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
  rightSidebarCardOrder: readRightSidebarCardOrder(),
  handoffSessionId: null,
  workspaceView: "chat",
  sidebarOpen: true,
  theme: "light",
  settingsOpen: false,
  focusInputTrigger: 0,
  searchQuery: "",
  searchOpen: false,

  setCurrentProject: (project) => set({ currentProject: project }),
  setCurrentSession: (session) => set({ currentSession: session }),
  setPermissionMode: (mode) => set({ permissionMode: mode }),
  setIsRunning: (running) => set({ isRunning: running }),
  setRunningSessionId: (sessionId) => set({ runningSessionId: sessionId, isRunning: Boolean(sessionId) }),
  setCreatingSessionProjectPath: (projectPath) => set({ creatingSessionProjectPath: projectPath }),
  setDefaultThinking: (thinking) => set({ defaultThinking: thinking }),
  setDefaultPlanMode: (enabled) => set({ defaultPlanMode: enabled }),
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
  setRightSidebarCardOrder: (order) => {
    const known = new Set<RightSidebarCardId>(DEFAULT_RIGHT_SIDEBAR_CARD_ORDER);
    const normalized = [
      ...order.filter((item): item is RightSidebarCardId => known.has(item)),
      ...DEFAULT_RIGHT_SIDEBAR_CARD_ORDER.filter((item) => !order.includes(item)),
    ];
    writeRightSidebarCardOrder(normalized);
    set({ rightSidebarCardOrder: normalized });
  },
  setHandoffSessionId: (sessionId) => set({ handoffSessionId: sessionId }),
  setWorkspaceView: (view) => set({ workspaceView: view }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  triggerFocusInput: () => set({ focusInputTrigger: Date.now() }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setTheme: (theme) => set({ theme }),
}));
