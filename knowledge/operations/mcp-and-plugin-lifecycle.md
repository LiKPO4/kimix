---
type: Runbook
title: MCP and Plugin Lifecycle
description: Safe rules for configuring ordinary MCP servers and updating plugin-provided MCP servers without self-locking managed directories.
resource: https://github.com/LiKPO4/kimix/blob/master/src/components/layout/McpPanel.tsx
tags: [mcp, plugins, operations, troubleshooting]
timestamp: "2026-08-26T10:30:00+08:00"
---

# MCP and Plugin Lifecycle

Kimix distinguishes ordinary MCP configuration from MCP servers bundled inside a Kimi Plugin.

# Ordinary MCP Servers

* Ordinary entries are maintained in the Kimi Code `mcp.json` file with a backup before mutation.
* Writing a plugin MCP into `mcp.json` is a legacy compatibility action, not a prerequisite for Kimix or Kimi Code to use the plugin-provided server.
* The Kimi Code 0.18.0 CLI does not expose supported `kimi mcp ...` management subcommands, so Kimix must not fabricate that command path.
* Since Kimi Code 0.29, a dropped MCP connection is reconnected automatically when one of its tools is called, with a single retry of the call; Kimix treats that brief reconnect as ordinary tool activity, not a startup failure.

# Plugin-Provided MCP Servers

* Discovery and enablement use official SDK harness/plugin APIs.
* Updates use the plugin's original source or marketplace source through the official install API.
* Before updating a plugin loaded by the active runtime, Kimix closes that runtime and any internal plugin-management session that could hold the managed plugin directory open.
* A successful plugin change requires `/reload`, a new session, or application restart before the new MCP implementation is assumed active.
* `EBUSY`, `EPERM`, `ENOTEMPTY`, locked-directory, and resource-busy errors mean another Kimi Code or Kimix process may still hold the plugin directory.

# Built-in Capabilities

* Kimi Computer Use (`kimi-cu`) and Kimi WebBridge (`kimi-webbridge`) are NOT marketplace plugins: the official `marketplace.json` carries only kimi-datasource / superpowers / vercel-plugin. Capabilities are client-injected built-in entries exposed by the v2 engine's capability service (`harness.listCapabilities` / `installCapability`); v1 has no capability surface and Kimix degrades to an empty list plus an explicit unsupported error on install.
* A capability bundles a binary runtime plus agent wiring and reports layered readiness (`not_installed` / `partial` / `ready` / `unsupported`) with per-step states; `partial` means install can be resumed, and install progress (`install.step` / `percent`) is polled while `install.running`.
* Official `installCapability` is fire-and-forget: the RPC resolves immediately after kicking off a background install, so callers must keep polling `listCapabilities` until `install.running` flips to `false` (v2.21.60 treated RPC return as completion, which froze the UI on a stale "installing" state with no step/percent).
* Kimix surfaces them in the plugin store page through `kimi-code:listCapabilities` / `kimi-code:installCapability` IPC, and refreshes the SDK plugin state after install because installation wires a managed plugin.
* The Windows pre-install binary release (added v2.21.121 for the EPERM rename lock) must stay scoped to Kimix-owned processes: kill only PIDs that are descendants of the current process or same-name orphans whose parent has exited, via the parsed Win32_Process table (`electron/win32ProcessTree.ts`). Never `taskkill /IM` by image name globally — other Kimi tooling may run the same binary. Enumeration failure skips the pre-clean and falls back to the ordinary partial-readiness report.

# Local Skill Scan

* Local skill scanning spans multiple roots (`~/.kimix/skills`, `~/.kimi-code/skills`, `~/.agents/skills`, ...). The same skill often exists in several roots, so scan results are deduplicated by skill name in root-priority order (not by absolute path); merged duplicates are reported explicitly in `mergedDuplicates` and the enabled flag is unioned so legacy per-path enablement is not lost.


# Timeout Policy

The vendored SDK keeps explicit per-server `startupTimeoutMs` values. Only the upstream fallback is reduced from 30 seconds to 4 seconds, configurable through `KIMIX_KIMI_CODE_MCP_STARTUP_TIMEOUT_MS`.

# Recovery Sequence

1. Read the card-local error and distinguish startup timeout, source failure, and directory lock.
2. Retry after the active runtime and internal management session have been released.
3. Close other Kimi Code or Kimix windows if the managed plugin directory remains locked.
4. Update the plugin through its official source.
5. Run `/reload` or create a new session and verify the MCP runtime status.

# Related Knowledge

* [Runtime Routing](/architecture/runtime-routing.md)

# Sources

* [Kimi Code 0.18 follow-up](https://github.com/LiKPO4/kimix/blob/master/docs/kimi-code-0.18-followup.md)
* [Kimi Code plugin documentation](https://moonshotai.github.io/kimi-code/zh/customization/plugins.html)
