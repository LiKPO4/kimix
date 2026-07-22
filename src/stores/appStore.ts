import { create } from "zustand";
import type { AppState, Project, Session, PermissionMode, Theme, ThemePaletteColors, ThemePaletteId, StatusUpdateDisplay, NotificationMode, ComposerDockCard, RightSidebarCardId, WorkspaceView, KimiThemePreset, ProcessDisplayMode, RoomAgentActivity } from "@/types/ui";
import { DEFAULT_THEME_PALETTE_ID, kimiThemePaletteId, normalizeKimiThemePresets, normalizeThemePaletteColors, normalizeThemePaletteId, upsertKimiThemePresets } from "@/utils/themePalettes";
import { readCachedThemeSnapshot } from "@/utils/themeSnapshot";
import { roomAgentActivityKey } from "@/utils/collaborationRooms";

const RIGHT_SIDEBAR_CARD_ORDER_KEY = "kimix_right_sidebar_card_order";
const DEFAULT_RIGHT_SIDEBAR_CARD_ORDER: RightSidebarCardId[] = ["longTaskStatus", "background", "bigPlan", "rounds", "review", "confirmed", "hidden", "longTask", "kimi", "subagent", "git", "goal", "btw", "plan", "serverTree", "session", "diffs"];
const PROCESS_DISPLAY_MODE_KEY = "kimix_process_display_mode";
const COLLAPSE_PROCESS_WHILE_RUNNING_KEY = "kimix_collapse_process_while_running";

function placeNewSubagentCard(order: RightSidebarCardId[], source: readonly RightSidebarCardId[]) {
  if (source.includes("subagent")) return order;
  const withoutSubagent: RightSidebarCardId[] = order.filter((item) => item !== "subagent");
  const kimiIndex = withoutSubagent.indexOf("kimi");
  withoutSubagent.splice(kimiIndex >= 0 ? kimiIndex + 1 : 0, 0, "subagent");
  return withoutSubagent;
}

function readCollapseProcessWhileRunning(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(COLLAPSE_PROCESS_WHILE_RUNNING_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeCollapseProcessWhileRunning(enabled: boolean) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(COLLAPSE_PROCESS_WHILE_RUNNING_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore local persistence errors; the in-memory value still updates.
  }
}

function readProcessDisplayMode(): ProcessDisplayMode {
  try {
    if (typeof localStorage === "undefined") return "kimix";
    const raw = localStorage.getItem(PROCESS_DISPLAY_MODE_KEY);
    if (raw === "kimix" || raw === "kimi-web") return raw;
    return "kimix";
  } catch {
    return "kimix";
  }
}

function writeProcessDisplayMode(mode: ProcessDisplayMode) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(PROCESS_DISPLAY_MODE_KEY, mode);
  } catch {
    // Ignore local persistence errors; the in-memory value still updates.
  }
}

function readRightSidebarCardOrder(): RightSidebarCardId[] {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_RIGHT_SIDEBAR_CARD_ORDER;
    const parsed = JSON.parse(localStorage.getItem(RIGHT_SIDEBAR_CARD_ORDER_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return DEFAULT_RIGHT_SIDEBAR_CARD_ORDER;
    const known = new Set<RightSidebarCardId>(DEFAULT_RIGHT_SIDEBAR_CARD_ORDER);
    const filtered = parsed.filter((item): item is RightSidebarCardId => known.has(item));
    if (!filtered.includes("longTaskStatus")) {
      return placeNewSubagentCard([
        "longTaskStatus",
        ...filtered,
        ...DEFAULT_RIGHT_SIDEBAR_CARD_ORDER.filter((item) => item !== "longTaskStatus" && !filtered.includes(item)),
      ], filtered);
    }
    return placeNewSubagentCard([
      ...filtered,
      ...DEFAULT_RIGHT_SIDEBAR_CARD_ORDER.filter((item) => !filtered.includes(item)),
    ], filtered);
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

const cachedThemeSnapshot = readCachedThemeSnapshot();

export interface AppStore extends AppState {
  setCurrentProject: (project: Project | null) => void;
  setCurrentSession: (session: Session | null) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setIsRunning: (running: boolean) => void;
  setRunningSessionId: (sessionId: string | null) => void;
  setRoomAgentActivity: (activity: RoomAgentActivity) => void;
  removeRoomAgentActivity: (roomId: string, roomAgentId: string) => void;
  clearRoomAgentActivities: (roomId?: string) => void;
  setCreatingSessionProjectPath: (projectPath: string | null) => void;
  setDefaultThinking: (thinking: boolean) => void;
  setDefaultPlanMode: (enabled: boolean) => void;
  setFontSize: (size: number) => void;
  setAdditionalWorkDirs: (dirs: string[]) => void;
  setDetailedContext: (enabled: boolean) => void;
  setStatusUpdateDisplay: (display: StatusUpdateDisplay) => void;
  setSessionRecommendationEnabled: (enabled: boolean) => void;
  setSessionRecommendationTurnLimit: (limit: number) => void;
  setVoiceShortcut: (shortcut: string) => void;
  setNotificationMode: (mode: NotificationMode) => void;
  setNotificationShowContent: (enabled: boolean) => void;
  setProcessDisplayMode: (mode: ProcessDisplayMode) => void;
  setCollapseProcessWhileRunning: (enabled: boolean) => void;
  setFilePreviewExtensions: (extensions: string[]) => void;
  setLongTasksOpen: (open: boolean) => void;
  setLongTaskInspectorOpen: (open: boolean) => void;
  setDiffPanelOpen: (open: boolean) => void;
  setComposerCardHidden: (sessionId: string, card: ComposerDockCard, hidden: boolean) => void;
  setRightSidebarCardOrder: (order: RightSidebarCardId[]) => void;
  setHandoffSessionId: (sessionId: string | null) => void;
  setWorkspaceView: (view: WorkspaceView) => void;
  toggleSidebar: () => void;
  setTheme: (theme: Theme) => void;
  setThemePalette: (palette: ThemePaletteId) => void;
  setCustomThemePalette: (colors: ThemePaletteColors) => void;
  setKimiThemePalettes: (presets: KimiThemePreset[]) => void;
  upsertKimiThemePalette: (preset: KimiThemePreset) => void;
  removeKimiThemePalette: (id: string) => void;
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
  roomAgentActivities: {},
  creatingSessionProjectPath: null,
  defaultThinking: true,
  defaultPlanMode: false,
  fontSize: 15,
  additionalWorkDirs: [],
  detailedContext: false,
  statusUpdateDisplay: "turn_end",
  sessionRecommendationEnabled: true,
  sessionRecommendationTurnLimit: 10,
  voiceShortcut: "Win+H",
  notificationMode: "unfocused",
  notificationShowContent: false,
  processDisplayMode: readProcessDisplayMode(),
  collapseProcessWhileRunning: readCollapseProcessWhileRunning(),
  filePreviewExtensions: ["md", "txt"],
  longTasksOpen: false,
  longTaskInspectorOpen: false,
  diffPanelOpen: false,
  hiddenComposerCards: {},
  rightSidebarCardOrder: readRightSidebarCardOrder(),
  handoffSessionId: null,
  workspaceView: "chat",
  sidebarOpen: true,
  theme: cachedThemeSnapshot.theme,
  themePalette: cachedThemeSnapshot.themePalette,
  customThemePalette: cachedThemeSnapshot.customThemePalette,
  kimiThemePalettes: cachedThemeSnapshot.kimiThemePalettes,
  settingsOpen: false,
  focusInputTrigger: 0,
  searchQuery: "",
  searchOpen: false,

  setCurrentProject: (project) => set({ currentProject: project }),
  setCurrentSession: (session) => set({ currentSession: session }),
  setPermissionMode: (mode) => set({ permissionMode: mode }),
  setIsRunning: (running) => set({ isRunning: running }),
  setRunningSessionId: (sessionId) => set({ runningSessionId: sessionId, isRunning: Boolean(sessionId) }),
  setRoomAgentActivity: (activity) => set((state) => ({
    roomAgentActivities: {
      ...state.roomAgentActivities,
      [roomAgentActivityKey(activity.roomId, activity.roomAgentId)]: {
        ...state.roomAgentActivities[roomAgentActivityKey(activity.roomId, activity.roomAgentId)],
        ...activity,
      },
    },
  })),
  removeRoomAgentActivity: (roomId, roomAgentId) => set((state) => {
    const key = roomAgentActivityKey(roomId, roomAgentId);
    if (!state.roomAgentActivities[key]) return state;
    const roomAgentActivities = { ...state.roomAgentActivities };
    delete roomAgentActivities[key];
    return { roomAgentActivities };
  }),
  clearRoomAgentActivities: (roomId) => set((state) => ({
    roomAgentActivities: roomId
      ? Object.fromEntries(Object.entries(state.roomAgentActivities).filter(([, activity]) => activity.roomId !== roomId))
      : {},
  })),
  setCreatingSessionProjectPath: (projectPath) => set({ creatingSessionProjectPath: projectPath }),
  setDefaultThinking: (thinking) => set({ defaultThinking: thinking }),
  setDefaultPlanMode: (enabled) => set({ defaultPlanMode: enabled }),
  setFontSize: (size) => set({ fontSize: Math.max(11, Math.min(20, Math.round(size))) }),
  setAdditionalWorkDirs: (dirs) => set({ additionalWorkDirs: dirs }),
  setDetailedContext: (enabled) => set({ detailedContext: enabled }),
  setStatusUpdateDisplay: (display) => set({ statusUpdateDisplay: display }),
  setSessionRecommendationEnabled: (enabled) => set({ sessionRecommendationEnabled: enabled }),
  setSessionRecommendationTurnLimit: (limit) => set({ sessionRecommendationTurnLimit: Math.max(1, Math.min(200, Math.round(limit))) }),
  setVoiceShortcut: (shortcut) => set({ voiceShortcut: shortcut.trim() || "Win+H" }),
  setNotificationMode: (mode) => set({ notificationMode: mode }),
  setNotificationShowContent: (enabled) => set({ notificationShowContent: enabled }),
  setProcessDisplayMode: (mode) => {
    writeProcessDisplayMode(mode);
    set({ processDisplayMode: mode });
  },
  setCollapseProcessWhileRunning: (enabled) => {
    writeCollapseProcessWhileRunning(enabled);
    set({ collapseProcessWhileRunning: enabled });
  },
  setFilePreviewExtensions: (extensions) => set({
    filePreviewExtensions: Array.from(new Set(extensions
      .map((item) => item.trim().toLowerCase().replace(/^\.+/, ""))
      .filter((item) => /^[a-z0-9]{1,12}$/.test(item))))
      .slice(0, 20),
  }),
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
    const normalized = placeNewSubagentCard([
      ...order.filter((item): item is RightSidebarCardId => known.has(item)),
      ...DEFAULT_RIGHT_SIDEBAR_CARD_ORDER.filter((item) => !order.includes(item)),
    ], order);
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
  setThemePalette: (palette) => set({ themePalette: normalizeThemePaletteId(palette) }),
  setCustomThemePalette: (colors) => set({ customThemePalette: normalizeThemePaletteColors(colors) }),
  setKimiThemePalettes: (presets) => set({ kimiThemePalettes: normalizeKimiThemePresets(presets) }),
  upsertKimiThemePalette: (preset) => set((state) => {
    const next = upsertKimiThemePresets(state.kimiThemePalettes, preset);
    return {
      kimiThemePalettes: next,
      themePalette: kimiThemePaletteId(preset.id),
    };
  }),
  removeKimiThemePalette: (id) => set((state) => {
    const normalizedId = id.replace(/^kimi:/, "");
    const next = state.kimiThemePalettes.filter((preset) => preset.id !== normalizedId);
    return {
      kimiThemePalettes: next,
      themePalette: state.themePalette === kimiThemePaletteId(normalizedId) ? DEFAULT_THEME_PALETTE_ID : state.themePalette,
    };
  }),
}));
