import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AppSettings } from "./types/ipc";

const CONFIG_DIR = path.join(os.homedir(), ".kimix");
const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");

const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: "kimi-code/kimi-for-coding",
  defaultThinking: true,
  defaultPlanMode: false,
  maxTurns: 50,
  enableCompaction: true,
  defaultPermissionMode: "manual",
  theme: "light",
  themePalette: "warm-paper",
  customThemePalette: {
    primary: "#1982FF",
    surface: "#EDE9E0",
    accent: "#B85C38",
  },
  kimiThemePalettes: [],
  fontSize: 15,
  fontSizeBaselineVersion: 1,
  showThinking: true,
  detailedContext: false,
  statusUpdateDisplay: "turn_end",
  sessionRecommendationEnabled: true,
  sessionRecommendationTurnLimit: 10,
  voiceShortcut: "Win+H",
  notificationMode: "unfocused",
  clarificationToolMode: "auto",
  filePreviewExtensions: ["md", "txt"],
  expandToolCalls: false,
  experimentalKimiServer: true,
  experimentalKimiServerSessions: true,
  experimentalKimiToolSelect: false,
  autoReadAgentsMd: true,
  autoShowGitStatus: true,
  enabledSkillNames: [],
  additionalWorkDirs: [],
  hookRules: [],
  hookRunLog: [],
};

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function writeFileAtomic(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp`;
  try {
    const fd = fs.openSync(tempPath, "w");
    try {
      fs.writeSync(fd, data, "utf-8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, `${filePath}.bak`);
      } catch (backupErr) {
        console.warn("[settingsService] 备份旧配置失败:", backupErr);
      }
    }
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    throw err;
  }
}

export function loadSettings(): AppSettings {
  ensureDir();
  if (!fs.existsSync(SETTINGS_FILE)) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_SETTINGS };
    }
    const rawSettings = parsed as Partial<AppSettings> & { clarificationToolEnabled?: boolean };
    const shouldMigrateLegacyFontSize = (rawSettings.fontSizeBaselineVersion ?? 0) < 1 && rawSettings.fontSize === 14;
    const clarificationToolMode = rawSettings.clarificationToolMode ??
      (rawSettings.clarificationToolEnabled === true ? "on" :
        rawSettings.clarificationToolEnabled === false ? "off" :
          DEFAULT_SETTINGS.clarificationToolMode);
    const settings = {
      ...DEFAULT_SETTINGS,
      ...rawSettings,
      fontSize: shouldMigrateLegacyFontSize ? 15 : rawSettings.fontSize ?? DEFAULT_SETTINGS.fontSize,
      fontSizeBaselineVersion: 1,
      clarificationToolMode,
    };
    if (shouldMigrateLegacyFontSize || rawSettings.fontSizeBaselineVersion !== 1) {
      writeFileAtomic(SETTINGS_FILE, JSON.stringify({ ...rawSettings, fontSize: settings.fontSize, fontSizeBaselineVersion: 1 }, null, 2));
    }
    const legacyKimiThemePalette = (rawSettings as { kimiThemePalette?: AppSettings["kimiThemePalette"] }).kimiThemePalette;
    if ((!settings.kimiThemePalettes || settings.kimiThemePalettes.length === 0) && legacyKimiThemePalette) {
      settings.kimiThemePalettes = [{
        id: "default",
        name: "Default",
        displayName: "KIMI-Default",
        palette: legacyKimiThemePalette,
        colors: {
          primary: legacyKimiThemePalette.primary,
          surface: legacyKimiThemePalette.textMuted,
          accent: legacyKimiThemePalette.accent,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }];
    }
    if ((settings.themePalette as string) === "kimi") {
      settings.themePalette = settings.kimiThemePalettes[0]?.id ? `kimi:${settings.kimiThemePalettes[0].id}` : "warm-paper";
    }
    if (!["manual", "auto", "yolo"].includes(settings.defaultPermissionMode)) {
      settings.defaultPermissionMode = "manual";
    }
    if ((settings.hookRules ?? []).length > 0) {
      try { syncKimiHookConfig(settings.hookRules ?? []); } catch {}
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Partial<AppSettings>): void {
  ensureDir();
  try {
    const current = loadSettings();
    const merged = { ...current, ...settings };
    if (merged.hookRules) {
      merged.hookRules = merged.hookRules.map(normalizeHookRule);
    }
    writeFileAtomic(SETTINGS_FILE, JSON.stringify(merged, null, 2));
    if (settings.hookRules) syncKimiHookConfig(merged.hookRules ?? []);
  } catch (err) {
    console.error("Failed to save settings:", err);
    throw err;
  }
}

function escapeTomlString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function hookRuleToToml(rule: NonNullable<AppSettings["hookRules"]>[number]) {
  rule = normalizeHookRule(rule);
  const command = rule.command?.trim();
  if (rule.event === "UserPromptSubmit") return null;
  if (!rule.enabled || !command) return null;
  if (rule.scope === "project") {
    // 项目级 Hook 由 Kimix 自行代理执行，避免未带 projectPath 写入全局 Kimi 配置后影响所有项目。
    return null;
  }
  return [
    "[[hooks]]",
    `event = "${escapeTomlString(rule.event)}"`,
    `matcher = "${escapeTomlString(rule.matcher.trim() || ".*")}"`,
    `command = "${escapeTomlString(command)}"`,
    `timeout = ${Math.max(1, Math.min(600, rule.timeout ?? 30))}`,
  ].join("\n");
}

function normalizeHookRule(rule: NonNullable<AppSettings["hookRules"]>[number]) {
  const text = `${rule.name} ${rule.reason ?? ""} ${rule.command ?? ""}`.toLowerCase();
  if (/时间|日期|current\s*time|date|clock/.test(text) && rule.event === "SessionStart") {
    return { ...rule, event: "UserPromptSubmit" as const };
  }
  return rule;
}

function syncKimiHookConfig(rules: NonNullable<AppSettings["hookRules"]>) {
  const kimiCodeDir = path.join(os.homedir(), ".kimi-code");
  const legacyKimiDir = path.join(os.homedir(), ".kimi");
  const shareDir = process.env.KIMI_CODE_HOME || process.env.KIMI_SHARE_DIR || (fs.existsSync(kimiCodeDir) ? kimiCodeDir : fs.existsSync(legacyKimiDir) ? legacyKimiDir : kimiCodeDir);
  const configPath = path.join(shareDir, "config.toml");
  const begin = "# >>> Kimix managed hooks >>>";
  const end = "# <<< Kimix managed hooks <<<";
  const body = rules.map(hookRuleToToml).filter(Boolean).join("\n\n");
  const block = `${begin}\n${body}\n${end}`;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const current = (fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "")
    .replace(/^\s*hooks\s*=\s*\[\]\s*\r?\n?/m, "");
  const escapedBegin = begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escapedBegin}[\\s\\S]*?${escapedEnd}`);
  const next = pattern.test(current)
    ? current.replace(pattern, block)
    : `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}\n`;
  writeFileAtomic(configPath, next);
}

export function getDefaultWorkDir(): string {
  const settings = loadSettings();
  return settings.defaultOpenDir?.trim() || path.join(os.homedir(), "kimi");
}
