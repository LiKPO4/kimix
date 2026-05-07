import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AppSettings } from "./types/ipc";

const CONFIG_DIR = path.join(os.homedir(), ".kimix");
const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");

const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: "kimi-latest",
  defaultThinking: true,
  maxTurns: 50,
  enableCompaction: true,
  defaultPermissionMode: "manual",
  theme: "light",
  fontSize: 14,
  showThinking: true,
  expandToolCalls: false,
  autoReadAgentsMd: true,
  autoShowGitStatus: true,
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
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  ensureDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
}
