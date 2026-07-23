import { describe, expect, it } from "vitest";
import { buildForcedSubagentDirective, stripForcedSubagentDirective, withForcedSubagentDirective } from "../forcedSubagentPrompt";

describe("buildForcedSubagentDirective", () => {
  it("includes model label and context when both are available", () => {
    expect(buildForcedSubagentDirective({ modelLabel: "Kimi K2", maxContextSize: 262144 })).toBe(
      "【强制委派】把搜索、遍历、批量修改等繁琐或高耗 token 的子任务全部交给子代理（Kimi K2，上下文 262k）执行，禁止亲自完成；你只做规划、审查与整合。",
    );
  });

  it("omits the model suffix when no model label is given", () => {
    expect(buildForcedSubagentDirective({ modelLabel: null, maxContextSize: 262144 })).toBe(
      "【强制委派】把搜索、遍历、批量修改等繁琐或高耗 token 的子任务全部交给子代理执行，禁止亲自完成；你只做规划、审查与整合。",
    );
    expect(buildForcedSubagentDirective({})).toBe(
      "【强制委派】把搜索、遍历、批量修改等繁琐或高耗 token 的子任务全部交给子代理执行，禁止亲自完成；你只做规划、审查与整合。",
    );
  });

  it("keeps only the model name when context size is missing", () => {
    expect(buildForcedSubagentDirective({ modelLabel: "Kimi K2", maxContextSize: null })).toBe(
      "【强制委派】把搜索、遍历、批量修改等繁琐或高耗 token 的子任务全部交给子代理（Kimi K2）执行，禁止亲自完成；你只做规划、审查与整合。",
    );
    expect(buildForcedSubagentDirective({ modelLabel: "Kimi K2" })).toBe(
      "【强制委派】把搜索、遍历、批量修改等繁琐或高耗 token 的子任务全部交给子代理（Kimi K2）执行，禁止亲自完成；你只做规划、审查与整合。",
    );
  });
});

describe("withForcedSubagentDirective", () => {
  const directive = buildForcedSubagentDirective({ modelLabel: "Kimi K2", maxContextSize: 262144 });

  it("prepends the directive to the content", () => {
    expect(withForcedSubagentDirective("帮我改这个 bug", directive)).toBe(
      `${directive}\n\n帮我改这个 bug`,
    );
  });

  it("returns the content unchanged when the directive is null or empty", () => {
    expect(withForcedSubagentDirective("帮我改这个 bug", null)).toBe("帮我改这个 bug");
    expect(withForcedSubagentDirective("帮我改这个 bug", "")).toBe("帮我改这个 bug");
  });

  it("is idempotent and does not double-inject on retry/resend", () => {
    const once = withForcedSubagentDirective("帮我改这个 bug", directive);
    expect(withForcedSubagentDirective(once, directive)).toBe(once);
  });
});

describe("stripForcedSubagentDirective", () => {
  const directive = buildForcedSubagentDirective({ modelLabel: "Kimi K2", maxContextSize: 262144 });

  it("removes an injected directive together with its separator blank line", () => {
    const injected = withForcedSubagentDirective("帮我改这个 bug", directive);
    expect(stripForcedSubagentDirective(injected)).toBe("帮我改这个 bug");
  });

  it("removes a directive without the model suffix", () => {
    const plain = buildForcedSubagentDirective({});
    expect(stripForcedSubagentDirective(`${plain}\n\n你好`)).toBe("你好");
  });

  it("leaves uninjected content unchanged and stays idempotent", () => {
    expect(stripForcedSubagentDirective("帮我改这个 bug")).toBe("帮我改这个 bug");
    const once = stripForcedSubagentDirective(withForcedSubagentDirective("帮我改这个 bug", directive));
    expect(stripForcedSubagentDirective(once)).toBe(once);
  });

  it("keeps user text that merely resembles the directive", () => {
    expect(stripForcedSubagentDirective("【强制委派】请帮我看下这个函数")).toBe("【强制委派】请帮我看下这个函数");
    expect(stripForcedSubagentDirective(`${directive}少了个结尾`)).toBe(`${directive}少了个结尾`);
  });
});
