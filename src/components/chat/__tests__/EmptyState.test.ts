import { describe, expect, it } from "vitest";
import { Bug, GitBranch, ListChecks, RotateCcw, Sparkles } from "lucide-react";
import { resolveSuggestionIcon } from "../EmptyState";

describe("resolveSuggestionIcon", () => {
  it("兼容截图中的旧建议文案并按动作语义分配图标", () => {
    expect(resolveSuggestionIcon("接着上次这件事继续：你好呀")).toBe(RotateCcw);
    expect(resolveSuggestionIcon("分析一下当前项目，并告诉我最应该先处理什么")).toBe(Bug);
    expect(resolveSuggestionIcon("检查最近改动是否有风险，并给出验证建议")).toBe(GitBranch);
    expect(resolveSuggestionIcon("继续：发下8084吧")).toBe(RotateCcw);
  });

  it("保留内置建议映射并为未知建议提供稳定回退", () => {
    expect(resolveSuggestionIcon("读取最近会话和 Git 改动，整理待办与下一步")).toBe(ListChecks);
    expect(resolveSuggestionIcon("快速全面了解一下当前的项目")).toBe(Sparkles);
    expect(resolveSuggestionIcon("帮我写一段发布说明")).toBe(Sparkles);
  });
});
