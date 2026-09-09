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
  it("为被中断/未执行的工具调用生成 aborted 结果（v2 引擎）", () => {
    // 官方 0.42.0 删除 v1 引擎（agent-core 的 recordUnexecutedToolCalls/UNEXECUTED_TOOL_CALL_OUTPUT 随之移除），
    // v2 引擎由 toolExecutorService.abortedToolOutput 承担同一兜底：信号已中止的调用直接产出 aborted 结果。
    expect(bundle).toContain("abortedToolOutput");
    expect(bundle).toContain("The user manually interrupted");
    expect(bundle).toContain("was aborted");
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
  it("导出 SDK v2 引擎创建函数 createKimiHarness（0.42 起 v1 引擎与 V2 别名移除）", () => {
    expect(bundle).toContain("function createKimiHarness(");
    expect(bundle).not.toContain("createKimiHarnessV2");
  });

  it("提供 v2 capability RPC 面（capabilityRpc / installCapability）", () => {
    expect(bundle).toContain("function capabilityRpc(rpc)");
    expect(bundle).toContain("capabilityRpc(this.rpc).installCapability(id)");
  });

  it("保留官方终态字段 lastTurnReason（0.42 起 wire schema 移至 kap-server，不再随 node-sdk 打包）", () => {
    expect(bundle).toContain("lastTurnReason");
  });

  it("发出 goal.updated 状态事件（0.42 起为类化事件声明）", () => {
    expect(bundle).toContain('static type = "goal.updated"');
  });

  it("MCP server 状态保留 removed/needs-auth 处理（0.42 起 schema 移至 kap-server，运行时代码保留）", () => {
    expect(bundle).toContain("mcp.server.status");
    expect(bundle).toContain('status === "removed"');
    expect(bundle).toContain('"needs-auth"');
  });
});

describe("vendored Kimi Code 0.36", () => {
  it("保留子代理模型池与二级模型强制排除能力", () => {
    expect(bundle).toContain("SECONDARY_MODEL_FORCE_EXCLUDES_MODELS");
  });

  it("MCP 兜底超时已由 Kimix 补丁接管，不残留精确 DEFAULT_STARTUP_TIMEOUT_MS = 3e4; 声明", () => {
    expect(bundle).toContain("KIMIX_KIMI_CODE_MCP_STARTUP_TIMEOUT_MS");
    // 0.42 起 v1 引擎移除，不再有 esbuild 重命名的 DEFAULT_STARTUP_TIMEOUT_MS$1 副本；这里只断言补丁改写前的精确声明不残留
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

describe("vendored Kimi Code runtime", () => {
  it("恢复 v2 实时 Context 状态快照", () => {
    const snapshot = section("function withStatusSnapshot", "function createKimiHarness(");
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

  it("暴露 Tower 模式，并按官方语义保留失效的 secondary_model 配置", () => {
    expect(bundle).toContain("async setTowerMode(enabled, base)");
    expect(bundle).toContain("Session tower mode base must be a string");
    // 0.42 起 towerMode 会话字段收敛为纯 TS 类型（zod schema 移至 kap-server），改断言 enter schema 仍在 bundle
    expect(bundle).toContain("towerModeEnterSchema = external_exports.object({");
    expect(bundle).not.toContain("cascadeSubagentModelPool");
  });
});

describe("vendored Kimi Code 0.40", () => {
  it("提供无会话的 v2 文件模糊搜索（0.42 起 v1 引擎移除，仅剩 v2 实现）", () => {
    const v2Harness = section("async suggestFiles(workDir, input)", "async listMcpServers(options2 = {})");
    expect(v2Harness).toContain("this.rpc.suggestFiles(workDir, input)");
  });
});
