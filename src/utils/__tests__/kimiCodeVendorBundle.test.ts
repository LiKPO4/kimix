import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const bundle = readFileSync(path.resolve(process.cwd(), "vendor/kimi-code-sdk/index.mjs"), "utf-8");

function section(startMarker: string, endMarker: string): string {
  const start = bundle.indexOf(startMarker);
  const end = bundle.indexOf(endMarker, start + startMarker.length);

  expect(start, `missing bundle marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing bundle marker: ${endMarker}`).toBeGreaterThan(start);

  return bundle.slice(start, end);
}

describe("vendored Kimi Code 0.28 fallback", () => {
  it("为被中断但尚未执行的工具调用补齐 call/result 事件", () => {
    const recorder = section("async function recordUnexecutedToolCalls", "function preflightToolCall");
    expect(recorder).toContain('type: "tool.call"');
    expect(recorder).toContain('type: "tool.result"');
    expect(recorder).toContain("output: UNEXECUTED_TOOL_CALL_OUTPUT");
    expect(recorder).toContain("isError: true");

    const runner = section("const stopReason = deriveStepStopReason(response);", "function logStepTiming");
    expect(runner).toContain('stopReason === "paused"');
    expect(runner).toContain('stopReason === "unknown"');
    expect(runner).toContain('stopReason === "max_tokens"');
    expect(runner).toContain("await recordUnexecutedToolCalls(step, response)");
  });

  it("保留 Kimix 的 MCP 启动超时覆盖入口", () => {
    expect(bundle).toContain('process.env.KIMIX_KIMI_CODE_MCP_STARTUP_TIMEOUT_MS ?? "4000"');
  });

  it("远程抓取的每次跳转都重新校验地址并固定 DNS 解析结果", () => {
    const fetcher = section("async requestWithValidatedRedirects", "extractMainContent(html)");
    expect(fetcher).toContain("resolveSafeFetchTarget(currentUrl");
    expect(fetcher).toContain('redirect: "manual"');
    expect(fetcher).toContain("dispatcher: this.pinnedDispatcherFor(target, dispatchers)");
    expect(fetcher).toContain("lookup: pinnedLookup(target.host, target.addresses)");
  });
});
