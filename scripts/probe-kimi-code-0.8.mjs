import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sdkEntry =
  process.env.KIMIX_KIMI_CODE_SDK_ENTRY ??
  path.join(repoRoot, "vendor", "kimi-code-sdk", "index.mjs");
const probeRoot = path.join(os.tmpdir(), "kimix-kimi-code-0.8-api-probe");
const workDir = path.join(probeRoot, "work");

function methodNames(proto) {
  return Object.entries(Object.getOwnPropertyDescriptors(proto))
    .filter(([name, descriptor]) => name !== "constructor" && typeof descriptor.value === "function")
    .map(([name]) => name)
    .sort();
}

function compactError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function capture(name, fn) {
  try {
    return { name, ok: true, data: await fn() };
  } catch (error) {
    return { name, ok: false, error: compactError(error) };
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function pickCatalogProvider(mod, catalog) {
  for (const [providerId, provider] of Object.entries(catalog)) {
    const wire = mod.inferWireType(provider);
    const models = mod.catalogProviderModels(provider);
    if (wire !== undefined && models.length > 0) {
      return {
        providerId,
        provider,
        wire,
        model: models[0],
        modelCount: models.length,
      };
    }
  }
  return undefined;
}

async function main() {
  await mkdir(workDir, { recursive: true });

  const mod = await import(pathToFileURL(sdkEntry).href);
  const harness = new mod.KimiHarness({
    homeDir: process.env.KIMI_CODE_HOME,
    identity: {
      userAgentProduct: "kimi-code-cli",
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? "0.8.0",
    },
    uiMode: "kimix-0.8-api-probe",
  });

  let session;
  try {
    const exportNames = Object.keys(mod).sort();
    const harnessMethods = methodNames(mod.KimiHarness.prototype);
    const sessionMethods = methodNames(mod.Session.prototype);
    const config = await harness.getConfig({ reload: true });
    session = await harness.createSession({
      workDir,
      metadata: { source: "kimix-0.8-api-probe" },
    });

    const results = [];
    results.push(await capture("harness.getExperimentalFlags", () => harness.getExperimentalFlags()));
    results.push(await capture("session.getStatus", () => session.getStatus()));
    results.push(await capture("session.undoHistory(1) on fresh session", () => session.undoHistory(1)));
    results.push(await capture("session.listBackgroundTasks({ activeOnly: false })", () =>
      session.listBackgroundTasks({ activeOnly: false, limit: 20 })
    ));
    results.push(await capture("session.getGoal without active goal", () => session.getGoal()));

    const catalogResult = await capture("fetchCatalog(DEFAULT_CATALOG_URL)", async () => {
      const catalog = await mod.fetchCatalog(mod.DEFAULT_CATALOG_URL);
      const providerCount = Object.keys(catalog).length;
      const picked = pickCatalogProvider(mod, catalog);
      const summary = {
        providerCount,
        providerPreview: Object.keys(catalog).slice(0, 8),
        pickedProviderId: picked?.providerId ?? null,
        pickedWire: picked?.wire ?? null,
        pickedModelId: picked?.model?.id ?? null,
        pickedModelCount: picked?.modelCount ?? 0,
      };
      if (picked) {
        const clonedConfig = cloneJson(config);
        const baseUrl = mod.catalogBaseUrl(picked.provider, picked.wire);
        const applyResult = mod.applyCatalogProvider(clonedConfig, {
          providerId: picked.providerId,
          wire: picked.wire,
          baseUrl,
          apiKey: "kimix-probe-redacted",
          models: [picked.model],
          selectedModelId: picked.model.id,
          thinking: Boolean(picked.model?.capability?.thinking),
        });
        return {
          ...summary,
          applyCatalogProvider: {
            defaultModel: applyResult.defaultModel,
            providerExists: Boolean(clonedConfig.providers?.[picked.providerId]),
            aliasExists: Boolean(clonedConfig.models?.[applyResult.defaultModel]),
            defaultThinking: clonedConfig.defaultThinking,
          },
        };
      }
      return summary;
    });
    results.push(catalogResult);

    const models = Object.entries(config.models ?? {});
    const adaptiveAliases = models
      .filter(([, model]) => model?.adaptiveThinking !== undefined)
      .map(([alias, model]) => ({
        alias,
        adaptiveThinking: model.adaptiveThinking,
        model: model.model ?? null,
        provider: model.provider ?? null,
      }));

    const availability = [
      {
        feature: "后台 agent 真实终态 + 恢复提示",
        classification: "可接",
        evidence: "Session.listBackgroundTasks/getBackgroundTaskOutput/stopBackgroundTask + background.task.* events",
      },
      {
        feature: "自适应思考开关",
        classification: "可接",
        evidence: "KimiConfig.models[*].adaptiveThinking 字段和 harness.getConfig/setConfig",
      },
      {
        feature: "后台结构化提问",
        classification: "部分可接",
        evidence: "QuestionBackgroundTaskInfo 类型存在，listBackgroundTasks 可读；setQuestionHandler 仍是 handler promise，没有独立非阻塞 question 控制 API",
      },
      {
        feature: "Provider catalog/registry 导入",
        classification: "可接",
        evidence: "fetchCatalog/applyCatalogProvider/catalogModelToAlias/inferWireType 均从 SDK 导出",
      },
      {
        feature: "撤回上一条 prompt",
        classification: "可接",
        evidence: "Session.undoHistory(count) 真 SDK 方法",
      },
      {
        feature: "审批生命周期 hook 事件",
        classification: "待官方开放",
        evidence: "SDK 暴露 setApprovalHandler，但未发现 approval pending/completed 事件或列表 API",
      },
      {
        feature: "定时任务 / reminder / cron 管理",
        classification: "TUI/core-only",
        evidence: "CronFiredEvent 类型导出，但 Session/KimiHarness 没有 cron list/create/delete API",
      },
      {
        feature: "Goal mode",
        classification: "有 SDK 但本轮不接",
        evidence: "Session.createGoal/getGoal/pauseGoal/resumeGoal/cancelGoal 存在；与 Kimix 长程任务冲突",
      },
    ];

    console.log(JSON.stringify({
      ok: true,
      generatedAt: new Date().toISOString(),
      sdkEntry,
      workDir,
      exports: exportNames,
      harnessMethods,
      sessionMethods,
      configSummary: {
        defaultModel: config.defaultModel ?? null,
        defaultThinking: config.defaultThinking ?? null,
        providerCount: Object.keys(config.providers ?? {}).length,
        modelCount: models.length,
        adaptiveAliasCount: adaptiveAliases.length,
        adaptiveAliases,
      },
      results,
      availability,
    }, null, 2));
  } finally {
    if (session) await session.close();
    await harness.close();
  }
}

await main();
