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

describe("vendored Kimi Code fallback", () => {
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
    expect(fetcher).toMatch(/resolveSafeFetchTarget(?:\$\d+)?\(currentUrl/);
    expect(fetcher).toContain('redirect: "manual"');
    expect(fetcher).toContain("dispatcher: this.pinnedDispatcherFor(target, dispatchers)");
    expect(fetcher).toMatch(/lookup: pinnedLookup(?:\$\d+)?\(target\.host, target\.addresses\)/);
  });
});

describe("vendored Kimi Code 0.34", () => {
  it("导出 SDK v2 引擎创建函数 createKimiHarnessV2", () => {
    expect(bundle).toContain("createKimiHarnessV2");
  });

  it("提供 v2 capability RPC 面（capabilityRpc / installCapability）", () => {
    expect(bundle).toContain("function capabilityRpc(rpc)");
    expect(bundle).toContain("capabilityRpc(this.rpc).installCapability(id)");
  });

  it("保留官方终态字段 last_turn_reason（schema 枚举）", () => {
    expect(bundle).toContain("last_turn_reason: external_exports.enum([");
  });

  it("发出 goal.updated 状态事件", () => {
    expect(bundle).toContain('type: "goal.updated"');
  });

  it("MCP server 状态枚举新增 removed 态", () => {
    const statusSchema = section(
      "mcpServerStatusPayloadSchema = external_exports.object({",
      "mcpServerStatusEventSchema = external_exports.object({",
    );
    expect(statusSchema).toContain('"removed"');
    expect(statusSchema).toContain('"needs-auth"');
    const mapper = section("function mapMcpStatus", "function mapMcpTransport");
    expect(mapper).toContain('case "removed":');
  });
});

describe("vendored Kimi Code 0.36", () => {
  it("保留子代理模型池与二级模型强制排除能力", () => {
    expect(bundle).toContain("SECONDARY_MODEL_FORCE_EXCLUDES_MODELS");
  });

  it("MCP 兜底超时已由 Kimix 补丁接管，不残留精确 DEFAULT_STARTUP_TIMEOUT_MS = 3e4; 声明", () => {
    expect(bundle).toContain("KIMIX_KIMI_CODE_MCP_STARTUP_TIMEOUT_MS");
    // v1 引擎经 esbuild 重命名的 DEFAULT_STARTUP_TIMEOUT_MS$1 = 3e4 允许存在，这里只断言 v2 引擎被改写前的精确声明不残留
    expect(bundle).not.toContain("DEFAULT_STARTUP_TIMEOUT_MS = 3e4;");
  });
});

describe("vendored Kimi Code 0.38", () => {
  it("提供 promptId、多 Skill 与统一 MCP 注册表契约", () => {
    expect(bundle).toContain("promptWithSkills");
    expect(bundle).toContain("PROMPT_ID_CONFLICT");
    expect(bundle).toContain('authStatus: tokens?.hasTokens === true ? "oauth-expired" : "oauth-required"');
  });

  it("支持 kimi.com 与 kimi.ai 登录区域", () => {
    expect(bundle).toContain('value === "mainland-cn" || value === "global"');
  });
});

describe("vendored Kimi Code 0.39", () => {
  it("恢复 v2 实时 Context 状态快照", () => {
    const snapshot = section("function withStatusSnapshot", "function createKimiHarnessV2");
    expect(snapshot).toContain("tokenCounting.statusSize(context)");
    expect(snapshot).toContain("contextUsage");
    expect(snapshot).toContain("usage: usageService.status(context)");
  });

  it("全局 MCP 管理支持 cwd，并保留离线授权状态查询", () => {
    const management = section(
      "async listMcpServers(options2 = {})",
      "async authenticateAppMcpServer(locator, options2)",
    );
    expect(management).toContain("this.rpc.listGlobalMcpServers(options2)");
    expect(management).toContain("this.rpc.listGlobalMcpServerAuthStatuses(options2)");
    expect(management).toContain("{ cwd: options2.cwd }");
  });

  it("暴露 Tower 模式，并按官方 0.39 语义保留失效的 secondary_model 配置", () => {
    expect(bundle).toContain("async setTowerMode(enabled)");
    expect(bundle).toContain("towerMode: external_exports.boolean().optional()");
    expect(bundle).not.toContain("cascadeSubagentModelPool");
  });
});
