import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AppSettings } from "./types/ipc";

const CONFIG_DIR = path.join(os.homedir(), ".kimix");
const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");

const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: "kimi-code/kimi-for-coding",
  defaultThinking: true,
  maxTurns: 50,
  enableCompaction: true,
  defaultPermissionMode: "manual",
  theme: "light",
  fontSize: 14,
  showThinking: true,
  detailedContext: false,
  statusUpdateDisplay: "turn_end",
  sessionRecommendationEnabled: true,
  sessionRecommendationTurnLimit: 10,
  expandToolCalls: false,
  autoReadAgentsMd: true,
  autoShowGitStatus: true,
  enabledSkillNames: [],
};

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
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
    return { ...DEFAULT_SETTINGS, ...(parsed as Partial<AppSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Partial<AppSettings>): void {
  ensureDir();
  try {
    const current = loadSettings();
    const merged = { ...current, ...settings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to save settings:", err);
    throw err;
  }
}

export function getDefaultWorkDir(): string {
  const settings = loadSettings();
  return settings.defaultOpenDir?.trim() || path.join(os.homedir(), "kimi");
}
