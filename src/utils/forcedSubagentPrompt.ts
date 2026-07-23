/**
 * 强制唤起子代理：开启后，在发给运行时的提示词前面注入一段强制委派指令，
 * 让主模型把繁琐、高耗 token 的子任务交给子代理执行。
 * 用户可见的原始消息保持不变，只修改 wire 内容。
 */

const FORCED_SUBAGENT_DIRECTIVE_HEAD = "【强制委派】把搜索、遍历、批量修改等繁琐或高耗 token 的子任务全部交给子代理";
const FORCED_SUBAGENT_DIRECTIVE_TAIL = "执行，禁止亲自完成；你只做规划、审查与整合。";

export function buildForcedSubagentDirective(input: {
  modelLabel?: string | null;
  maxContextSize?: number | null;
}): string {
  const modelLabel = input.modelLabel?.trim() || null;
  const context = typeof input.maxContextSize === "number" && input.maxContextSize > 0
    ? `${Math.round(input.maxContextSize / 1000)}k`
    : null;
  const modelSuffix = modelLabel
    ? `（${context ? `${modelLabel}，上下文 ${context}` : modelLabel}）`
    : "";
  return `${FORCED_SUBAGENT_DIRECTIVE_HEAD}${modelSuffix}${FORCED_SUBAGENT_DIRECTIVE_TAIL}`;
}

/**
 * 幂等地在 content 前注入 directive：directive 为空、或 content 已以该 directive 开头时原样返回。
 */
export function withForcedSubagentDirective(content: string, directive: string | null): string {
  if (!directive) return content;
  if (content.startsWith(directive)) return content;
  return `${directive}\n\n${content}`;
}

/**
 * 幂等地去掉 content 开头的强制委派指令（连同注入时的分隔空行）。
 * 只有首行完整匹配指令模板（固定头尾 + 可选模型后缀）才剥离，
 * 未注入或用户文本恰好以【强制委派】开头时原样返回。
 */
export function stripForcedSubagentDirective(content: string): string {
  if (!content.startsWith(FORCED_SUBAGENT_DIRECTIVE_HEAD)) return content;
  const firstLineEnd = content.indexOf("\n");
  const firstLine = firstLineEnd === -1 ? content : content.slice(0, firstLineEnd);
  if (!firstLine.endsWith(FORCED_SUBAGENT_DIRECTIVE_TAIL)) return content;
  const modelSuffix = firstLine.slice(
    FORCED_SUBAGENT_DIRECTIVE_HEAD.length,
    firstLine.length - FORCED_SUBAGENT_DIRECTIVE_TAIL.length,
  );
  if (modelSuffix && !/^（[^\n]*）$/.test(modelSuffix)) return content;
  return content.slice(firstLine.length).replace(/^\r?\n\r?\n/, "");
}
