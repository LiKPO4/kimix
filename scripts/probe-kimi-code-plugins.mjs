import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sdkEntry =
  process.env.KIMIX_KIMI_CODE_SDK_ENTRY ??
  path.join(repoRoot, "vendor", "kimi-code-sdk", "index.mjs");
const probeRoot = path.join(os.tmpdir(), "kimix-kimi-code-plugins-probe");
const homeDir = path.join(probeRoot, "kimi-home");
const workDir = path.join(probeRoot, "work");
const pluginRoot = path.join(probeRoot, "plugin-command-probe");
const commandDir = path.join(pluginRoot, "commands");
const commandPath = path.join(commandDir, "hello.md");

async function prepareIsolatedPluginCommandFixture() {
  await rm(probeRoot, { recursive: true, force: true });
  await mkdir(commandDir, { recursive: true });
  await mkdir(path.join(homeDir, "plugins"), { recursive: true });
  await mkdir(workDir, { recursive: true });

  await writeFile(
    path.join(pluginRoot, "kimi.plugin.json"),
    JSON.stringify(
      {
        name: "kimix-command-probe",
        version: "0.0.1",
        description: "Kimix official plugin command probe.",
        commands: "./commands/",
      },
      null,
      2,
    ),
    "utf-8",
  );
  await writeFile(
    commandPath,
    [
      "---",
      "name: hello",
      "description: Probe command from plugin manifest",
      "---",
      "请只回复一行：Plugin command activated: $ARGUMENTS",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(homeDir, "plugins", "installed.json"),
    JSON.stringify(
      {
        version: 1,
        plugins: [
          {
            id: "kimix-command-probe",
            root: pluginRoot,
            source: "local",
            enabled: true,
            installedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            capabilities: {},
          },
        ],
      },
      null,
      2,
    ),
    "utf-8",
  );
}

async function main() {
  await prepareIsolatedPluginCommandFixture();
  const sdk = await import(pathToFileURL(sdkEntry).href);
  const options = {
    homeDir,
    identity: {
      userAgentProduct: "kimi-code-cli",
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? "0.22.2",
    },
    uiMode: "kimix-plugins-probe",
  };
  const harness = typeof sdk.createKimiHarness === "function"
    ? sdk.createKimiHarness(options)
    : new sdk.KimiHarness(options);

  let session;
  const commandEvents = [];
  try {
    session = await harness.createSession({
      workDir,
      metadata: { source: "kimix-plugins-probe" },
    });
    const plugins = await session.listPlugins();
    const pluginCommands = typeof session.listPluginCommands === "function"
      ? await session.listPluginCommands()
      : null;
    const unsubscribe = typeof session.onEvent === "function"
      ? session.onEvent((event) => {
        if (["plugin_command.activated", "turn.started", "turn.ended", "session.meta.updated"].includes(event?.type)) {
          commandEvents.push(event);
        }
      })
      : undefined;
    let activateCommandError = null;
    if (typeof session.activatePluginCommand === "function") {
      try {
        await session.activatePluginCommand("kimix-command-probe", "hello", "ARG_OK");
      } catch (error) {
        activateCommandError = error instanceof Error ? error.message : String(error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    unsubscribe?.();
    const sessionId = session.id;
    const hasListPluginCommands = typeof session.listPluginCommands === "function";
    const hasActivatePluginCommand = typeof session.activatePluginCommand === "function";
    await session.close();
    session = undefined;
    console.log(JSON.stringify({
      ok: true,
      sdkEntry,
      homeDir,
      workDir,
      sessionId,
      count: plugins.length,
      plugins: plugins.map((plugin) => ({
        id: plugin.id,
        displayName: plugin.displayName,
        enabled: plugin.enabled,
        state: plugin.state,
        source: plugin.source,
        skillCount: plugin.skillCount,
        mcpServerCount: plugin.mcpServerCount,
        enabledMcpServerCount: plugin.enabledMcpServerCount,
        hasErrors: plugin.hasErrors,
        commandCount: plugin.commandCount,
      })),
      hasListPluginCommands,
      hasActivatePluginCommand,
      pluginCommands: pluginCommands?.map((command) => ({
        pluginId: command.pluginId,
        name: command.name,
        description: command.description,
        path: command.path,
        bodyIncludesArgumentsMarker: typeof command.body === "string" && command.body.includes("$ARGUMENTS"),
      })) ?? null,
      activateCommandError,
      commandEvents: commandEvents.map((event) => ({
        type: event.type,
        pluginId: event.pluginId,
        commandName: event.commandName,
        commandArgs: event.commandArgs,
        title: event.patch?.title,
        lastPrompt: event.patch?.lastPrompt,
      })),
    }, null, 2));
  } finally {
    if (session) await session.close().catch(() => undefined);
    await harness.close();
  }
}

await main();
