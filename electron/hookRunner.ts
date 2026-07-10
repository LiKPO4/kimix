/**
 * Hook runner: applies UserPromptSubmit hooks to outgoing prompts.
 *
 * Self-contained: no runtime SDK import and no legacy event bridge dependency.
 */

import { exec } from "node:child_process";
import type { HookRule, HookRunLogEntry } from "./types/ipc";
import * as settingsService from "./settingsService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLARIFICATION_ORIGINAL_MARKER = "\n\n用户原始需求：\n";

function isPathInside(parent: string, child: string): boolean {
  const rel = require("node:path").relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !require("node:path").isAbsolute(rel));
}

function decodeHookOutput(value: string | Buffer): string {
  if (typeof value === "string") return value;
  const utf8 = value.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("gb18030").decode(value);
  } catch {
    return utf8;
  }
}

function cleanHookOutput(value: string): string {
  return value
    .replace(/�/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\?{1,4}\s+(?=[㐀-鿿])/u, ""))
    .join("\n")
    .trim();
}

function hookRuleApplies(rule: HookRule, workDir: string): boolean {
  if (!rule.enabled || !rule.command?.trim()) return false;
  if (rule.scope !== "project") return true;
  return Boolean(rule.projectPath && isPathInside(rule.projectPath, workDir));
}

const MAX_HOOK_MATCHER_LENGTH = 500;
const MAX_HOOK_TARGET_LENGTH = 4096;

function matchesHookTarget(rule: HookRule, target: string): boolean {
  const matcher = rule.matcher?.trim();
  if (!matcher || matcher === ".*") return true;
  if (matcher.length > MAX_HOOK_MATCHER_LENGTH) return false;
  const input = target.length > MAX_HOOK_TARGET_LENGTH ? target.slice(0, MAX_HOOK_TARGET_LENGTH) : target;
  try {
    return new RegExp(matcher, "i").test(input);
  } catch {
    return input.toLowerCase().includes(matcher.toLowerCase());
  }
}

type HookRequest = {
  event: string;
  target: string;
  input_data: Record<string, unknown>;
};

function runHookCommand(
  rule: HookRule,
  request: HookRequest,
  workDir: string,
): Promise<{ stdout: string; stderr: string; code: number | null; killed: boolean }> {
  return new Promise((resolve) => {
    const child = exec(
      rule.command!,
      {
        cwd: workDir,
        windowsHide: true,
        encoding: "buffer",
        timeout: Math.max(1, Math.min(600, rule.timeout ?? 30)) * 1000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const execError = error as { code?: unknown; killed?: boolean } | null;
        const code =
          error === null
            ? 0
            : typeof execError?.code === "number"
              ? (execError as { code: number }).code
              : null;
        resolve({
          stdout: decodeHookOutput(stdout).trim(),
          stderr: decodeHookOutput(stderr).trim(),
          code,
          killed: execError?.killed === true,
        });
      },
    );
    child.stdin?.end(
      JSON.stringify({
        hook_event: request.event,
        target: request.target,
        input_data: request.input_data,
      }),
    );
  });
}

function appendHookLog(
  rule: HookRule,
  request: HookRequest,
  result: "allow" | "block" | "notify" | "run_command" | "error",
  message: string,
): void {
  const settings = settingsService.loadSettings();
  const entry: HookRunLogEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ruleId: rule.id,
    ruleName: rule.name,
    event: rule.event,
    action: rule.action,
    result,
    message: `${request.target || request.event}: ${message}`.slice(0, 500),
    timestamp: Date.now(),
  };
  settingsService.saveSettings({
    hookRunLog: [entry, ...(settings.hookRunLog ?? [])].slice(0, 80),
  });
}

function getPromptSubmitTarget(content: string | Array<{ type: string; text?: string }>): string {
  const text =
    typeof content === "string"
      ? content
      : content
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n");
  if (!text.startsWith("【Kimix 需求澄清工具：")) return text;
  const markerIndex = text.indexOf(CLARIFICATION_ORIGINAL_MARKER);
  return markerIndex === -1 ? text : text.slice(markerIndex + CLARIFICATION_ORIGINAL_MARKER.length);
}

function appendPromptSubmitInstructionToText(text: string, context: string): string {
  const instruction = `

【Kimix Hooks 上下文】
以下内容由启用的 UserPromptSubmit Hooks 在用户消息提交前产生。
请把它作为本轮上下文或约束处理：
- 若包含安全约束、阻断原因或用户提醒，必须遵守。
- 若包含当前时间、环境信息或参考资料，仅在与用户任务相关时简要使用。
- 不要复述本段说明。

${context}
`;
  return `${text}${instruction}`;
}

function withPromptSubmitContext(
  content: string | Array<{ type: string; text?: string }>,
  context: string,
): string | Array<{ type: string; text?: string }> {
  if (typeof content === "string") return appendPromptSubmitInstructionToText(content, context);
  const firstTextIndex = content.findIndex((part) => part.type === "text");
  if (firstTextIndex === -1) {
    return [
      { type: "text", text: appendPromptSubmitInstructionToText("", context).trimEnd() },
      ...content,
    ];
  }
  return content.map((part, index) =>
    index === firstTextIndex && part.type === "text"
      ? { ...part, text: appendPromptSubmitInstructionToText(part.text ?? "", context) }
      : part,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs all enabled UserPromptSubmit hooks against the outgoing prompt content
 * and returns the (possibly augmented) content. Block actions throw.
 */
export async function applyPromptSubmitHooks(
  sessionId: string,
  content: string | Array<{ type: string; text?: string }>,
  workDir: string,
): Promise<string | Array<{ type: string; text?: string }>> {
  const target = getPromptSubmitTarget(content);
  const rules = (settingsService.loadSettings().hookRules ?? [])
    .filter((rule) => rule.event === "UserPromptSubmit")
    .filter((rule) => hookRuleApplies(rule, workDir))
    .filter((rule) => matchesHookTarget(rule, target));
  if (rules.length === 0) return content;

  const outputs: string[] = [];
  for (const rule of rules) {
    const startedAt = Date.now();
    let blocked = false;
    const request: HookRequest = {
      event: "UserPromptSubmit",
      target: target.slice(0, 220),
      input_data: {
        prompt: target,
        cwd: workDir,
        hook_event_name: "UserPromptSubmit",
      },
    };
    try {
      const ranRaw = await runHookCommand(rule, request, workDir);
      const ran = {
        ...ranRaw,
        stdout: cleanHookOutput(ranRaw.stdout),
        stderr: cleanHookOutput(ranRaw.stderr),
      };
      const message = ran.stdout || ran.stderr || rule.reason || rule.name;
      if (rule.action === "block" || ran.code === 2) {
        blocked = true;
        appendHookLog(rule, request, "block", message);
        throw new Error(message || "用户输入被 Hook 规则阻断");
      }
      if (ran.killed || ran.code !== 0) {
        const reason = ran.killed ? "Hook 命令执行超时" : `Hook 命令退出码 ${ran.code}`;
        appendHookLog(rule, request, "error", `${reason}: ${message}`);
        continue;
      }
      appendHookLog(rule, request, rule.action, message);
      if (ran.stdout) outputs.push(`Hook「${rule.name}」输出：\n${ran.stdout}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (blocked) throw err;
      appendHookLog(rule, request, "error", message);
    }
  }

  const context = outputs.map((item) => item.trim()).filter(Boolean).join("\n\n");
  return context ? withPromptSubmitContext(content, context) : content;
}
