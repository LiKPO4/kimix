// [loop_control] 段的纯函数读写（0.43.0+ compaction_max_attempts）。
// 只操作 config.toml 文本，不依赖 electron API，供 main 进程与纯函数单测复用。

import { setTomlSectionValuePreservingLayout } from "../src/utils/tomlSectionEditor";

export const LOOP_CONTROL_SECTION = "loop_control";
export const COMPACTION_MAX_ATTEMPTS_KEY = "compaction_max_attempts";
export const DEFAULT_COMPACTION_MAX_ATTEMPTS = 5;
export const COMPACTION_MAX_ATTEMPTS_MIN = 1;
export const COMPACTION_MAX_ATTEMPTS_MAX = 20;

const SECTION_PATTERN = /^\s*\[loop_control\]\s*$/m;
const VALUE_PATTERN = /^\s*compaction_max_attempts\s*=\s*(\d+)\s*$/m;

export function readCompactionMaxAttempts(tomlText: string): number | null {
  const sectionMatch = SECTION_PATTERN.exec(tomlText);
  if (!sectionMatch) return null;
  const rest = tomlText.slice(sectionMatch.index + sectionMatch[0].length);
  const nextSection = /^\s*\[[^\]]+\]\s*$/gm.exec(rest);
  const body = nextSection ? rest.slice(0, nextSection.index) : rest;
  const valueMatch = VALUE_PATTERN.exec(body);
  if (!valueMatch) return null;
  const value = Number.parseInt(valueMatch[1], 10);
  return Number.isFinite(value) ? value : null;
}

export function setCompactionMaxAttempts(tomlText: string, value: number): string {
  return setTomlSectionValuePreservingLayout(
    tomlText,
    LOOP_CONTROL_SECTION,
    COMPACTION_MAX_ATTEMPTS_KEY,
    String(Math.round(value)),
  );
}
