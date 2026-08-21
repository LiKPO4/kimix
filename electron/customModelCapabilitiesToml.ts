// 自定义模型（OpenAI 兼容 Provider）capabilities 声明的 TOML 纯函数。
// 只操作 config.toml 文本，不依赖 electron API，供 main 进程与纯函数单测复用。
// 官方 CLI 新版 resolveModelCapabilities 以 [models.<alias>] 声明的 capabilities
// 作为模型能力事实源：未声明时按未知模型处理（image_in=false -> 不注册
// ReadMediaFile，图片/视频附件也不会送入上下文）。官方 managed 模型由 host 声明，
// 不需要处理；Kimix 托管的自定义模型此前从未写 capabilities，需补写并一次性迁移存量条目。

import {
  escapeTomlString,
  readTomlSectionBody,
  readTomlString,
} from "./secondaryModelPoolToml";
import { setTomlSectionValuePreservingLayout } from "../src/utils/tomlSectionEditor";

// 迁移标记：首次迁移写入后不再自动补写，尊重用户后续手动调整 capabilities。
export const CUSTOM_MODEL_CAPABILITIES_MIGRATION_MARKER = "# Kimix: custom model capabilities migration v1";

// Kimix 托管的自定义模型默认声明 input 能力；deepseek 无视觉输入，
// 声明 image_in/video_in 只会让模型看到 ReadMediaFile 工具但每次调用失败。
export function buildModelCapabilities(providerName: string, baseUrl: string | undefined, model: string): string[] {
  const isDeepSeek = `${providerName} ${baseUrl ?? ""} ${model}`.toLowerCase().includes("deepseek");
  return isDeepSeek ? ["tool_use"] : ["image_in", "video_in", "tool_use"];
}

export function toModelCapabilitiesLiteral(capabilities: string[]): string {
  return `[ ${capabilities.map((capability) => `"${escapeTomlString(capability)}"`).join(", ")} ]`;
}

function unescapeTomlString(value: string) {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function readTomlStringArray(sectionText: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sectionText.match(new RegExp(`^\\s*${escaped}\\s*=\\s*\\[([^\\]]*)\\]\\s*$`, "m"));
  if (!match) return null;
  return Array.from(match[1].matchAll(/"((?:\\.|[^"])*)"/g)).map((item) => unescapeTomlString(item[1]));
}

function stripTablePrefix(sectionName: string, prefix: string): string | null {
  const rawName = sectionName.slice(prefix.length);
  const quoted = rawName.match(/^"((?:\\.|[^"])*)"$/);
  return quoted ? unescapeTomlString(quoted[1]) : rawName;
}

// 只接受 models.<alias> 直接子表；官方运行时会为已用模型写 models.<alias>.overrides
// 子表，引用键含点（如 deepseek/deepseek-v4-flash）时简单去前缀会产生伪模型条目。
function directModelAlias(sectionName: string): string | null {
  const rawName = sectionName.slice("models.".length);
  if (rawName.startsWith('"')) return stripTablePrefix(sectionName, "models.");
  return rawName.includes(".") ? null : rawName;
}

// 迁移只在以下 Provider 类型上补写：Kimix 自定义保存的都是 openai，
// 兼容用户手写的 kimi/anthropic-compatible 网关；managed:kimi-code 或未知 Provider 一律不动。
const CUSTOM_PROVIDER_TYPES = new Set(["openai", "kimi", "anthropic"]);

export function applyCustomModelCapabilitiesFix(raw: string): { next: string; changed: boolean } {
  if (raw.includes(CUSTOM_MODEL_CAPABILITIES_MIGRATION_MARKER)) return { next: raw, changed: false };

  const sectionPattern = /^\s*\[([^\]]+)\]\s*$/gm;
  const matches = Array.from(raw.matchAll(sectionPattern));
  const sections = matches.map((match, index) => ({
    name: match[1].trim(),
    body: raw.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? raw.length),
  }));

  const providerTypes = new Map<string, string>();
  const providerBaseUrls = new Map<string, string>();
  for (const section of sections) {
    if (!section.name.startsWith("providers.") || /\.oauth$|\.env$/.test(section.name)) continue;
    const name = stripTablePrefix(section.name, "providers.");
    if (!name) continue;
    providerTypes.set(name, readTomlString(section.body, "type") ?? "");
    providerBaseUrls.set(name, readTomlString(section.body, "base_url") ?? "");
  }

  let next = raw;
  let changed = false;
  for (const section of sections) {
    if (!section.name.startsWith("models.") || directModelAlias(section.name) === null) continue;
    const provider = readTomlString(section.body, "provider");
    if (!provider) continue;
    if (!CUSTOM_PROVIDER_TYPES.has(providerTypes.get(provider) ?? "")) continue;
    if (readTomlStringArray(section.body, "capabilities")?.length) continue;
    const model = readTomlString(section.body, "model") ?? "";
    const capabilities = buildModelCapabilities(provider, providerBaseUrls.get(provider), model);
    next = setTomlSectionValuePreservingLayout(next, section.name, "capabilities", toModelCapabilitiesLiteral(capabilities));
    changed = true;
  }

  if (!changed) return { next: raw, changed: false };
  const newline = next.includes("\r\n") ? "\r\n" : "\n";
  next = `${CUSTOM_MODEL_CAPABILITIES_MIGRATION_MARKER}${newline}${next}`;
  return { next, changed: true };
}
