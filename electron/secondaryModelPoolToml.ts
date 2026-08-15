// 子 Agent 模型池（[secondary_model] / [secondary_model.models]）的 TOML 纯函数。
// 只操作 config.toml 文本，不依赖 electron API，供 main 进程与纯函数单测复用。
// 官方 0.36 起：default_model 决定子 Agent 默认模型，force=true 为锁定模式；
// [secondary_model.models] 的键值对为 别名 = 提示语。

export function unescapeTomlString(value: string) {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export function escapeTomlString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function readTomlString(sectionText: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sectionText.match(new RegExp(`^\\s*${escaped}\\s*=\\s*"((?:\\\\.|[^"])*)"`, "m"));
  return match ? unescapeTomlString(match[1]) : null;
}


export function toTomlTableKey(name: string) {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : `"${escapeTomlString(name)}"`;
}


export function readTomlSectionBody(raw: string, sectionName: string) {
  const sectionPattern = /^\s*\[([^\]]+)\]\s*$/gm;
  const matches = Array.from(raw.matchAll(sectionPattern));
  const matchIndex = matches.findIndex((match) => match[1].trim() === sectionName);
  if (matchIndex < 0) return null;
  const match = matches[matchIndex];
  return raw.slice((match.index ?? 0) + match[0].length, matches[matchIndex + 1]?.index ?? raw.length);
}


export function removeTomlSection(raw: string, sectionName: string) {
  const sectionPattern = /^\s*\[([^\]]+)\]\s*$/gm;
  const matches = Array.from(raw.matchAll(sectionPattern));
  // Remove ALL matching sections, not just the first, so duplicate writes do
  // not accumulate.
  const targetIndexes: number[] = [];
  matches.forEach((match, index) => {
    if (match[1].trim() === sectionName) targetIndexes.push(index);
  });
  if (targetIndexes.length === 0) return raw;
  let result = raw;
  // Process from last to first so indexes stay valid.
  for (let i = targetIndexes.length - 1; i >= 0; i--) {
    const matchIndex = targetIndexes[i];
    const start = matches[matchIndex].index ?? 0;
    const end = matches[matchIndex + 1]?.index ?? result.length;
    const before = result.slice(0, start).trimEnd();
    const after = result.slice(end).trimStart();
    result = `${before}${before && after ? "\n\n" : ""}${after}`;
  }
  return result;
}


export function readTomlBoolean(sectionText: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sectionText.match(new RegExp(`^\\s*${escaped}\\s*=\\s*(true|false)\\s*$`, "mi"));
  return match ? match[1].toLowerCase() === "true" : null;
}


export function removeTomlSectionValue(raw: string, sectionName: string, key: string) {
  const sectionPattern = /^\s*\[([^\]]+)\]\s*$/gm;
  const matches = Array.from(raw.matchAll(sectionPattern));
  const matchIndex = matches.findIndex((match) => match[1].trim() === sectionName);
  if (matchIndex < 0) return raw;
  const start = (matches[matchIndex].index ?? 0) + matches[matchIndex][0].length;
  const end = matches[matchIndex + 1]?.index ?? raw.length;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linePattern = new RegExp(`\\n[ \\t]*${escaped}[ \\t]*=[^\\n]*`, "g");
  const body = raw.slice(start, end);
  return raw.slice(0, start) + body.replace(linePattern, "") + raw.slice(end);
}


export type SecondaryModelPoolDraft = {
  defaultModel: string | null;
  force: boolean;
  defaultEffort: string | null;
  entries: { alias: string; hint: string }[];
};

// 官方 0.36 的子 Agent 模型池（[secondary_model] default_model / force + [secondary_model.models]）。
// 旧单模型键 model 作为 fallback default 继续读取（官方同一语义）。
export function readSecondaryModelPoolFromToml(raw: string): SecondaryModelPoolDraft | null {
  const body = readTomlSectionBody(raw, "secondary_model");
  const modelsBody = readTomlSectionBody(raw, "secondary_model.models");
  if (!body && !modelsBody) return null;
  const legacyModel = body ? readTomlString(body, "model") : null;
  const defaultEffort = body ? readTomlString(body, "default_effort") : null;
  const explicitDefault = body ? readTomlString(body, "default_model") : null;
  const force = body ? readTomlBoolean(body, "force") === true : false;
  const entries: { alias: string; hint: string }[] = [];
  if (modelsBody) {
    for (const line of modelsBody.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:"((?:\\.|[^"])*)"|([A-Za-z0-9_./:-]+))\s*=\s*"((?:\\.|[^"])*)"\s*(?:#.*)?$/);
      if (match) entries.push({ alias: unescapeTomlString(match[1] ?? match[2]), hint: unescapeTomlString(match[3]) });
    }
  }
  const defaultModel = explicitDefault ?? legacyModel ?? null;
  if (!defaultModel && !force && !defaultEffort && entries.length === 0) return null;
  return { defaultModel, force, defaultEffort: defaultEffort ?? null, entries };
}

function removeSecondaryModelPoolSections(raw: string) {
  let next = removeTomlSection(raw, "secondary_model.models");
  next = removeTomlSection(next, "secondary_model");
  next = next.replace(/^\s*\[secondary_model\][^\n]*$/gm, "");
  return next.replace(/\n{3,}/g, "\n\n");
}

export function applySecondaryModelPoolToml(raw: string, pool: SecondaryModelPoolDraft) {
  const next = removeSecondaryModelPoolSections(raw);
  if (!pool.defaultModel && !pool.force && !pool.defaultEffort && pool.entries.length === 0) return next;
  const newline = next.includes("\r\n") ? "\r\n" : "\n";
  const lines: string[] = ["[secondary_model]"];
  if (pool.defaultModel) lines.push(`default_model = "${escapeTomlString(pool.defaultModel)}"`);
  if (pool.defaultEffort) lines.push(`default_effort = "${escapeTomlString(pool.defaultEffort)}"`);
  if (pool.force) lines.push("force = true");
  if (pool.entries.length > 0) {
    lines.push("", "[secondary_model.models]");
    for (const entry of pool.entries) {
      lines.push(`${toTomlTableKey(entry.alias)} = "${escapeTomlString(entry.hint)}"`);
    }
  }
  const base = next.trimEnd();
  return `${base}${base ? `${newline}${newline}` : ""}${lines.join(newline)}${newline}`;
}

// 级联清理（对齐官方 cascadeSubagentModelPool 语义）：删除模型/Provider 后，
// 池内悬空条目过滤；有效默认模型悬空时整节清除，避免 0.36 起所有会话 create/resume/fork 校验失败。
export function pruneSecondaryModelPoolForRemovedAliases(raw: string, remainingAliases: Set<string>) {
  const pool = readSecondaryModelPoolFromToml(raw);
  if (!pool) return raw;
  const defaultDangling = Boolean(pool.defaultModel && !remainingAliases.has(pool.defaultModel));
  const keptEntries = pool.entries.filter((entry) => remainingAliases.has(entry.alias));
  if (!defaultDangling && keptEntries.length === pool.entries.length) return raw;
  if (defaultDangling) return removeSecondaryModelPoolSections(raw);
  return applySecondaryModelPoolToml(raw, { ...pool, entries: keptEntries });
}


export const SECONDARY_MODEL_POOL_PRIMARY_ALIAS = "primary";
export const SECONDARY_MODEL_POOL_PRIMARY_ALIAS_ERROR = "primary 是官方保留别名，请改用其它模型别名";

// 保存前校验：primary 是官方保留别名，默认模型与池条目均拒绝；
// 同时按 alias 去重（保留首个），返回规范化结果。force 与池条目互斥等
// 依赖其它状态的校验由调用方负责，不在纯函数层处理。
export function validateSecondaryModelPoolDraft(draft: {
  defaultModel: string | null;
  entries: { alias: string; hint: string }[];
}): { defaultModel: string | null; entries: { alias: string; hint: string }[] } {
  if (draft.defaultModel === SECONDARY_MODEL_POOL_PRIMARY_ALIAS) {
    throw new Error(SECONDARY_MODEL_POOL_PRIMARY_ALIAS_ERROR);
  }
  const seen = new Set<string>();
  const entries: { alias: string; hint: string }[] = [];
  for (const entry of draft.entries) {
    if (entry.alias === SECONDARY_MODEL_POOL_PRIMARY_ALIAS) {
      throw new Error(SECONDARY_MODEL_POOL_PRIMARY_ALIAS_ERROR);
    }
    if (seen.has(entry.alias)) continue;
    seen.add(entry.alias);
    entries.push(entry);
  }
  return { defaultModel: draft.defaultModel, entries };
}
