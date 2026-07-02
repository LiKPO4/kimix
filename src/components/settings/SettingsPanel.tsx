import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, RefObject } from "react";
import { useShallow } from "zustand/react/shallow";
import { X, Sun, Moon, Monitor, Shield, Zap, GitBranch, Terminal, AlertCircle, RefreshCw, MessageSquare, Bell, Mic, Keyboard, Archive, Trash2, Unlink, Check, Settings, LogIn, LogOut, ShieldCheck, ShieldX, ChevronDown, ChevronUp, GripVertical, Download, Upload, FileText } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Theme, PermissionMode, NotificationMode, ThemePaletteColors, ThemePaletteId, KimiThemePreset } from "@/types/ui";
import { DEFAULT_THEME_PALETTE_ID, kimiThemePaletteId, reconcileKimiThemePresetsFromDirectory, THEME_PALETTES } from "@/utils/themePalettes";
import {
  applySessionBackupImportPlan,
  buildSessionBackupSnapshot,
  createSessionBackupImportPlan,
  formatSessionBackupImportSummary,
  hasSessionBackupImportChanges,
} from "@/utils/sessionBackup";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import type { KimiCodeServerModelCatalog } from "@electron/types/ipc";
import { usePresence } from "@/hooks/usePresence";

type FreezeReport = {
  at: string;
  lagMs: number;
  sessionId: string | null;
  runningSessionId: string | null;
  snapshot?: unknown;
  recentConsole?: unknown[];
  recentLongTasks?: unknown[];
};

type ArchivedSessionSummary = {
  id: string;
  title: string;
  projectPath: string;
  archivedAt: number;
};

const FREEZE_REPORTS_KEY = "kimix_freeze_reports";
const SETTINGS_SECTION_ORDER_KEY = "kimix_settings_section_order";
const MAX_FREEZE_REPORTS_RAW_LENGTH = 64 * 1024;
const KIMI_AUTH_CHANGED_EVENT = "kimix:kimi-auth-changed";
const KIMI_MODEL_CONFIG_CHANGED_EVENT = "kimix:kimi-model-config-changed";
const SETTINGS_PREVIEW_ITEM_LIMIT = 5;
const KIMIX_VERSION = "2.13.7";
const FILE_PREVIEW_EXTENSION_OPTIONS = ["md", "txt", "log", "json", "yaml", "yml"];

type SettingsSectionId =
  | "connection"
  | "auth"
  | "experiment"
  | "model"
  | "theme"
  | "permission"
  | "context"
  | "message"
  | "filePreview"
  | "newSession"
  | "notification"
  | "voice"
  | "archived"
  | "migration"
  | "freeze";

const DEFAULT_SETTINGS_SECTION_ORDER: SettingsSectionId[] = [
  "connection",
  "auth",
  "experiment",
  "model",
  "theme",
  "permission",
  "context",
  "message",
  "filePreview",
  "newSession",
  "notification",
  "voice",
  "archived",
  "migration",
  "freeze",
];

type KimiAuthStatus = {
  available: boolean;
  path?: string;
  loggedIn: boolean;
  configPath: string;
  mcpConfigPath: string;
  defaultModel: string | null;
  defaultThinking: boolean;
  message: string;
};

type KimiModelConfigSummary = {
  configPath: string;
  exists: boolean;
  defaultModel: string | null;
  providers: {
    name: string;
    type: string | null;
    baseUrl: string | null;
    hasApiKey: boolean;
    hasOauth: boolean;
  }[];
  models: {
    alias: string;
    provider: string | null;
    model: string | null;
    displayName: string | null;
    maxContextSize: number | null;
    adaptiveThinking: boolean | null;
    isDefault: boolean;
  }[];
};

type KimiProviderCatalogEntry = {
  providerId: string;
  type: string;
  baseUrl: string | null;
  modelCount: number;
  models: {
    id: string;
    name: string | null;
    maxContextSize: number | null;
    thinking: boolean;
    toolUse: boolean;
  }[];
};

type KimiEnvironmentSummary = {
  kimiCodeHome: string;
  proxy: {
    key: "HTTP_PROXY" | "HTTPS_PROXY" | "ALL_PROXY" | "NO_PROXY";
    configured: boolean;
    value: string;
  }[];
};

type KimiConnectionStatus = {
  loading: boolean;
  available: boolean | null;
  verified: boolean;
  message: string;
  path?: string;
  output?: string;
};

const settingsStatusCache: {
  connection: KimiConnectionStatus | null;
  auth: KimiAuthStatus | null;
  modelConfig: KimiModelConfigSummary | null;
  modelConfigMessage: string;
  kimiEnvironment: KimiEnvironmentSummary | null;
} = {
  connection: null,
  auth: null,
  modelConfig: null,
  modelConfigMessage: "",
  kimiEnvironment: null,
};

function normalizeOpenAiProviderContextSize(value: number | null | undefined) {
  const fallback = 262144;
  const input = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, input);
}

function normalizeSettingsSectionOrder(order: unknown[]): SettingsSectionId[] {
  const known = new Set<SettingsSectionId>(DEFAULT_SETTINGS_SECTION_ORDER);
  const filtered = order.filter((item): item is SettingsSectionId => typeof item === "string" && known.has(item as SettingsSectionId));
  const result = [...filtered];
  for (const item of DEFAULT_SETTINGS_SECTION_ORDER) {
    if (result.includes(item)) continue;
    const defaultIndex = DEFAULT_SETTINGS_SECTION_ORDER.indexOf(item);
    const previousKnown = [...DEFAULT_SETTINGS_SECTION_ORDER.slice(0, defaultIndex)]
      .reverse()
      .find((candidate) => result.includes(candidate));
    if (previousKnown) {
      result.splice(result.indexOf(previousKnown) + 1, 0, item);
      continue;
    }
    const nextKnown = DEFAULT_SETTINGS_SECTION_ORDER.slice(defaultIndex + 1)
      .find((candidate) => result.includes(candidate));
    if (nextKnown) {
      result.splice(result.indexOf(nextKnown), 0, item);
      continue;
    }
    result.push(item);
  }
  return result;
}

function readSettingsSectionOrder(): SettingsSectionId[] {
  try {
    const raw = localStorage.getItem(SETTINGS_SECTION_ORDER_KEY);
    if (!raw) return DEFAULT_SETTINGS_SECTION_ORDER;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SETTINGS_SECTION_ORDER;
    return normalizeSettingsSectionOrder(parsed);
  } catch {
    return DEFAULT_SETTINGS_SECTION_ORDER;
  }
}

function writeSettingsSectionOrder(order: SettingsSectionId[]) {
  try {
    localStorage.setItem(SETTINGS_SECTION_ORDER_KEY, JSON.stringify(order));
  } catch {
    // The in-memory order still updates if local persistence is unavailable.
  }
}

function parseFreezeReports() {
  const raw = localStorage.getItem(FREEZE_REPORTS_KEY);
  if (!raw) return [];
  if (raw.length > MAX_FREEZE_REPORTS_RAW_LENGTH) {
    localStorage.removeItem(FREEZE_REPORTS_KEY);
    return [];
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is FreezeReport => (
    item &&
    typeof item === "object" &&
    typeof item.at === "string" &&
    typeof item.lagMs === "number" &&
    ("sessionId" in item) &&
    ("runningSessionId" in item)
  ));
}

function formatFreezeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getFreezeVisibilityState(report: FreezeReport) {
  const snapshot = report.snapshot;
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = (snapshot as { visibilityState?: unknown }).visibilityState;
  return typeof value === "string" ? value : null;
}

function getFreezeVisibilityLabel(report: FreezeReport) {
  const visibility = getFreezeVisibilityState(report);
  if (visibility === "hidden") return "后台";
  if (visibility === "visible") return "前台";
  return "未知";
}

function freezeLagBadgeClass(report: FreezeReport) {
  return getFreezeVisibilityState(report) === "hidden"
    ? "bg-amber-50 text-amber-700"
    : "bg-accent-danger-light text-accent-danger";
}

function sanitizeFilenamePart(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-").replace(/\s+/g, "-").slice(0, 80);
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: "无法序列化完整诊断对象",
      message: error instanceof Error ? error.message : String(error),
    }, null, 2);
  }
}

function downloadTextFile(filename: string, content: string, mime = "application/json") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildFreezeReportExport(report: FreezeReport, reports: FreezeReport[]) {
  const appState = useAppStore.getState();
  const sessionState = useSessionStore.getState();
  const currentSession = appState.currentSession;
  const relatedSession = sessionState.sessions.find((session) => session.id === report.sessionId);
  return {
    exportedAt: new Date().toISOString(),
    appVersion: KIMIX_VERSION,
    report,
    relatedReports: reports
      .filter((item) => item.sessionId === report.sessionId || item.runningSessionId === report.runningSessionId)
      .slice(0, 20),
    currentState: {
      workspaceView: appState.workspaceView,
      currentProject: appState.currentProject ? {
        id: appState.currentProject.id,
        name: appState.currentProject.name,
        path: appState.currentProject.path,
        gitBranch: appState.currentProject.gitBranch,
      } : null,
      currentSession: currentSession ? {
        id: currentSession.id,
        title: currentSession.title,
        engine: currentSession.engine,
        runtimeSessionId: currentSession.runtimeSessionId,
        officialSessionId: currentSession.officialSessionId,
        projectPath: currentSession.projectPath,
        eventCount: currentSession.events.length,
        isLoading: currentSession.isLoading,
        updatedAt: currentSession.updatedAt,
      } : null,
      runningSessionId: appState.runningSessionId,
      panels: {
        settingsOpen: appState.settingsOpen,
        searchOpen: appState.searchOpen,
        longTasksOpen: appState.longTasksOpen,
        longTaskInspectorOpen: appState.longTaskInspectorOpen,
        diffPanelOpen: appState.diffPanelOpen,
        sidebarOpen: appState.sidebarOpen,
      },
      modes: {
        permissionMode: appState.permissionMode,
        statusUpdateDisplay: appState.statusUpdateDisplay,
      },
    },
    relatedSession: relatedSession ? {
      id: relatedSession.id,
      title: relatedSession.title,
      engine: relatedSession.engine,
      runtimeSessionId: relatedSession.runtimeSessionId,
      officialSessionId: relatedSession.officialSessionId,
      projectPath: relatedSession.projectPath,
      eventCount: relatedSession.events.length,
      isLoading: relatedSession.isLoading,
      updatedAt: relatedSession.updatedAt,
      lastEvents: relatedSession.events.slice(-12).map((event) => ({
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
      })),
    } : null,
    browser: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      visibilityState: document.visibilityState,
      focused: document.hasFocus(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
    },
  };
}

function SelectionIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`kimix-selection-indicator flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors ${selected ? "is-selected" : ""} ${
        selected
          ? "border-accent-primary bg-accent-primary text-text-inverse"
          : "text-transparent"
      }`}
    >
      {selected ? <Check size={11} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-transparent" />}
    </span>
  );
}

function normalizeFilePreviewExtensions(value: string | string[]) {
  const parts = Array.isArray(value) ? value : value.split(/[\s,，;；]+/);
  return Array.from(new Set(parts
    .map((item) => item.trim().toLowerCase().replace(/^\.+/, ""))
    .filter((item) => /^[a-z0-9]{1,12}$/.test(item))))
    .slice(0, 20);
}

export function SettingsPanel({ variant = "modal", onBackToChat }: { variant?: "modal" | "workspace"; onBackToChat?: () => void }) {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const settingsPresence = usePresence(settingsOpen || variant === "workspace");
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const themePalette = useAppStore((s) => s.themePalette);
  const setThemePalette = useAppStore((s) => s.setThemePalette);
  const customThemePalette = useAppStore((s) => s.customThemePalette);
  const setCustomThemePalette = useAppStore((s) => s.setCustomThemePalette);
  const kimiThemePalettes = useAppStore((s) => s.kimiThemePalettes);
  const setKimiThemePalettes = useAppStore((s) => s.setKimiThemePalettes);
  const removeKimiThemePalette = useAppStore((s) => s.removeKimiThemePalette);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const detailedContext = useAppStore((s) => s.detailedContext);
  const setDetailedContext = useAppStore((s) => s.setDetailedContext);
  const statusUpdateDisplay = useAppStore((s) => s.statusUpdateDisplay);
  const setStatusUpdateDisplay = useAppStore((s) => s.setStatusUpdateDisplay);
  const sessionRecommendationEnabled = useAppStore((s) => s.sessionRecommendationEnabled);
  const setSessionRecommendationEnabled = useAppStore((s) => s.setSessionRecommendationEnabled);
  const sessionRecommendationTurnLimit = useAppStore((s) => s.sessionRecommendationTurnLimit);
  const setSessionRecommendationTurnLimit = useAppStore((s) => s.setSessionRecommendationTurnLimit);
  const voiceShortcut = useAppStore((s) => s.voiceShortcut);
  const setVoiceShortcut = useAppStore((s) => s.setVoiceShortcut);
  const notificationMode = useAppStore((s) => s.notificationMode);
  const setNotificationMode = useAppStore((s) => s.setNotificationMode);
  const filePreviewExtensions = useAppStore((s) => s.filePreviewExtensions);
  const setFilePreviewExtensions = useAppStore((s) => s.setFilePreviewExtensions);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const archivedSessionItems = useSessionStore(useShallow((s) => s.sessions.filter((session) => session.archivedAt)));
  const migrationCountsDigest = useSessionStore((s) => {
    let visibleCount = 0;
    let archivedCount = 0;
    for (const session of s.sessions) {
      if (isHiddenInternalSession(session)) continue;
      visibleCount += 1;
      if (session.archivedAt) archivedCount += 1;
    }
    return [
      visibleCount,
      archivedCount,
      s.pendingMessages.length,
      s.recentProjects.length,
    ].join("|");
  });
  const archivedSessionSummaries = useMemo(() => {
    return archivedSessionItems.map((session) => ({
      id: session.id,
      title: session.title,
      projectPath: session.projectPath,
      archivedAt: session.archivedAt ?? 0,
    }));
  }, [archivedSessionItems]);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const [freezeReports, setFreezeReports] = useState<FreezeReport[]>([]);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [migrationBusy, setMigrationBusy] = useState<"export" | "import" | null>(null);
  const [migrationDragActive, setMigrationDragActive] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState("");
  const [freezeExpanded, setFreezeExpanded] = useState(false);
  const [filePreviewExtensionDraft, setFilePreviewExtensionDraft] = useState(filePreviewExtensions.join(", "));
  const [auth, setAuth] = useState<KimiAuthStatus | null>(settingsStatusCache.auth);
  const [authLoading, setAuthLoading] = useState(!settingsStatusCache.auth);
  const [authBusyAction, setAuthBusyAction] = useState<"login" | "logout" | null>(null);
  const [themeScanLoading, setThemeScanLoading] = useState(false);
  const [themeScanMessage, setThemeScanMessage] = useState<string | null>(null);
  const [themeDeleteBusyId, setThemeDeleteBusyId] = useState<string | null>(null);
  const [modelConfig, setModelConfig] = useState<KimiModelConfigSummary | null>(settingsStatusCache.modelConfig);
  const [modelConfigLoading, setModelConfigLoading] = useState(!settingsStatusCache.modelConfig);
  const [modelDoctorLoading, setModelDoctorLoading] = useState(false);
  const [modelConfigMessage, setModelConfigMessage] = useState(settingsStatusCache.modelConfigMessage);
  const [modelAliasesExpanded, setModelAliasesExpanded] = useState(false);
  const [kimiEnvironment, setKimiEnvironment] = useState<KimiEnvironmentSummary | null>(settingsStatusCache.kimiEnvironment);
  const [serverModelCatalog, setServerModelCatalog] = useState<KimiCodeServerModelCatalog | null>(null);
  const [experimentalKimiServer, setExperimentalKimiServer] = useState(true);
  const [experimentalKimiServerSessions, setExperimentalKimiServerSessions] = useState(true);
  const [experimentalSettingsLoading, setExperimentalSettingsLoading] = useState(true);
  const [experimentalSettingsSaving, setExperimentalSettingsSaving] = useState(false);
  const [experimentalSettingsMessage, setExperimentalSettingsMessage] = useState("");

  useEffect(() => {
    setFilePreviewExtensionDraft(filePreviewExtensions.join(", "));
  }, [filePreviewExtensions]);
  const [providerDraft, setProviderDraft] = useState({
    providerName: "deepseek",
    modelAlias: "deepseek/deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
    apiKey: "",
    model: "deepseek-v4-flash",
    maxContextSize: "1000000",
  });
  const [providerBusyAction, setProviderBusyAction] = useState<"test" | "save" | "default" | "remove" | null>(null);
  const [adaptiveThinkingBusyAlias, setAdaptiveThinkingBusyAlias] = useState<string | null>(null);
  const [providerMessage, setProviderMessage] = useState("");
  const [providerCatalog, setProviderCatalog] = useState<KimiProviderCatalogEntry[]>([]);
  const [providerCatalogLoading, setProviderCatalogLoading] = useState(false);
  const [selectedCatalogProviderId, setSelectedCatalogProviderId] = useState("");
  const [selectedCatalogModelId, setSelectedCatalogModelId] = useState("");
  const [selectedModelAlias, setSelectedModelAlias] = useState("");
  const authSettingsRef = useRef<HTMLDivElement>(null);
  const modelSettingsRef = useRef<HTMLDivElement>(null);
  const settingsSectionRefs = useRef(new Map<SettingsSectionId, HTMLElement>());
  const settingsDragCleanupRef = useRef<(() => void) | null>(null);
  const [settingsSectionOrder, setSettingsSectionOrder] = useState<SettingsSectionId[]>(() => readSettingsSectionOrder());
  const [dragSettingsSectionId, setDragSettingsSectionId] = useState<SettingsSectionId | null>(null);
  const [settingsSectionDrop, setSettingsSectionDrop] = useState<{ id: SettingsSectionId; position: "above" | "below" } | null>(null);
  const [connection, setConnection] = useState<KimiConnectionStatus>(
    settingsStatusCache.connection ?? { loading: true, available: null, verified: false, message: "正在查找 Kimi Code" },
  );
  useEffect(() => () => {
    settingsDragCleanupRef.current?.();
    settingsDragCleanupRef.current = null;
  }, []);

  const settingsSectionOrderValue = (id: SettingsSectionId, fallback: number) => {
    const index = settingsSectionOrder.indexOf(id);
    return index >= 0 ? index : fallback;
  };
  const setPersistedSettingsSectionOrder = (order: SettingsSectionId[]) => {
    const normalized = normalizeSettingsSectionOrder(order);
    writeSettingsSectionOrder(normalized);
    setSettingsSectionOrder(normalized);
  };
  const applySettingsSectionDrop = (source: SettingsSectionId | null, indicator: { id: SettingsSectionId; position: "above" | "below" } | null) => {
    if (!source || !indicator || source === indicator.id) return;
    const ordered = [...settingsSectionOrder];
    const fromIndex = ordered.indexOf(source);
    if (fromIndex < 0) return;
    const [moved] = ordered.splice(fromIndex, 1);
    const targetIndex = ordered.indexOf(indicator.id);
    if (targetIndex < 0) return;
    ordered.splice(indicator.position === "below" ? targetIndex + 1 : targetIndex, 0, moved);
    setPersistedSettingsSectionOrder(ordered);
  };
  const getSettingsSectionDropAtPoint = (source: SettingsSectionId, clientY: number) => {
    const visibleSections = Array.from(settingsSectionRefs.current.entries())
      .filter(([id, element]) => id !== source && element.offsetParent !== null)
      .map(([id, element]) => ({ id, rect: element.getBoundingClientRect() }))
      .sort((a, b) => a.rect.top - b.rect.top);
    if (visibleSections.length === 0) return null;
    const first = visibleSections[0];
    const last = visibleSections[visibleSections.length - 1];
    if (clientY <= first.rect.top) return { id: first.id, position: "above" as const };
    if (clientY >= last.rect.bottom) return { id: last.id, position: "below" as const };
    for (const section of visibleSections) {
      if (clientY >= section.rect.top && clientY <= section.rect.bottom) {
        return {
          id: section.id,
          position: clientY < section.rect.top + section.rect.height / 2 ? "above" as const : "below" as const,
        };
      }
      if (clientY < section.rect.top) return { id: section.id, position: "above" as const };
    }
    return { id: last.id, position: "below" as const };
  };
  const settingsSectionProps = (id: SettingsSectionId, fallbackOrder: number, forwardedRef?: RefObject<HTMLDivElement | null>) => {
    const dropActive = settingsSectionDrop?.id === id ? settingsSectionDrop.position : null;
    return {
      ref: (element: HTMLDivElement | null) => {
        if (forwardedRef) {
          (forwardedRef as { current: HTMLDivElement | null }).current = element;
        }
        if (element) settingsSectionRefs.current.set(id, element);
        else settingsSectionRefs.current.delete(id);
      },
      "data-settings-section-id": id,
      "data-settings-drop-position": dropActive ?? undefined,
      style: {
        order: settingsSectionOrderValue(id, fallbackOrder),
        position: "relative" as const,
        opacity: dragSettingsSectionId === id ? 0.55 : 1,
      },
    };
  };
  const settingsDragHandle = (id: SettingsSectionId, label: string) => (
    <button
      type="button"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        settingsDragCleanupRef.current?.();
        setDragSettingsSectionId(id);
        let latestDrop: { id: SettingsSectionId; position: "above" | "below" } | null = null;
        const previousUserSelect = document.body.style.userSelect;
        const previousCursor = document.body.style.cursor;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        const updateDrop = (clientY: number) => {
          const nextDrop = getSettingsSectionDropAtPoint(id, clientY);
          latestDrop = nextDrop;
          setSettingsSectionDrop((current) => (
            current?.id === nextDrop?.id && current?.position === nextDrop?.position ? current : nextDrop
          ));
        };
        const handlePointerMove = (moveEvent: PointerEvent) => {
          moveEvent.preventDefault();
          updateDrop(moveEvent.clientY);
        };
        const cleanupDrag = () => {
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerup", finishDrag);
          window.removeEventListener("pointercancel", cancelDrag);
          document.body.style.userSelect = previousUserSelect;
          document.body.style.cursor = previousCursor;
          settingsDragCleanupRef.current = null;
          setDragSettingsSectionId(null);
          setSettingsSectionDrop(null);
        };
        const finishDrag = (upEvent: PointerEvent) => {
          upEvent.preventDefault();
          cleanupDrag();
          applySettingsSectionDrop(id, latestDrop);
        };
        const cancelDrag = () => {
          cleanupDrag();
        };
        settingsDragCleanupRef.current = cleanupDrag;
        updateDrop(event.clientY);
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", finishDrag);
        window.addEventListener("pointercancel", cancelDrag);
      }}
      className="kimix-settings-drag-handle"
      title="长按拖动调整位置"
      aria-label={`拖动${label}设置分区`}
    >
      <GripVertical size={14} />
    </button>
  );

  const checkConnection = async (verify = false, options: { showLoading?: boolean } = {}) => {
    const showLoading = options.showLoading ?? !settingsStatusCache.connection;
    if (showLoading) {
      setConnection((current) => ({
        ...current,
        loading: true,
        message: verify ? "正在检查 Kimi Code 响应" : "正在查找 Kimi Code",
      }));
    }
    const res = await window.api.checkKimiCli({ verify });
    if (res.success) {
      const next = {
        loading: false,
        available: res.data.available,
        verified: res.data.verified,
        message: res.data.message,
        path: res.data.path,
        output: res.data.output,
      };
      settingsStatusCache.connection = next;
      setConnection(next);
      return;
    }
    const next = { loading: false, available: false, verified: false, message: res.error };
    settingsStatusCache.connection = next;
    setConnection(next);
  };

  const refreshAuth = async (options: { showLoading?: boolean } = {}) => {
    const showLoading = options.showLoading ?? !settingsStatusCache.auth;
    if (showLoading) setAuthLoading(true);
    const res = await window.api.getKimiAuthStatus();
    setAuthLoading(false);
    if (res.success) {
      settingsStatusCache.auth = res.data;
      setAuth(res.data);
      return;
    }
    const next = {
      available: false,
      loggedIn: false,
      configPath: "",
      mcpConfigPath: "",
      defaultModel: null,
      defaultThinking: false,
      message: `读取登录状态失败：${res.error}`,
    };
    settingsStatusCache.auth = next;
    setAuth(next);
  };

  const refreshModelConfig = async (options: { showLoading?: boolean } = {}) => {
    const showLoading = options.showLoading ?? !settingsStatusCache.modelConfig;
    if (showLoading) setModelConfigLoading(true);
    const [res, serverCatalogRes] = await Promise.all([
      window.api.getKimiModelConfig(),
      window.api.getKimiCodeServerModelCatalog(),
    ]);
    setModelConfigLoading(false);
    setServerModelCatalog(serverCatalogRes.success ? serverCatalogRes.data : null);
    if (res.success) {
      settingsStatusCache.modelConfig = res.data;
      settingsStatusCache.modelConfigMessage = res.data.exists ? "" : "尚未找到 Kimi Code config.toml。";
      setModelConfig(res.data);
      setModelConfigMessage(settingsStatusCache.modelConfigMessage);
      return;
    }
    settingsStatusCache.modelConfig = null;
    settingsStatusCache.modelConfigMessage = `读取模型配置失败：${res.error}`;
    setModelConfig(null);
    setModelConfigMessage(settingsStatusCache.modelConfigMessage);
  };

  const handleDoctorModelConfig = async () => {
    if (typeof window.api.doctorKimiConfig !== "function") {
      setModelConfigMessage("配置诊断接口尚未载入，请完全关闭 Kimix dev 窗口后重新启动。");
      return;
    }
    setModelDoctorLoading(true);
    setModelConfigMessage("正在诊断 Kimi Code 配置...");
    try {
      const res = await window.api.doctorKimiConfig();
      if (res.success) {
        const detail = res.data.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2).join("；");
        settingsStatusCache.modelConfigMessage = detail || res.data.message;
        settingsStatusCache.kimiEnvironment = res.data.environment ?? null;
        setModelConfigMessage(settingsStatusCache.modelConfigMessage);
        setKimiEnvironment(settingsStatusCache.kimiEnvironment);
        return;
      }
      settingsStatusCache.modelConfigMessage = `配置诊断失败：${res.error}`;
      setModelConfigMessage(settingsStatusCache.modelConfigMessage);
    } catch (error) {
      settingsStatusCache.modelConfigMessage = `配置诊断失败：${error instanceof Error ? error.message : String(error)}`;
      setModelConfigMessage(settingsStatusCache.modelConfigMessage);
    } finally {
      setModelDoctorLoading(false);
    }
  };

  const buildProviderPayload = () => {
    const contextText = providerDraft.maxContextSize.trim();
    const contextSize = Number(contextText);
    if (!contextText || !Number.isInteger(contextSize) || contextSize < 1 || contextSize > 1048576) {
      return null;
    }
    const normalizedContextSize = normalizeOpenAiProviderContextSize(contextSize);
    return {
      providerName: providerDraft.providerName.trim(),
      modelAlias: providerDraft.modelAlias.trim(),
      baseUrl: providerDraft.baseUrl.trim(),
      apiKey: providerDraft.apiKey.trim() || undefined,
      model: providerDraft.model.trim(),
      maxContextSize: normalizedContextSize,
    };
  };

  const handleSelectModel = (model: KimiModelConfigSummary["models"][number]) => {
    setSelectedModelAlias(model.alias);
    const provider = modelConfig?.providers.find((item) => item.name === model.provider);
    setProviderDraft((current) => ({
      ...current,
      providerName: provider?.name ?? model.provider ?? current.providerName,
      modelAlias: model.alias,
      baseUrl: provider?.baseUrl ?? current.baseUrl,
      model: model.model ?? model.alias,
      maxContextSize: String(model.maxContextSize ?? current.maxContextSize),
    }));
    setProviderMessage(model.isDefault ? "当前正在使用此模型，可新建会话测试。" : "已选中模型；点击使用后，新会话会使用它。");
  };

  const fillProviderDraftFromCatalog = (provider: KimiProviderCatalogEntry, model: KimiProviderCatalogEntry["models"][number]) => {
    const normalizedContextSize = normalizeOpenAiProviderContextSize(model.maxContextSize);
    setProviderDraft((current) => ({
      ...current,
      providerName: provider.providerId,
      modelAlias: `${provider.providerId}/${model.id}`,
      baseUrl: provider.baseUrl ?? current.baseUrl,
      model: model.id,
      maxContextSize: String(normalizedContextSize),
    }));
    setProviderMessage(`已从官方 catalog 填入 ${provider.providerId}/${model.id}，请补 API Key 后测试或保存。`);
  };

  const handleLoadProviderCatalog = async () => {
    if (typeof window.api.listKimiProviderCatalog !== "function") {
      setProviderMessage("Provider catalog 接口尚未载入，请完全关闭 Kimix dev 窗口后重新启动。");
      return;
    }
    setProviderCatalogLoading(true);
    setProviderMessage("正在读取官方 Provider catalog...");
    const res = await window.api.listKimiProviderCatalog();
    setProviderCatalogLoading(false);
    if (!res.success) {
      setProviderMessage(`读取 Provider catalog 失败：${res.error}`);
      return;
    }
    setProviderCatalog(res.data.providers);
    const firstProvider = res.data.providers[0];
    const firstModel = firstProvider?.models[0];
    if (firstProvider && firstModel) {
      setSelectedCatalogProviderId(firstProvider.providerId);
      setSelectedCatalogModelId(firstModel.id);
      fillProviderDraftFromCatalog(firstProvider, firstModel);
      return;
    }
    setSelectedCatalogProviderId("");
    setSelectedCatalogModelId("");
    setProviderMessage("官方 catalog 暂无可直接填入的 OpenAI-compatible Provider。");
  };

  const handleSelectCatalogProvider = (providerId: string) => {
    const provider = providerCatalog.find((item) => item.providerId === providerId);
    setSelectedCatalogProviderId(providerId);
    const model = provider?.models[0];
    setSelectedCatalogModelId(model?.id ?? "");
    if (provider && model) fillProviderDraftFromCatalog(provider, model);
  };

  const handleSelectCatalogModel = (modelId: string) => {
    const provider = providerCatalog.find((item) => item.providerId === selectedCatalogProviderId);
    const model = provider?.models.find((item) => item.id === modelId);
    setSelectedCatalogModelId(modelId);
    if (provider && model) fillProviderDraftFromCatalog(provider, model);
  };

  const handleSetDefaultModel = async (modelAlias = selectedModelAlias || providerDraft.modelAlias.trim()) => {
    const alias = modelAlias.trim();
    if (!alias) {
      setProviderMessage("请先选中一个模型。");
      return;
    }
    if (typeof window.api.setKimiDefaultModel !== "function") {
      setProviderMessage("模型使用接口尚未载入，请完全关闭 Kimix dev 窗口后重新启动。");
      return;
    }
    setProviderBusyAction("default");
    setProviderMessage("正在切换使用模型...");
    const res = await window.api.setKimiDefaultModel({ modelAlias: alias });
    setProviderBusyAction(null);
    if (res.success) {
      settingsStatusCache.modelConfig = res.data;
      settingsStatusCache.modelConfigMessage = res.data.message ?? "";
      setModelConfig(res.data);
      setSelectedModelAlias(alias);
      setProviderDraft((current) => ({ ...current, modelAlias: alias }));
      setProviderMessage(settingsStatusCache.modelConfigMessage);
      window.dispatchEvent(new CustomEvent(KIMI_MODEL_CONFIG_CHANGED_EVENT));
      return;
    }
    setProviderMessage(`切换使用失败：${res.error}`);
  };

  const handleToggleAdaptiveThinking = async (model: KimiModelConfigSummary["models"][number]) => {
    const provider = modelConfig?.providers.find((item) => item.name === model.provider);
    const externalOpenAiProvider = provider?.type === "openai";
    if (externalOpenAiProvider) {
      setProviderMessage("OpenAI-compatible Provider 不使用 Kimi Code 的自适应思考开关；请用输入区“思考开/关”控制本轮。");
      return;
    }
    if (typeof window.api.setKimiModelAdaptiveThinking !== "function") {
      setProviderMessage("自适应思考接口尚未载入，请完全关闭 Kimix dev 窗口后重新启动。");
      return;
    }
    const next = !Boolean(model.adaptiveThinking);
    setAdaptiveThinkingBusyAlias(model.alias);
    setProviderMessage(`正在${next ? "开启" : "关闭"}自适应思考...`);
    const res = await window.api.setKimiModelAdaptiveThinking({
      modelAlias: model.alias,
      adaptiveThinking: next,
    });
    setAdaptiveThinkingBusyAlias(null);
    if (res.success) {
      settingsStatusCache.modelConfig = res.data;
      settingsStatusCache.modelConfigMessage = `${res.data.message}：${model.alias} ${next ? "开启" : "关闭"}`;
      setModelConfig(res.data);
      setSelectedModelAlias(model.alias);
      setProviderMessage(settingsStatusCache.modelConfigMessage);
      window.dispatchEvent(new CustomEvent(KIMI_MODEL_CONFIG_CHANGED_EVENT));
      return;
    }
    setProviderMessage(`更新自适应思考失败：${res.error}`);
  };

  const handleRemoveModel = async (model: KimiModelConfigSummary["models"][number]) => {
    const provider = modelConfig?.providers.find((item) => item.name === model.provider);
    if (provider?.type !== "openai") {
      setProviderMessage("官方 managed 模型不能在 Kimix 中删除。");
      return;
    }
    if (typeof window.api.removeKimiModelConfig !== "function") {
      setProviderMessage("模型删除接口尚未载入，请完全关闭 Kimix dev 窗口后重新启动。");
      return;
    }
    const ok = window.confirm(`删除模型配置「${model.displayName || model.alias}」？\n\nKimix 会备份 config.toml，并在无其他模型引用时一并移除对应 Provider。`);
    if (!ok) return;
    setProviderBusyAction("remove");
    setProviderMessage(`正在删除 ${model.alias}...`);
    const res = await window.api.removeKimiModelConfig({ modelAlias: model.alias });
    setProviderBusyAction(null);
    if (res.success) {
      settingsStatusCache.modelConfig = res.data;
      settingsStatusCache.modelConfigMessage = res.data.message ?? "";
      setModelConfig(res.data);
      setSelectedModelAlias(res.data.defaultModel ?? "");
      setProviderMessage(settingsStatusCache.modelConfigMessage);
      window.dispatchEvent(new CustomEvent(KIMI_MODEL_CONFIG_CHANGED_EVENT));
      return;
    }
    setProviderMessage(`删除失败：${res.error}`);
  };

  const handleTestProvider = async () => {
    const payload = buildProviderPayload();
    if (!payload) {
      setProviderMessage("上下文大小填写错误，无法测试。");
      return;
    }
    setProviderBusyAction("test");
    if (payload.maxContextSize !== Number(providerDraft.maxContextSize.trim())) {
      setProviderDraft((current) => ({ ...current, maxContextSize: String(payload.maxContextSize) }));
    }
    setProviderMessage(payload.maxContextSize !== Number(providerDraft.maxContextSize.trim()) ? `Context 已收敛到 ${payload.maxContextSize}，正在测试连接...` : "正在测试连接...");
    const res = await window.api.testKimiOpenAiProvider(payload);
    setProviderBusyAction(null);
    setProviderMessage(res.success ? `测试通过：${res.data.output || res.data.message}` : `测试失败：${res.error}`);
  };

  const handleSaveProvider = async () => {
    const payload = buildProviderPayload();
    if (!payload) {
      setProviderMessage("上下文大小填写错误，无法保存。");
      return;
    }
    setProviderBusyAction("save");
    if (payload.maxContextSize !== Number(providerDraft.maxContextSize.trim())) {
      setProviderDraft((current) => ({ ...current, maxContextSize: String(payload.maxContextSize) }));
    }
    setProviderMessage(payload.maxContextSize !== Number(providerDraft.maxContextSize.trim()) ? `Context 已收敛到 ${payload.maxContextSize}，正在保存配置...` : "正在保存配置...");
    const res = await window.api.saveKimiOpenAiProvider(payload);
    setProviderBusyAction(null);
    if (res.success) {
      settingsStatusCache.modelConfig = res.data;
      settingsStatusCache.modelConfigMessage = "";
      setModelConfig(res.data);
      setModelConfigMessage("");
      setProviderMessage(res.data.message);
      window.dispatchEvent(new CustomEvent(KIMI_MODEL_CONFIG_CHANGED_EVENT));
      return;
    }
    setProviderMessage(`保存失败：${res.error}`);
  };

  const handleLogin = async () => {
    setAuthBusyAction("login");
    try {
      const res = await window.api.loginKimi();
      if (res.success) {
        setAuth(res.data);
        window.dispatchEvent(new CustomEvent(KIMI_AUTH_CHANGED_EVENT));
        return;
      }
      setAuth((current) => ({
        available: current?.available ?? false,
        loggedIn: current?.loggedIn ?? false,
        path: current?.path,
        configPath: current?.configPath ?? "",
        mcpConfigPath: current?.mcpConfigPath ?? "",
        defaultModel: current?.defaultModel ?? null,
        defaultThinking: current?.defaultThinking ?? false,
        message: `登录失败：${res.error}`,
      }));
    } catch (err) {
      setAuth((current) => ({
        available: current?.available ?? false,
        loggedIn: current?.loggedIn ?? false,
        path: current?.path,
        configPath: current?.configPath ?? "",
        mcpConfigPath: current?.mcpConfigPath ?? "",
        defaultModel: current?.defaultModel ?? null,
        defaultThinking: current?.defaultThinking ?? false,
        message: `登录失败：${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setAuthBusyAction(null);
    }
  };

  const handleLogout = async () => {
    setAuthBusyAction("logout");
    const res = await window.api.logoutKimi();
    setAuthBusyAction(null);
    if (res.success) {
      setAuth(res.data);
      window.dispatchEvent(new CustomEvent(KIMI_AUTH_CHANGED_EVENT));
      return;
    }
    setAuth((current) => ({
      available: current?.available ?? false,
      loggedIn: current?.loggedIn ?? false,
      path: current?.path,
      configPath: current?.configPath ?? "",
      mcpConfigPath: current?.mcpConfigPath ?? "",
      defaultModel: current?.defaultModel ?? null,
      defaultThinking: current?.defaultThinking ?? false,
      message: `退出失败：${res.error}`,
    }));
  };

  const loadFreezeReports = () => {
    try {
      const reports = parseFreezeReports();
      setFreezeReports(reports.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 20));
    } catch {
      localStorage.removeItem(FREEZE_REPORTS_KEY);
      setFreezeReports([]);
    }
  };

  const clearFreezeReports = () => {
    localStorage.removeItem(FREEZE_REPORTS_KEY);
    setFreezeReports([]);
  };

  const updateCustomThemeColor = (key: keyof ThemePaletteColors, value: string) => {
    setCustomThemePalette({ ...customThemePalette, [key]: value });
    if (themePalette !== "custom") setThemePalette("custom");
  };

  const scanOfficialKimiThemes = async () => {
    setThemeScanLoading(true);
    setThemeScanMessage(null);
    const preview = await window.api.previewKimiThemeImport();
    setThemeScanLoading(false);
    if (!preview.success) {
      setThemeScanMessage(`扫描失败：${preview.error}`);
      return;
    }
    const presets: KimiThemePreset[] = preview.data.items.map((item) => ({
      id: item.id,
      name: item.name,
      displayName: `KIMI-${item.displayName}`,
      path: item.path,
      base: item.base,
      palette: item.kimiColors,
      colors: item.colors,
    }));
    const reconciled = reconcileKimiThemePresetsFromDirectory(
      kimiThemePalettes,
      presets,
      preview.data.themesDir,
    );
    setKimiThemePalettes(reconciled.presets);
    const firstNew = presets[0];
    const activeThemeStillExists = reconciled.presets.some((preset) => (
      kimiThemePaletteId(preset.id) === themePalette
    ));
    if (firstNew) setThemePalette(kimiThemePaletteId(firstNew.id));
    else if (themePalette.startsWith("kimi:") && !activeThemeStillExists) setThemePalette(DEFAULT_THEME_PALETTE_ID);
    if (presets.length === 0) {
      setThemeScanMessage(reconciled.removed > 0
        ? `未发现官方主题 JSON，已移除 ${reconciled.removed} 条失效主题记录。`
        : "未发现官方主题 JSON。可先发送 /custom-theme 让官方 Skill 生成主题。");
      return;
    }
    setThemeScanMessage([
      `已登记/更新 ${presets.length} 套官方 KIMI 主题。`,
      reconciled.removed > 0 ? `已移除 ${reconciled.removed} 条失效记录。` : "",
    ].filter(Boolean).join(" "));
  };

  const removeThemeFromKimix = (id: string, label: string) => {
    removeKimiThemePalette(id);
    setThemeScanMessage(`已从 Kimix 移除 ${label}。主题源文件仍保留，再次扫描会重新出现。`);
  };

  const deleteThemeSource = async (id: string, label: string, sourcePath: string) => {
    const confirmed = window.confirm([
      `永久删除主题源文件「${label}」？`,
      "",
      sourcePath,
      "",
      "删除后 Kimi Code 与 Kimix 都无法再次扫描到该主题。此操作不可撤销。",
    ].join("\n"));
    if (!confirmed) return;
    setThemeDeleteBusyId(id);
    try {
      const result = await window.api.deleteKimiThemeSource({ path: sourcePath });
      if (!result.success) {
        setThemeScanMessage(`删除主题源文件失败：${result.error}`);
        return;
      }
      removeKimiThemePalette(id);
      setThemeScanMessage(`已删除主题源文件并从 Kimix 移除 ${label}。`);
    } catch (error) {
      setThemeScanMessage(`删除主题源文件失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setThemeDeleteBusyId(null);
    }
  };

  const activeKimiTheme = themePalette.startsWith("kimi:")
    ? kimiThemePalettes.find((preset) => kimiThemePaletteId(preset.id) === themePalette)
    : null;

  const exportFreezeReport = (report: FreezeReport, index: number) => {
    const date = new Date(report.at);
    const stamp = Number.isNaN(date.getTime()) ? sanitizeFilenamePart(report.at) : date.toISOString().replace(/[:.]/g, "-");
    const sessionPart = sanitizeFilenamePart(report.sessionId ?? "no-session");
    const filename = `kimix-freeze-${stamp}-${sessionPart}-${index + 1}.json`;
    downloadTextFile(filename, safeJsonStringify(buildFreezeReportExport(report, freezeReports)));
  };

  const handleExportSessionBackup = async () => {
    setMigrationBusy("export");
    setMigrationMessage("正在准备会话快照...");
    try {
      const snapshot = buildSessionBackupSnapshot(KIMIX_VERSION);
      const res = await window.api.exportSessionBackup({
        snapshot,
        suggestedName: "Kimix 会话快照",
      });
      if (!res.success) {
        setMigrationMessage(`导出失败：${res.error}`);
        return;
      }
      setMigrationMessage(res.data.path
        ? `已导出 ${snapshot.sessions.length} 个会话，其中 ${snapshot.sessions.filter((session) => Boolean((session as { archivedAt?: unknown }).archivedAt)).length} 个保持归档。`
        : "已取消导出。");
    } catch (error) {
      setMigrationMessage(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMigrationBusy(null);
    }
  };

  const runImportSessionBackup = async (filePath?: string) => {
    setMigrationBusy("import");
    setMigrationMessage(filePath ? "正在读取拖入的会话快照..." : "正在读取会话快照...");
    try {
      const res = await window.api.importSessionBackup(filePath ? { path: filePath } : undefined);
      if (!res.success) {
        setMigrationMessage(`导入失败：${res.error}`);
        return;
      }
      if (res.data.canceled || !res.data.path) {
        setMigrationMessage("已取消导入。");
        return;
      }
      const plan = createSessionBackupImportPlan(res.data.snapshot);
      if (!hasSessionBackupImportChanges(plan.stats)) {
        setMigrationMessage("快照里没有比本机更新的可导入内容。");
        return;
      }
      const ok = window.confirm(formatSessionBackupImportSummary(plan));
      if (!ok) {
        setMigrationMessage("已取消合并导入。");
        return;
      }
      await applySessionBackupImportPlan(plan);
      const successMessage = `已合并导入：新增 ${plan.stats.addedSessions} 个会话，更新 ${plan.stats.updatedSessions} 个会话，分叉副本 ${plan.stats.forkedSessions} 个，归档记录 ${plan.stats.archivedTombstones} 条。`;
      setMigrationMessage(successMessage);
      window.alert(successMessage);
    } catch (error) {
      setMigrationMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMigrationBusy(null);
    }
  };

  const handleImportSessionBackup = async () => {
    await runImportSessionBackup();
  };

  const handleMigrationDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    if (!migrationBusy) setMigrationDragActive(true);
  };

  const handleMigrationDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setMigrationDragActive(false);
    if (migrationBusy) return;
    const file = Array.from(event.dataTransfer.files)[0];
    const filePath = file && typeof window.api.getDraggedFilePath === "function"
      ? window.api.getDraggedFilePath(file)
      : "";
    if (!filePath) {
      setMigrationMessage("没有拿到拖入文件路径，请使用“合并导入”按钮选择快照。");
      return;
    }
    if (!/\.(zip|json)$/i.test(filePath)) {
      setMigrationMessage("请拖入 .zip 或 .json 格式的 Kimix 会话快照。");
      return;
    }
    void runImportSessionBackup(filePath);
  };

  const refreshExperimentalSettings = async () => {
    setExperimentalSettingsLoading(true);
    const res = await window.api.getSettings();
    setExperimentalSettingsLoading(false);
    if (!res.success) {
      setExperimentalSettingsMessage(`读取 Server 路由失败：${res.error}`);
      return;
    }
    setExperimentalKimiServer(Boolean(res.data.experimentalKimiServer));
    setExperimentalKimiServerSessions(Boolean(res.data.experimentalKimiServerSessions));
    setExperimentalSettingsMessage("修改后需要完全重启 Kimix 才会影响新会话路由。");
  };

  const saveExperimentalSettings = async (next: { server?: boolean; sessions?: boolean }) => {
    const serverEnabled = next.server ?? experimentalKimiServer;
    const sessionsEnabled = next.sessions ?? experimentalKimiServerSessions;
    const normalizedSessionsEnabled = serverEnabled ? sessionsEnabled : false;
    setExperimentalKimiServer(serverEnabled);
    setExperimentalKimiServerSessions(normalizedSessionsEnabled);
    setExperimentalSettingsSaving(true);
    const res = await window.api.saveSettings({
      experimentalKimiServer: serverEnabled,
      experimentalKimiServerSessions: normalizedSessionsEnabled,
    });
    setExperimentalSettingsSaving(false);
    if (res.success) {
      setExperimentalSettingsMessage("已保存；完全关闭并重新打开 Kimix 后生效。");
      return;
    }
    setExperimentalSettingsMessage(`保存 Server 路由失败：${res.error}`);
    void refreshExperimentalSettings();
  };

  useEffect(() => {
    if (settingsOpen || variant === "workspace") {
      if (!settingsStatusCache.connection) void checkConnection(false);
      if (!settingsStatusCache.auth) void refreshAuth();
      if (!settingsStatusCache.modelConfig) void refreshModelConfig();
      void refreshExperimentalSettings();
      loadFreezeReports();
    }
  }, [settingsOpen, variant]);

  useEffect(() => {
    const handleAuthChanged = () => {
      if (settingsOpen || variant === "workspace") {
        void refreshAuth({ showLoading: false });
        void refreshModelConfig({ showLoading: false });
      }
    };
    window.addEventListener(KIMI_AUTH_CHANGED_EVENT, handleAuthChanged);
    return () => window.removeEventListener(KIMI_AUTH_CHANGED_EVENT, handleAuthChanged);
  }, [settingsOpen, variant]);

  useEffect(() => {
    const handleFocusModelSettings = () => {
      window.setTimeout(() => {
        modelSettingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    };
    window.addEventListener("kimix:focus-model-settings", handleFocusModelSettings);
    return () => window.removeEventListener("kimix:focus-model-settings", handleFocusModelSettings);
  }, []);

  useEffect(() => {
    const handleFocusAuthSettings = () => {
      void refreshAuth({ showLoading: false });
      window.setTimeout(() => {
        authSettingsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
    };
    window.addEventListener("kimix:focus-auth-settings", handleFocusAuthSettings);
    return () => window.removeEventListener("kimix:focus-auth-settings", handleFocusAuthSettings);
  }, []);

  if (!settingsPresence.mounted && variant === "modal") return null;

  const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "system", label: "跟随系统", icon: Monitor },
  ];
  const paletteOptions: { value: ThemePaletteId; label: string; description: string; colors: ThemePaletteColors; kimiId?: string; sourcePath?: string }[] = [
    ...THEME_PALETTES.map((palette) => ({
      value: palette.id,
      label: palette.label,
      description: palette.description,
      colors: palette.colors,
    })),
    {
      value: "custom",
      label: "自定义",
      description: "使用下方三色生成明暗两套配色",
      colors: customThemePalette,
    },
    ...kimiThemePalettes.map((preset) => ({
      value: kimiThemePaletteId(preset.id),
      label: preset.displayName.startsWith("KIMI-") ? preset.displayName : `KIMI-${preset.displayName}`,
      description: "使用官方 Kimi Code 主题 token",
      colors: preset.colors ?? {
        primary: preset.palette.primary,
        surface: preset.palette.textMuted,
        accent: preset.palette.accent,
      },
      kimiId: preset.id,
      sourcePath: preset.path,
    })),
  ];

  const permissions: { value: PermissionMode; label: string; desc: string; icon: typeof Shield; tooltip: string }[] = [
    { value: "manual", label: "手动审批", desc: "高风险操作会先问你", icon: Shield, tooltip: "手动审批：高风险工具调用会暂停确认。" },
    { value: "auto", label: "自动权限", desc: "少提问，自动继续推进", icon: Zap, tooltip: "自动权限：少问用户，Plan 和问题会尽量自动继续。" },
    { value: "yolo", label: "完全访问", desc: "工具权限最高，谨慎使用", icon: GitBranch, tooltip: "完全访问：自动批准所有工具请求，最少触发工具审批。" },
  ];
  const notificationModes: { value: NotificationMode; label: string; desc: string }[] = [
    { value: "never", label: "永不弹出", desc: "不显示系统通知，也不显示任务栏红点" },
    { value: "unfocused", label: "无焦点时", desc: "仅 Kimix 窗口没有焦点时提醒" },
    { value: "always", label: "任何时候", desc: "每轮完成都弹出系统通知；红点仍只在无焦点时显示" },
  ];
  const archivedSessions = [...archivedSessionSummaries]
    .sort((a, b) => b.archivedAt - a.archivedAt);
  const visibleArchivedSessions = archivedExpanded ? archivedSessions : archivedSessions.slice(0, SETTINGS_PREVIEW_ITEM_LIMIT);
  const expandableArchivedCount = Math.max(0, archivedSessions.length - visibleArchivedSessions.length);
  const canToggleArchivedList = archivedSessions.length > SETTINGS_PREVIEW_ITEM_LIMIT;
  const visibleFreezeReports = freezeExpanded ? freezeReports : freezeReports.slice(0, SETTINGS_PREVIEW_ITEM_LIMIT);
  const hiddenFreezeCount = Math.max(0, freezeReports.length - SETTINGS_PREVIEW_ITEM_LIMIT);
  const [migrationSessionCount = 0, migrationArchivedCount = 0, migrationPendingCount = 0, migrationProjectCount = 0] = migrationCountsDigest
    .split("|")
    .map((value) => Number(value) || 0);

  const handleDeleteArchivedSession = (session: ArchivedSessionSummary) => {
    const ok = window.confirm(`从 Kimix 本机移除归档记录「${session.title}」？官方归档状态不会改变。`);
    if (!ok) return;
    deleteSession(session.id);
    const current = useAppStore.getState().currentSession;
    if (current?.id === session.id) setCurrentSession(null);
  };

  const content = (
      <div className={variant === "workspace" ? "kimix-settings-panel is-workspace" : `kimix-settings-panel kimix-presence-content ${settingsPresence.visible ? "is-visible" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className={variant === "workspace" ? "kimix-workspace-header" : "kimix-settings-header"}>
          <div className={variant === "workspace" ? "kimix-workspace-header-copy" : "min-w-0"}>
            <div className={variant === "workspace" ? "kimix-workspace-header-title" : "flex min-w-0 items-center gap-2.5 text-[20px] font-semibold leading-7 text-[var(--kimix-panel-text)]"}>
              {variant === "workspace" && <Settings size={20} className="shrink-0" />}
              <h2 id="settings-title" className="kimix-settings-title">设置</h2>
              {variant === "workspace" && (
                <div className="kimix-workspace-header-subtitle">管理模型、主题、权限和本地诊断。</div>
              )}
            </div>
          </div>
          <div className={variant === "workspace" ? "kimix-workspace-header-actions" : "flex shrink-0 items-center"} style={variant === "workspace" ? undefined : { gap: 8 }}>
            {onBackToChat && variant === "workspace" && (
              <button
                type="button"
                onClick={onBackToChat}
                className="kimix-icon-text-button kimix-muted-action is-compact"
                style={{ marginLeft: 4 }}
              >
                返回对话
              </button>
            )}
            {variant === "modal" && (
              <button onClick={() => setSettingsOpen(false)} className="kimix-settings-icon-button" aria-label="关闭设置">
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        <div className="kimix-settings-body">
          <div className={`kimix-settings-columns ${variant === 'workspace' ? 'is-workspace' : ''}`}>
            <div className="kimix-settings-col">
              <div className="kimix-settings-section" {...settingsSectionProps("theme", 3)}>
                <div className="kimix-settings-section-title">
                  <Sun size={16} className="text-text-muted" />
                  <span>主题</span>
                  {settingsDragHandle("theme", "主题")}
                </div>
                <div className="kimix-settings-theme-grid">
                  {themes.map((t) => (
                    <button key={t.value} onClick={() => setTheme(t.value)} className={`kimix-settings-theme ${theme === t.value ? "is-active" : ""}`}>
                      <t.icon size={18} />
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
                <div className="kimix-settings-subsection-row">
                  <div className="kimix-settings-subsection-title">色彩方案</div>
                  <button
                    type="button"
                    onClick={() => void scanOfficialKimiThemes()}
                    className="kimix-icon-text-button kimix-muted-action is-compact"
                    disabled={themeScanLoading}
                  >
                    {themeScanLoading ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                    <span>扫描官方主题</span>
                  </button>
                </div>
                <div className="kimix-settings-palette-grid">
                  {paletteOptions.map((palette) => (
                    <div
                      key={palette.value}
                      className={`kimix-settings-palette-wrap ${themePalette === palette.value ? "is-active" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => setThemePalette(palette.value)}
                        className="kimix-settings-palette"
                        title={palette.description}
                      >
                        <span className="kimix-settings-palette-copy">
                          <span className="kimix-settings-palette-label" title={palette.label}>{palette.label}</span>
                          <span className="kimix-settings-palette-desc">{palette.description}</span>
                        </span>
                        <span className="kimix-settings-palette-swatches" aria-hidden="true">
                          <span style={{ background: palette.colors.surface }} />
                          <span style={{ background: palette.colors.primary }} />
                          <span style={{ background: palette.colors.accent }} />
                        </span>
                      </button>
                      {palette.kimiId && (
                        <div className="kimix-settings-palette-actions">
                          <button
                            type="button"
                            className="kimix-settings-palette-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              removeThemeFromKimix(palette.kimiId!, palette.label);
                            }}
                            disabled={themeDeleteBusyId === palette.kimiId}
                            title={`仅从 Kimix 移除 ${palette.label}`}
                            aria-label={`仅从 Kimix 移除 ${palette.label}`}
                          >
                            <Unlink size={14} />
                          </button>
                          {palette.sourcePath && (
                            <button
                              type="button"
                              className="kimix-settings-palette-action is-danger"
                              onClick={(event) => {
                                event.stopPropagation();
                                void deleteThemeSource(palette.kimiId!, palette.label, palette.sourcePath!);
                              }}
                              disabled={themeDeleteBusyId === palette.kimiId}
                              title={`删除源文件 ${palette.label}`}
                              aria-label={`删除主题源文件 ${palette.label}`}
                            >
                              {themeDeleteBusyId === palette.kimiId
                                ? <RefreshCw size={14} className="animate-spin" />
                                : <Trash2 size={14} />}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {themeScanMessage && (
                  <div className="kimix-settings-theme-scan-message">{themeScanMessage}</div>
                )}
                {themePalette === "custom" && (
                  <div className="kimix-settings-custom-palette is-kimi">
                    {([
                      ["primary", "主色"],
                      ["surface", "底色"],
                      ["accent", "强调"],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="kimix-settings-color-field is-kimi-token">
                        <span>{label}</span>
                        <span
                          className="kimix-settings-color-swatch-button"
                          style={{ background: customThemePalette[key] }}
                        >
                          <input
                            type="color"
                            value={customThemePalette[key]}
                            onChange={(event) => updateCustomThemeColor(key, event.target.value)}
                            aria-label={`${label}颜色`}
                          />
                        </span>
                        <input
                          value={customThemePalette[key]}
                          onChange={(event) => updateCustomThemeColor(key, event.target.value)}
                          className="kimix-settings-color-value"
                          spellCheck={false}
                        />
                      </label>
                    ))}
                  </div>
                )}
                {activeKimiTheme && (
                  <div className="kimix-settings-custom-palette is-kimi">
                    {([
                      ["primary", "主色"],
                      ["accent", "强调"],
                      ["text", "正文"],
                      ["textStrong", "强文本"],
                      ["textDim", "弱文本"],
                      ["textMuted", "静默"],
                      ["border", "边框"],
                      ["borderFocus", "焦点"],
                      ["success", "成功"],
                      ["warning", "警告"],
                      ["error", "错误"],
                      ["roleUser", "用户"],
                    ] as const).map(([key, label]) => (
                      <div key={key} className="kimix-settings-color-field is-kimi-token">
                        <span>{label}</span>
                        <span
                          aria-hidden="true"
                          className="h-7 w-9 rounded-lg border border-[var(--kimix-panel-border-soft)]"
                          style={{ background: activeKimiTheme.palette[key] }}
                        />
                        <span className="kimix-settings-color-value select-text">{activeKimiTheme.palette[key]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="kimix-settings-section" {...settingsSectionProps("permission", 4)}>
                <div className="kimix-settings-section-title">
                  <Shield size={16} className="text-text-muted" />
                  <span>权限模式</span>
                  {settingsDragHandle("permission", "权限模式")}
                </div>
                <div className="kimix-settings-permissions">
                  {permissions.map((p) => (
                    <button key={p.value} title={p.tooltip} onClick={() => setPermissionMode(p.value)} className={`kimix-settings-permission ${permissionMode === p.value ? "is-active" : ""}`}>
                      <SelectionIndicator selected={permissionMode === p.value} />
                      <p.icon size={18} className={`mt-0.5 shrink-0 ${permissionMode === p.value ? "text-accent-primary" : "text-text-muted"}`} />
                      <div className="kimix-settings-permission-copy">
                        <div className="kimix-settings-permission-label">{p.label}</div>
                        <div className="kimix-settings-permission-desc">{p.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="kimix-settings-section" {...settingsSectionProps("message", 6)}>
                <div className="kimix-settings-section-title">
                  <MessageSquare size={16} className="text-text-muted" />
                  <span>消息信息</span>
                  {settingsDragHandle("message", "消息信息")}
                </div>
                <div className="kimix-settings-permissions">
                  <button onClick={() => setStatusUpdateDisplay("turn_end")} className={`kimix-settings-permission ${statusUpdateDisplay === "turn_end" ? "is-active" : ""}`}>
                    <SelectionIndicator selected={statusUpdateDisplay === "turn_end"} />
                    <div className="kimix-settings-permission-copy">
                      <div className="kimix-settings-permission-label">每轮末尾显示一次</div>
                      <div className="kimix-settings-permission-desc">默认选项，只保留本轮最后一条 Tokens 和 Context 信息</div>
                    </div>
                  </button>
                  <button onClick={() => setStatusUpdateDisplay("each")} className={`kimix-settings-permission ${statusUpdateDisplay === "each" ? "is-active" : ""}`}>
                    <SelectionIndicator selected={statusUpdateDisplay === "each"} />
                    <div className="kimix-settings-permission-copy">
                      <div className="kimix-settings-permission-label">实时显示每条消息信息</div>
                      <div className="kimix-settings-permission-desc">适合调试上下文增长，会在对话中多次显示状态胶囊</div>
                    </div>
                  </button>
                  <button onClick={() => setStatusUpdateDisplay("never")} className={`kimix-settings-permission ${statusUpdateDisplay === "never" ? "is-active" : ""}`}>
                    <SelectionIndicator selected={statusUpdateDisplay === "never"} />
                    <div className="kimix-settings-permission-copy">
                      <div className="kimix-settings-permission-label">永不显示</div>
                      <div className="kimix-settings-permission-desc">对话中完全隐藏 Tokens 和 Context 信息</div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="kimix-settings-section" {...settingsSectionProps("filePreview", 7)}>
                <div className="kimix-settings-section-title">
                  <FileText size={16} className="text-text-muted" />
                  <span>文件预览</span>
                  {settingsDragHandle("filePreview", "文件预览")}
                </div>
                <div className="kimix-settings-card" style={{ padding: "16px 16px 18px" }}>
                  <label className="kimix-settings-permission-label block" htmlFor="file-preview-extensions">
                    允许预览的文件类型
                  </label>
                  <div className="kimix-settings-permission-desc" style={{ marginTop: 6 }}>
                    仅扫描项目根目录第一层，文件大小超过 1 MB 会自动跳过。
                  </div>
                  <input
                    id="file-preview-extensions"
                    value={filePreviewExtensionDraft}
                    onChange={(event) => setFilePreviewExtensionDraft(event.target.value)}
                    onBlur={() => setFilePreviewExtensions(normalizeFilePreviewExtensions(filePreviewExtensionDraft))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                    className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                    style={{ marginTop: 12, paddingLeft: 12, paddingRight: 12 }}
                    placeholder="md, txt"
                  />
                  <div className="flex flex-wrap" style={{ gap: 8, marginTop: 12 }}>
                    {FILE_PREVIEW_EXTENSION_OPTIONS.map((extension) => {
                      const selected = filePreviewExtensions.includes(extension);
                      return (
                        <button
                          key={extension}
                          type="button"
                          onClick={() => {
                            const next = selected
                              ? filePreviewExtensions.filter((item) => item !== extension)
                              : [...filePreviewExtensions, extension];
                            setFilePreviewExtensions(normalizeFilePreviewExtensions(next.length > 0 ? next : ["md", "txt"]));
                          }}
                          className={`kimix-icon-text-button is-compact ${selected ? "bg-accent-primary-light text-accent-primary" : "kimix-muted-action"}`}
                          style={{ minHeight: 32, paddingLeft: 12, paddingRight: 12 }}
                        >
                          .{extension}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="kimix-settings-section" {...settingsSectionProps("newSession", 8)}>
                <div className="kimix-settings-section-title">
                  <MessageSquare size={16} className="text-text-muted" />
                  <span>新对话建议</span>
                  {settingsDragHandle("newSession", "新对话建议")}
                </div>
                <div
                  className={`kimix-settings-card ${sessionRecommendationEnabled ? "is-active" : ""}`}
                  style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 112px", gap: 16, alignItems: "center", padding: "14px 16px" }}
                >
                  <button
                    type="button"
                    onClick={() => setSessionRecommendationEnabled(!sessionRecommendationEnabled)}
                    className="flex min-w-0 items-center text-left"
                    style={{ gap: 12 }}
                  >
                    <SelectionIndicator selected={sessionRecommendationEnabled} />
                    <div className="min-w-0 flex-1">
                      <label htmlFor="session-turn-limit" className="kimix-settings-permission-label block">达到推荐轮数后提示开启新对话</label>
                      <div className="kimix-settings-permission-desc">默认用于减少长会话里旧上下文和无用信息的干扰。</div>
                    </div>
                  </button>
                  <div className="min-w-0">
                    <div className="mb-1 text-right text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">轮数上限</div>
                    <input
                      id="session-turn-limit"
                      type="number"
                      min={1}
                      max={200}
                      value={sessionRecommendationTurnLimit}
                      disabled={!sessionRecommendationEnabled}
                      onChange={(event) => setSessionRecommendationTurnLimit(Number(event.target.value || 1))}
                      className="kimix-settings-input kimix-number-input h-9 w-full rounded-lg text-center text-[14px] outline-none transition-colors"
                    />
                  </div>
                </div>
              </div>

              <div className="kimix-settings-section" {...settingsSectionProps("archived", 11)}>
                <div className="kimix-settings-row-title">
                  <div className="kimix-settings-section-title">
                    <Archive size={16} className="text-text-muted" />
                    <span>归档对话</span>
                  </div>
                  <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                    <span className="kimix-settings-badge text-[12.5px] leading-5" style={{ paddingLeft: 10, paddingRight: 10 }}>
                      {archivedSessions.length}
                    </span>
                    {settingsDragHandle("archived", "归档对话")}
                  </div>
                </div>
                <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
                  {archivedSessions.length > 0 ? (
                    <div className="flex flex-col" style={{ gap: 10 }}>
                      {visibleArchivedSessions.map((session) => (
                        <div
                          key={session.id}
                          className="kimix-settings-list-item grid min-w-0 items-center"
                          style={{ gridTemplateColumns: "minmax(0, 1fr) auto", columnGap: 12, padding: "12px 12px 12px 14px" }}
                        >
                          <div className="flex min-w-0 items-start" style={{ gap: 10 }}>
                            <MessageSquare size={15} className="mt-0.5 shrink-0 text-text-muted" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[14px] font-medium leading-5 text-[var(--kimix-panel-text)]">{session.title}</div>
                              <div className="mt-0.5 truncate text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">{session.projectPath}</div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center justify-end" style={{ gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => handleDeleteArchivedSession(session)}
                              className="kimix-icon-text-button is-compact shrink-0 text-accent-danger hover:bg-accent-danger-light"
                              style={{ minWidth: 70, justifyContent: "center" }}
                            >
                              <Trash2 size={13} />
                              移除记录
                            </button>
                          </div>
                        </div>
                      ))}
                      {canToggleArchivedList && (
                        <button
                          type="button"
                          onClick={() => setArchivedExpanded((current) => !current)}
                          className="kimix-icon-text-button kimix-muted-action is-compact self-start"
                          style={{ marginTop: 2 }}
                        >
                          {archivedExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          <span>{archivedExpanded ? `收起归档列表，仅保留最近 ${SETTINGS_PREVIEW_ITEM_LIMIT} 个` : `展开剩余 ${expandableArchivedCount} 个归档对话`}</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-[13.5px] leading-6 text-[var(--kimix-panel-text-secondary)]">暂无归档对话。</div>
                  )}
                </div>
              </div>

              <div className="kimix-settings-section" {...settingsSectionProps("migration", 12)}>
                <div className="kimix-settings-row-title">
                  <div className="kimix-settings-section-title">
                    <Download size={16} className="text-text-muted" />
                    <span>会话迁移</span>
                  </div>
                  {settingsDragHandle("migration", "会话迁移")}
                </div>
                <div
                  className={`kimix-settings-card ${migrationDragActive ? "is-active" : ""}`}
                  onDragEnter={handleMigrationDragOver}
                  onDragOver={handleMigrationDragOver}
                  onDragLeave={() => setMigrationDragActive(false)}
                  onDrop={handleMigrationDrop}
                  style={{
                    padding: "18px 16px",
                    borderColor: migrationDragActive ? "var(--accent-primary)" : undefined,
                    background: migrationDragActive ? "var(--accent-primary-light)" : undefined,
                  }}
                >
                  <div className="grid min-w-0 items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", columnGap: 14 }}>
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-medium leading-5 text-[var(--kimix-panel-text)]">导出全部，合并导入</div>
                      <div className="mt-1 text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                        当前可迁移 {migrationSessionCount} 个会话、{migrationArchivedCount} 个归档、{migrationPendingCount} 条待发送队列、{migrationProjectCount} 个项目。
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-end" style={{ gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => void handleExportSessionBackup()}
                        disabled={Boolean(migrationBusy)}
                        className="kimix-icon-text-button is-compact border border-[var(--kimix-panel-border-soft)] text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
                        style={{ minWidth: 92, justifyContent: "center" }}
                      >
                        {migrationBusy === "export" ? <RefreshCw size={14} className="kimix-spin" /> : <Download size={14} />}
                        <span>导出全部</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleImportSessionBackup()}
                        disabled={Boolean(migrationBusy)}
                        className="kimix-icon-text-button is-compact border border-[var(--kimix-panel-border-soft)] text-accent-primary hover:bg-accent-primary-light disabled:cursor-wait disabled:opacity-55"
                        style={{ minWidth: 92, justifyContent: "center" }}
                      >
                        {migrationBusy === "import" ? <RefreshCw size={14} className="kimix-spin" /> : <Upload size={14} />}
                        <span>合并导入</span>
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 12 }}>
                    导入会按会话 id、官方 id 和 runtime id 去重；可拖入 .zip/.json 快照，新机器上的归档会话会继续保持归档，本机已有的新内容优先保留。
                  </div>
                  {migrationMessage && (
                    <div className="kimix-settings-theme-scan-message" style={{ marginTop: 12 }}>
                      {migrationMessage}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="kimix-settings-col">
              <div className="kimix-settings-section" {...settingsSectionProps("connection", 0)}>
                <div className="kimix-settings-row-title">
                  <div className="kimix-settings-section-title">
                    <Terminal size={16} className="text-text-muted" />
                    <span>连接情况</span>
                  </div>
                  <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                    <button onClick={() => void checkConnection(Boolean(connection.path), { showLoading: true })} disabled={connection.loading} className="kimix-settings-check-button" title={connection.path ? "检查 Kimi Code 响应" : "查找 Kimi Code"}>
                      <RefreshCw size={15} className={connection.loading ? "kimix-spin" : ""} />
                      <span>检查</span>
                    </button>
                    {settingsDragHandle("connection", "连接情况")}
                  </div>
                </div>
                <div className={`kimix-settings-connection ${connection.verified ? "is-verified" : connection.available ? "is-found" : "is-missing"}`}>
                  <div className="kimix-settings-connection-inner">
                    {connection.loading ? (
                      <RefreshCw size={18} className="kimix-spin mt-0.5 shrink-0 text-text-muted" />
                    ) : connection.verified ? (
                      <SelectionIndicator selected />
                    ) : connection.available ? (
                      <SelectionIndicator selected />
                    ) : (
                      <AlertCircle size={18} className="mt-0.5 shrink-0 text-accent-warning" />
                    )}
                    <div className="kimix-settings-connection-copy">
                      <div className="kimix-settings-connection-label">
                        {connection.loading ? "检测中" : connection.verified ? "Kimi Code 连接正常" : connection.available ? "已找到 Kimi Code" : "Kimi Code 未连接"}
                      </div>
                      <div className="kimix-settings-connection-detail">{connection.output ?? connection.path ?? connection.message}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="kimix-settings-section" {...settingsSectionProps("auth", 1, authSettingsRef)}>
                <div className="kimix-settings-row-title">
                  <div className="kimix-settings-section-title">
                    {auth?.loggedIn ? <ShieldCheck size={16} className="text-accent-success" /> : <ShieldX size={16} className="text-text-muted" />}
                    <span>Kimi 登录</span>
                  </div>
                  <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => void refreshAuth({ showLoading: true })}
                      disabled={authLoading || Boolean(authBusyAction)}
                      className="kimix-settings-check-button"
                    >
                      <RefreshCw size={15} className={authLoading ? "kimix-spin" : ""} />
                      <span>刷新</span>
                    </button>
                    {settingsDragHandle("auth", "Kimi 登录")}
                  </div>
                </div>
                <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
                  <div className="flex items-start" style={{ gap: 12 }}>
                    {authLoading ? (
                      <RefreshCw size={18} className="kimix-spin mt-0.5 shrink-0 text-text-muted" />
                    ) : auth?.loggedIn ? (
                      <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent-success" />
                    ) : (
                      <ShieldX size={18} className="mt-0.5 shrink-0 text-accent-danger" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] font-medium text-[var(--kimix-panel-text)]">
                        {authLoading ? "正在读取登录状态" : auth?.loggedIn ? "Kimi Code 已登录" : "Kimi Code 未登录"}
                      </div>
                      <div className="mt-1 text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                        {auth?.message ?? "登录状态会影响对话、MCP OAuth 授权和 Kimi Code 调用。"}
                      </div>
                      {auth?.path && (
                        <div className="mt-2 break-all text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">{auth.path}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap" style={{ gap: 8, marginTop: 14 }}>
                    {auth?.loggedIn ? (
                      <button
                        type="button"
                        onClick={() => void handleLogout()}
                        disabled={Boolean(authBusyAction) || authLoading || !auth?.available}
                        className="kimix-icon-text-button is-compact border border-[var(--kimix-panel-border-soft)] text-accent-danger hover:bg-accent-danger-light disabled:cursor-wait disabled:opacity-55"
                      >
                        <LogOut size={14} />
                        <span>{authBusyAction === "logout" ? "退出中" : "退出登录"}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleLogin()}
                        disabled={Boolean(authBusyAction) || authLoading || !auth?.available}
                        className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-wait disabled:opacity-55"
                      >
                        <LogIn size={14} />
                        <span>{authBusyAction === "login" ? "登录中" : "登录"}</span>
                      </button>
                    )}
                  </div>

                </div>
              </div>

              <div className="kimix-settings-section" {...settingsSectionProps("experiment", 2)}>
                <div className="kimix-settings-row-title">
                  <div className="kimix-settings-section-title">
                    <Zap size={16} className="text-text-muted" />
                    <span>Kimi Server 路由</span>
                  </div>
                  <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => void refreshExperimentalSettings()}
                      disabled={experimentalSettingsLoading || experimentalSettingsSaving}
                      className="kimix-settings-check-button"
                    >
                      <RefreshCw size={15} className={experimentalSettingsLoading ? "kimix-spin" : ""} />
                      <span>刷新</span>
                    </button>
                    {settingsDragHandle("experiment", "Kimi Server 路由")}
                  </div>
                </div>
                <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
                  <div className="flex items-start" style={{ gap: 12 }}>
                    <Zap size={18} className="mt-0.5 shrink-0 text-text-muted" />
                    <div className="kimix-settings-permission-copy">
                      <div className="kimix-settings-permission-label">Kimi Code Server 默认路由</div>
                      <div className="kimix-settings-permission-desc">
                        新安装默认使用官方 Server；不可用时自动回退兼容链路。保存后需要完全重启 Kimix 才会影响新会话。
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col" style={{ gap: 10, marginTop: 14 }}>
                    <button
                      type="button"
                      onClick={() => void saveExperimentalSettings({ server: !experimentalKimiServer })}
                      disabled={experimentalSettingsLoading || experimentalSettingsSaving}
                      className={`kimix-settings-permission ${experimentalKimiServer ? "is-active" : ""}`}
                      style={{ padding: "13px 14px", gridTemplateColumns: "auto minmax(0, 1fr) auto" }}
                    >
                      <SelectionIndicator selected={experimentalKimiServer} />
                      <div className="kimix-settings-permission-copy">
                        <div className="kimix-settings-permission-label">启用官方 Kimi Code Server</div>
                        <div className="kimix-settings-permission-desc">
                          允许 Kimix 启动或连接官方本地 Server；关闭后使用兼容链路，不再启动 Server。
                        </div>
                      </div>
                      <span className={`rounded-full text-[11.5px] leading-5 ${experimentalKimiServer ? "bg-accent-primary text-white" : "bg-[var(--kimix-panel-badge-bg)] text-[var(--kimix-panel-badge-text)]"}`} style={{ height: 24, paddingLeft: 10, paddingRight: 10, display: "flex", alignItems: "center" }}>
                        {experimentalKimiServer ? "已开启" : "关闭"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveExperimentalSettings({ sessions: !experimentalKimiServerSessions })}
                      disabled={experimentalSettingsLoading || experimentalSettingsSaving || !experimentalKimiServer}
                      className={`kimix-settings-permission ${experimentalKimiServerSessions ? "is-active" : ""}`}
                      style={{ padding: "13px 14px", gridTemplateColumns: "auto minmax(0, 1fr) auto", opacity: experimentalKimiServer ? 1 : 0.62 }}
                    >
                      <SelectionIndicator selected={experimentalKimiServerSessions} />
                      <div className="kimix-settings-permission-copy">
                        <div className="kimix-settings-permission-label">新会话使用 Server 路由</div>
                        <div className="kimix-settings-permission-desc">
                          新会话优先使用官方 Server；异常时自动使用兼容链路，对话里只显示简洁发送状态。
                        </div>
                      </div>
                      <span className={`rounded-full text-[11.5px] leading-5 ${experimentalKimiServerSessions ? "bg-accent-primary text-white" : "bg-[var(--kimix-panel-badge-bg)] text-[var(--kimix-panel-badge-text)]"}`} style={{ height: 24, paddingLeft: 10, paddingRight: 10, display: "flex", alignItems: "center" }}>
                        {experimentalKimiServerSessions ? "已开启" : "关闭"}
                      </span>
                    </button>
                  </div>
                  <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-base text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ padding: "12px 14px", marginTop: 14 }}>
                    {experimentalSettingsMessage || "读取 Server 路由状态中..."}
                  </div>
                </div>
              </div>

              <div className="kimix-settings-section" {...settingsSectionProps("model", 3, modelSettingsRef)}>
                <div className="kimix-settings-row-title">
                  <div className="kimix-settings-section-title">
                    <Terminal size={16} className="text-text-muted" />
                    <span>模型配置</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-end" style={{ gap: 8, paddingLeft: 12 }}>
                    <button
                      type="button"
                      onClick={() => void handleDoctorModelConfig()}
                      disabled={modelDoctorLoading}
                      className="kimix-settings-check-button"
                    >
                      <Terminal size={15} className={modelDoctorLoading ? "kimix-spin" : ""} />
                      <span>诊断</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void refreshModelConfig({ showLoading: true })}
                      disabled={modelConfigLoading}
                      className="kimix-settings-check-button"
                    >
                      <RefreshCw size={15} className={modelConfigLoading ? "kimix-spin" : ""} />
                      <span>刷新</span>
                    </button>
                    {settingsDragHandle("model", "模型配置")}
                  </div>
                </div>
                <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
                  <div className="flex items-start" style={{ gap: 12 }}>
                    <Terminal size={18} className="mt-0.5 shrink-0 text-text-muted" />
                    <div className="kimix-settings-permission-copy">
                      <div className="kimix-settings-permission-label">Kimi Code 模型配置</div>
                      <div className="kimix-settings-permission-desc">
                        {modelConfig?.configPath ?? "正在读取 Kimi Code config.toml"}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col" style={{ gap: 10, marginTop: 14 }}>
                    {modelConfigLoading ? (
                      <div className="kimix-settings-permission-desc">正在读取模型配置...</div>
                    ) : modelConfig && modelConfig.exists ? (
                      <>
                        <div className="grid min-w-0" style={{ gridTemplateColumns: "92px minmax(0, 1fr)", gap: 10 }}>
                          <div className="kimix-settings-permission-desc" style={{ marginTop: 0 }}>当前使用</div>
                          <div className="kimix-settings-permission-label break-all text-[13px]">{modelConfig.defaultModel ?? "未设置"}</div>
                        </div>
                        <div className="grid min-w-0" style={{ gridTemplateColumns: "92px minmax(0, 1fr)", gap: 10 }}>
                          <div className="kimix-settings-permission-desc" style={{ marginTop: 0 }}>Provider</div>
                          <div className="kimix-settings-permission-label text-[13px]">
                            {modelConfig.providers.length} 个，{modelConfig.providers.filter((provider) => provider.hasApiKey || provider.hasOauth).length} 个已配置凭据
                          </div>
                        </div>
                        {serverModelCatalog && (
                          <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-base" style={{ padding: "14px 16px", marginTop: 4 }}>
                            <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                              <div className="min-w-0">
                                <div className="kimix-settings-permission-label">Server 运行时目录</div>
                                <div className="kimix-settings-permission-desc">
                                  {serverModelCatalog.models.length} 个模型 · {serverModelCatalog.providers.length} 个 Provider · 脱敏配置
                                </div>
                              </div>
                              <span className={`rounded-full text-[11.5px] leading-5 ${serverModelCatalog.auth.ready ? "bg-accent-success-light text-accent-success" : "bg-accent-warning-light text-accent-warning"}`} style={{ height: 26, paddingLeft: 10, paddingRight: 10, display: "flex", alignItems: "center" }}>
                                {serverModelCatalog.auth.ready ? "认证就绪" : "认证未就绪"}
                              </span>
                            </div>
                            <div className="flex flex-col" style={{ gap: 8, marginTop: 12 }}>
                              {serverModelCatalog.models.slice(0, 4).map((model) => (
                                <div key={`${model.provider}:${model.model}`} className="rounded-lg bg-surface-elevated" style={{ padding: "10px 12px" }}>
                                  <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                                    <div className="min-w-0">
                                      <div className="truncate text-[12.5px] font-medium leading-5 text-text-primary">{model.displayName || model.model}</div>
                                      <div className="truncate text-[11.5px] leading-5 text-text-muted">{model.provider} · Context {model.maxContextSize.toLocaleString()}</div>
                                    </div>
                                    <span className="rounded-full bg-[var(--kimix-panel-badge-bg)] text-[10.5px] leading-5 text-[var(--kimix-panel-badge-text)]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                                      {model.capabilities.includes("thinking") ? "支持思考" : "标准"}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="flex flex-wrap" style={{ gap: 8, marginTop: 10 }}>
                              {serverModelCatalog.providers.map((provider) => (
                                <span key={provider.id} className={`rounded-full text-[11px] leading-5 ${provider.status === "connected" ? "bg-accent-success-light text-accent-success" : "bg-accent-warning-light text-accent-warning"}`} style={{ paddingLeft: 9, paddingRight: 9 }}>
                                  {provider.id} · {provider.status === "connected" ? "已连接" : provider.status}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {kimiEnvironment && (
                          <>
                            <div className="grid min-w-0" style={{ gridTemplateColumns: "92px minmax(0, 1fr)", gap: 10 }}>
                              <div className="kimix-settings-permission-desc" style={{ marginTop: 0 }}>Code Home</div>
                              <div className="kimix-settings-permission-label break-all text-[13px]">{kimiEnvironment.kimiCodeHome}</div>
                            </div>
                            <div className="grid min-w-0" style={{ gridTemplateColumns: "92px minmax(0, 1fr)", gap: 10 }}>
                              <div className="kimix-settings-permission-desc" style={{ marginTop: 0 }}>代理变量</div>
                              <div className="kimix-settings-permission-label break-all text-[13px]">
                                {kimiEnvironment.proxy.some((item) => item.configured)
                                  ? kimiEnvironment.proxy.filter((item) => item.configured).map((item) => `${item.key}=${item.value || "已配置"}`).join("；")
                                  : "未配置，Kimi Code 会直连；localhost MCP 服务始终直连。"}
                              </div>
                            </div>
                          </>
                        )}
                        <div className="grid min-w-0" style={{ gridTemplateColumns: "92px minmax(0, 1fr)", gap: 10 }}>
                          <div className="kimix-settings-permission-desc" style={{ marginTop: 0 }}>微压缩</div>
                          <div className="kimix-settings-permission-label text-[13px]">
                            Kimi Code 0.12.0 默认开启，会自动清理较旧的大型工具结果以减少上下文占用。
                          </div>
                        </div>
                        {modelConfigMessage && (
                          <div className="kimix-settings-permission-desc" style={{ marginTop: 0 }}>{modelConfigMessage}</div>
                        )}
                        <div className="flex flex-col" style={{ gap: 8, marginTop: 2 }}>
                          {(modelAliasesExpanded ? modelConfig.models : modelConfig.models.slice(0, 3)).map((model) => {
                            const selected = selectedModelAlias === model.alias || (!selectedModelAlias && model.isDefault);
                            const provider = modelConfig.providers.find((item) => item.name === model.provider);
                            const externalOpenAiProvider = provider?.type === "openai";
                            return (
                              <div
                                key={model.alias}
                                onClick={() => handleSelectModel(model)}
                                className={`kimix-settings-permission ${selected ? "is-active" : ""}`}
                                style={{
                                  padding: "12px 14px",
                                  display: "grid",
                                  gridTemplateColumns: "auto minmax(0, 1fr) auto",
                                  gap: 12,
                                  alignItems: "center",
                                }}
                              >
                                <SelectionIndicator selected={selected} />
                                <div className="kimix-settings-permission-copy">
                                  <div className="kimix-settings-permission-label truncate">{model.displayName || model.alias}</div>
                                  <div className="kimix-settings-permission-desc">
                                    {model.provider ?? "未绑定 provider"} · {model.model ?? model.alias} · {externalOpenAiProvider ? "思考由输入区控制" : `自适应思考${model.adaptiveThinking ? "开" : "关"}`}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                                  {!externalOpenAiProvider && (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleToggleAdaptiveThinking(model);
                                      }}
                                      disabled={adaptiveThinkingBusyAlias === model.alias}
                                      className="kimix-icon-text-button is-compact shrink-0 text-text-secondary hover:bg-surface-hover"
                                    >
                                      <Zap size={13} className={adaptiveThinkingBusyAlias === model.alias ? "kimix-spin" : ""} />
                                      {model.adaptiveThinking ? "思考开" : "思考关"}
                                    </button>
                                  )}
                                  {model.isDefault ? (
                                    <span className="shrink-0 rounded-full bg-accent-primary text-[12px] leading-5 text-white" style={{ paddingLeft: 9, paddingRight: 9 }}>
                                      使用中
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleSetDefaultModel(model.alias);
                                      }}
                                      disabled={providerBusyAction === "default"}
                                      className="kimix-icon-text-button is-compact shrink-0 text-text-secondary hover:bg-surface-hover"
                                    >
                                      <Check size={13} />
                                      使用
                                    </button>
                                  )}
                                  {externalOpenAiProvider && (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleRemoveModel(model);
                                      }}
                                      disabled={providerBusyAction === "remove"}
                                      className="kimix-icon-text-button is-compact shrink-0 text-text-secondary hover:bg-accent-danger-light hover:text-accent-danger"
                                      title={`删除 ${model.displayName || model.alias}`}
                                      aria-label={`删除 ${model.displayName || model.alias}`}
                                    >
                                      <Trash2 size={13} />
                                      删除
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {modelConfig.models.length > 3 && (
                          <button
                            type="button"
                            onClick={() => setModelAliasesExpanded(!modelAliasesExpanded)}
                            className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover"
                            style={{ marginTop: 10 }}
                          >
                            {modelAliasesExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            <span>
                              {modelAliasesExpanded
                                ? `点击折叠 ${modelConfig.models.length - 3} 个模型`
                                : `已折叠 ${modelConfig.models.length - 3} 个模型，点击展开`}
                            </span>
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="kimix-settings-permission-desc">{modelConfigMessage || "未读取到模型配置。"}</div>
                    )}
                  </div>

                  <div className="border-t border-[var(--kimix-panel-divider)]" style={{ marginTop: 16, paddingTop: 16 }}>
                    <div className="kimix-settings-permission-label">OpenAI-compatible Provider</div>
                    <div
                      className="kimix-settings-permission"
                      style={{
                        display: "grid",
                        gridTemplateColumns: providerCatalog.length > 0 ? "minmax(0, 1fr) minmax(260px, 456px)" : "minmax(0, 1fr)",
                        columnGap: 18,
                        rowGap: 14,
                        alignItems: "center",
                        padding: "14px 16px",
                        marginTop: 12,
                      }}
                    >
                      <div
                        className="grid min-w-0"
                        style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14, alignItems: "center", minHeight: 48 }}
                      >
                        <div className="kimix-settings-permission-copy min-w-0">
                          <div className="kimix-settings-permission-label">官方 catalog</div>
                          <div className="kimix-settings-permission-desc">
                            {providerCatalog.length > 0 ? `${providerCatalog.length} 个 OpenAI-compatible Provider 可填入` : "从 models.dev 拉取可用 Provider 和模型名"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleLoadProviderCatalog()}
                          disabled={providerCatalogLoading}
                          className="kimix-icon-text-button is-compact shrink-0 text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
                          style={{ alignSelf: "center" }}
                        >
                          <RefreshCw size={13} className={providerCatalogLoading ? "kimix-spin" : ""} />
                          {providerCatalog.length > 0 ? "刷新" : "载入"}
                        </button>
                      </div>
                      {providerCatalog.length > 0 && (
                        <div className="flex min-w-0 flex-col" style={{ gap: 12, justifySelf: "end", width: "100%", maxWidth: 456 }}>
                          <label className="min-w-0">
                            <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>Provider</span>
                            <select
                              value={selectedCatalogProviderId}
                              onChange={(event) => handleSelectCatalogProvider(event.target.value)}
                              className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                              style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                            >
                              {providerCatalog.map((provider) => (
                                <option key={provider.providerId} value={provider.providerId}>
                                  {provider.providerId} ({provider.modelCount})
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="min-w-0">
                            <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>模型</span>
                            <select
                              value={selectedCatalogModelId}
                              onChange={(event) => handleSelectCatalogModel(event.target.value)}
                              className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                              style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                            >
                              {(providerCatalog.find((provider) => provider.providerId === selectedCatalogProviderId)?.models ?? []).map((model) => (
                                <option key={model.id} value={model.id}>
                                  {model.name ?? model.id}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}
                    </div>
                    <div className="grid min-w-0" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10, marginTop: 12 }}>
                      <label className="min-w-0">
                        <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>Provider 名称</span>
                        <input
                          value={providerDraft.providerName}
                          onChange={(event) => setProviderDraft((current) => ({ ...current, providerName: event.target.value }))}
                          className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                          style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                        />
                      </label>
                      <label className="min-w-0">
                        <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>模型别名</span>
                        <input
                          value={providerDraft.modelAlias}
                          onChange={(event) => setProviderDraft((current) => ({ ...current, modelAlias: event.target.value }))}
                          className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                          style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                        />
                      </label>
                    </div>
                    <label className="block min-w-0" style={{ marginTop: 10 }}>
                      <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>Base URL</span>
                      <input
                        value={providerDraft.baseUrl}
                        onChange={(event) => setProviderDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                        className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                        style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                      />
                    </label>
                    <div className="grid min-w-0" style={{ gridTemplateColumns: "minmax(0, 1fr) 128px", gap: 10, marginTop: 10 }}>
                      <label className="min-w-0">
                        <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>模型名</span>
                        <input
                          value={providerDraft.model}
                          onChange={(event) => setProviderDraft((current) => ({ ...current, model: event.target.value }))}
                          className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                          style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                        />
                      </label>
                      <label className="min-w-0">
                        <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>Context</span>
                        <input
                          type="number"
                          min={1}
                          max={1048576}
                          value={providerDraft.maxContextSize}
                          onChange={(event) => setProviderDraft((current) => ({ ...current, maxContextSize: event.target.value }))}
                          className="kimix-settings-input kimix-number-input h-9 w-full rounded-lg text-center text-[13px] outline-none transition-colors"
                          style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                        />
                      </label>
                    </div>
                    <label className="block min-w-0" style={{ marginTop: 10 }}>
                      <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>API Key</span>
                      <input
                        type="password"
                        value={providerDraft.apiKey}
                        onChange={(event) => setProviderDraft((current) => ({ ...current, apiKey: event.target.value }))}
                        className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                        style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                      />
                    </label>
                    <div
                      className="grid min-w-0 items-center"
                      style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14, marginTop: 14 }}
                    >
                      <div className="min-w-0 break-all text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                        {providerMessage}
                      </div>
                      <div className="flex min-w-0 justify-end" style={{ gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => void handleSetDefaultModel()}
                          disabled={Boolean(providerBusyAction) || !providerDraft.modelAlias.trim()}
                          className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
                        >
                          <Check size={13} />
                          使用
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleTestProvider()}
                          disabled={Boolean(providerBusyAction)}
                          className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
                        >
                          <RefreshCw size={13} className={providerBusyAction === "test" ? "kimix-spin" : ""} />
                          测试
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveProvider()}
                          disabled={Boolean(providerBusyAction)}
                          className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-wait disabled:opacity-55"
                        >
                          <Check size={13} />
                          保存
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="kimix-settings-section" {...settingsSectionProps("context", 5)}>
                <div className="kimix-settings-section-title">
                  <Terminal size={16} className="text-text-muted" />
                  <span>上下文显示</span>
                  {settingsDragHandle("context", "上下文显示")}
                </div>
                <div className="kimix-settings-permissions">
                  <button onClick={() => setDetailedContext(false)} className={`kimix-settings-permission ${!detailedContext ? "is-active" : ""}`}>
                    <SelectionIndicator selected={!detailedContext} />
                    <Terminal size={18} className={`mt-0.5 shrink-0 ${!detailedContext ? "text-accent-primary" : "text-text-muted"}`} />
                    <div className="kimix-settings-permission-copy">
                      <div className="kimix-settings-permission-label">上下文百分比显示</div>
                      <div className="kimix-settings-permission-desc">默认选项，显示当前 Context 百分比</div>
                    </div>
                  </button>
                  <button onClick={() => setDetailedContext(true)} className={`kimix-settings-permission ${detailedContext ? "is-active" : ""}`}>
                    <SelectionIndicator selected={detailedContext} />
                    <Terminal size={18} className={`mt-0.5 shrink-0 ${detailedContext ? "text-accent-primary" : "text-text-muted"}`} />
                    <div className="kimix-settings-permission-copy">
                      <div className="kimix-settings-permission-label">上下文详细显示</div>
                      <div className="kimix-settings-permission-desc">显示 12.34/256k 这类详细用量</div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="kimix-settings-section" {...settingsSectionProps("notification", 9)}>
                <div className="kimix-settings-section-title">
                  <Bell size={16} className="text-text-muted" />
                  <span>完成通知</span>
                  {settingsDragHandle("notification", "完成通知")}
                </div>
                <div className="kimix-settings-permissions">
                  {notificationModes.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => setNotificationMode(mode.value)}
                      className={`kimix-settings-permission ${notificationMode === mode.value ? "is-active" : ""}`}
                    >
                      <SelectionIndicator selected={notificationMode === mode.value} />
                      <div className="kimix-settings-permission-copy">
                        <div className="kimix-settings-permission-label">{mode.label}</div>
                        <div className="kimix-settings-permission-desc">{mode.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="kimix-settings-section" {...settingsSectionProps("voice", 10)}>
                <div className="kimix-settings-section-title">
                  <Mic size={16} className="text-text-muted" />
                  <span>语音输入</span>
                  {settingsDragHandle("voice", "语音输入")}
                </div>
                <div className="kimix-settings-card" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 174px", gap: 16, alignItems: "center", padding: "14px 16px" }}>
                  <div className="flex min-w-0 items-start" style={{ gap: 12 }}>
                    <Keyboard size={18} className="mt-0.5 shrink-0 text-text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] font-medium text-[var(--kimix-panel-text)]">语音按钮触发快捷键</div>
                      <div className="mt-1 text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]">点击输入区麦克风后，会触发该系统快捷键，用于调用你自己的语音输入工具。</div>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="voice-shortcut" className="mb-1 block text-right text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">快捷键</label>
                    <input
                      id="voice-shortcut"
                      type="text"
                      value={voiceShortcut}
                      onChange={(event) => setVoiceShortcut(event.target.value)}
                      placeholder="Win+H"
                      className="kimix-settings-input h-9 w-full rounded-lg text-center text-[14px] outline-none transition-colors"
                    />
                    <div className="kimix-settings-hint mt-1 text-right text-[12.5px] leading-5">示例：Win+H、Ctrl+Alt+V</div>
                  </div>
                </div>
              </div>

              <div className="kimix-settings-section" {...settingsSectionProps("freeze", 13)}>
                <div className="kimix-settings-row-title">
                  <div className="kimix-settings-section-title">
                    <AlertCircle size={16} className="text-text-muted" />
                    <span>卡死诊断</span>
                  </div>
                  <div className="flex items-center" style={{ gap: 8 }}>
                    <span className="kimix-settings-badge text-[12.5px] leading-5" style={{ paddingLeft: 10, paddingRight: 10 }}>
                      {freezeReports.length}
                    </span>
                    <button type="button" onClick={loadFreezeReports} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover">
                      <RefreshCw size={13} />
                      刷新
                    </button>
                    <button type="button" onClick={clearFreezeReports} className="kimix-icon-text-button is-compact text-accent-danger hover:bg-accent-danger-light">
                      <Trash2 size={13} />
                      清空
                    </button>
                    {settingsDragHandle("freeze", "卡死诊断")}
                  </div>
                </div>
                <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
                  {freezeReports.length > 0 ? (
                    <div className="flex flex-col" style={{ gap: 10 }}>
                      {visibleFreezeReports.map((report, index) => (
                        <div key={`${report.at}-${index}`} className="kimix-settings-list-item" style={{ padding: "12px 12px" }}>
                          <div className="flex min-w-0 items-center justify-between" style={{ gap: 10 }}>
                            <div className="truncate text-[14px] font-medium leading-5 text-[var(--kimix-panel-text)]">{formatFreezeTime(report.at)}</div>
                            <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                              <span className={`rounded-full text-[12.5px] leading-5 ${freezeLagBadgeClass(report)}`} style={{ paddingLeft: 9, paddingRight: 9 }}>
                                {report.lagMs} ms
                              </span>
                              <button
                                type="button"
                                onClick={() => exportFreezeReport(report, index)}
                                className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover"
                                title="导出这条卡死诊断日志"
                              >
                                <Download size={13} />
                                导出
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                            <div className="truncate">当前会话：{report.sessionId ?? "无"}</div>
                            <div className="mt-1 truncate">运行会话：{report.runningSessionId ?? "无"}</div>
                            <div className="mt-1 truncate">窗口状态：{getFreezeVisibilityLabel(report)}</div>
                          </div>
                        </div>
                      ))}
                      {hiddenFreezeCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setFreezeExpanded((current) => !current)}
                          className="kimix-icon-text-button kimix-muted-action is-compact self-start"
                          style={{ marginTop: 2 }}
                        >
                          {freezeExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          <span>{freezeExpanded ? `折叠剩余 ${hiddenFreezeCount} 条诊断记录` : `展开剩余 ${hiddenFreezeCount} 条诊断记录`}</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-[13.5px] leading-6 text-[var(--kimix-panel-text-secondary)]">暂无卡死诊断记录。</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="kimix-settings-footer">Kimix v{KIMIX_VERSION} · 设置将自动保存到本地</div>
        </div>
      </div>
  );

  if (variant === "workspace") return content;

  return (
    <div
      className={`kimix-presence-overlay fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--kimix-modal-overlay-bg)] ${settingsPresence.visible ? "is-visible" : ""}`}
      onClick={() => setSettingsOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      {content}
    </div>
  );
}
