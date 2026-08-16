import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearThinkingTranslationsAfterCredentialRemoval,
  resetThinkingTranslationStoreForTests,
  type ThinkingTranslationSnapshot,
  useThinkingTranslation,
} from "../thinkingTranslationStore";

type HookProps = {
  translationKey?: string;
  sourceText: string;
  final?: boolean;
  intervalMs?: number;
  provider?: "local" | "azure";
};

describe("thinkingTranslationStore", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: ThinkingTranslationSnapshot;
  let translateThinking: ReturnType<typeof vi.fn>;

  function Probe(props: HookProps) {
    latest = useThinkingTranslation({
      key: props.translationKey ?? "draft:session-1:turn-1",
      sourceText: props.sourceText,
      enabled: true,
      provider: props.provider ?? "azure",
      intervalMs: props.intervalMs ?? 2500,
      final: props.final,
    });
    return null;
  }

  async function render(props: HookProps) {
    await act(async () => {
      root.render(React.createElement(Probe, props));
    });
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    resetThinkingTranslationStoreForTests();
    translateThinking = vi.fn(async ({ text, requestId }: { text: string; requestId?: string }) => ({
      success: true as const,
      data: { translatedText: `译:${text}`, targetLanguage: "zh-Hans" as const, requestId },
    }));
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { translateThinking },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    resetThinkingTranslationStoreForTests();
    vi.useRealTimers();
  });

  it("流式内容先合并 2.5 秒，并只发送已闭合句段", async () => {
    await render({ sourceText: "First sentence. unfinished" });
    expect(translateThinking).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2499);
    });
    expect(translateThinking).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(translateThinking).toHaveBeenCalledTimes(1);
    expect(translateThinking.mock.calls[0][0].text).toBe("First sentence. ");
    expect(latest.translatedSourceEnd).toBe("First sentence. ".length);

    await render({ sourceText: "First sentence. unfinished tail. " });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(translateThinking).toHaveBeenCalledTimes(2);
    expect(translateThinking.mock.calls[1][0].text).toBe("unfinished tail. ");
  });

  it("支持 1 秒档位，并把超出范围的间隔限制在 5 秒", async () => {
    await render({ sourceText: "Fast sentence. ", intervalMs: 1000 });
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(translateThinking).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(translateThinking).toHaveBeenCalledTimes(1);

    await render({ translationKey: "draft:session-1:turn-2", sourceText: "Slow sentence. ", intervalMs: 10_000 });
    await act(async () => vi.advanceTimersByTimeAsync(4999));
    expect(translateThinking).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(translateThinking).toHaveBeenCalledTimes(2);
  });

  it("落定内容立即补译未闭合尾巴", async () => {
    await render({ sourceText: "No punctuation tail", final: true });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(translateThinking).toHaveBeenCalledTimes(1);
    expect(latest.translatedSourceEnd).toBe("No punctuation tail".length);
  });

  it("请求期间不并发，并在原文被替换后丢弃旧响应再翻译新文本", async () => {
    let resolveFirst!: (value: {
      success: true;
      data: { translatedText: string; targetLanguage: "zh-Hans"; requestId?: string };
    }) => void;
    translateThinking.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    })).mockImplementation(async ({ text, requestId }: { text: string; requestId?: string }) => ({
      success: true as const,
      data: { translatedText: `新:${text}`, targetLanguage: "zh-Hans" as const, requestId },
    }));

    await render({ sourceText: "Old sentence. " });
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(translateThinking).toHaveBeenCalledTimes(1);

    await render({ sourceText: "Replacement sentence. " });
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(translateThinking).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({
        success: true,
        data: { translatedText: "不应落地的旧译文", targetLanguage: "zh-Hans" },
      });
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
    });
    expect(translateThinking).toHaveBeenCalledTimes(2);
    expect(translateThinking.mock.calls[1][0].text).toBe("Replacement sentence. ");
    expect(latest.translatedText).toBe("新:Replacement sentence. ");
  });

  it("瞬时网络错误按退避重试，清除凭据会立即清空可见译文", async () => {
    translateThinking.mockResolvedValueOnce({
      success: false,
      error: { code: "network_error", message: "temporary" },
    }).mockImplementation(async ({ text, requestId }: { text: string; requestId?: string }) => ({
      success: true as const,
      data: { translatedText: `恢复:${text}`, targetLanguage: "zh-Hans" as const, requestId },
    }));

    await render({ sourceText: "Retry sentence. " });
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(translateThinking).toHaveBeenCalledTimes(1);
    expect(latest.status).toBe("error");

    await act(async () => vi.advanceTimersByTimeAsync(4999));
    expect(translateThinking).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(translateThinking).toHaveBeenCalledTimes(2);
    expect(latest.translatedText).toBe("恢复:Retry sentence. ");

    await act(async () => clearThinkingTranslationsAfterCredentialRemoval());
    expect(latest.translatedText).toBe("");
    expect(latest.status).toBe("error");
  });

  it("正式思考块复用同源 draft 已完成译文，不重复计费", async () => {
    await render({ translationKey: "thinking-draft:turn-1", sourceText: "Shared sentence.", final: true });
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(translateThinking).toHaveBeenCalledTimes(1);
    expect(latest.translatedSourceEnd).toBe("Shared sentence.".length);

    await render({ translationKey: "session-1:thinking-block:block-1", sourceText: "Shared sentence.", final: true });
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(translateThinking).toHaveBeenCalledTimes(1);
    expect(latest.translatedText).toBe("译:Shared sentence.");
  });

  it("切换互斥翻译提供方时清空旧译文并把新请求路由到选中提供方", async () => {
    await render({ sourceText: "Provider sentence.", final: true, provider: "azure" });
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(translateThinking).toHaveBeenCalledTimes(1);
    expect(translateThinking.mock.calls[0][0].provider).toBe("azure");

    await render({ sourceText: "Provider sentence.", final: true, provider: "local" });
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(translateThinking).toHaveBeenCalledTimes(2);
    expect(translateThinking.mock.calls[1][0].provider).toBe("local");
  });
});
