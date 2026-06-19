---
type: Runbook
title: MCP and Plugin Lifecycle
description: Safe rules for configuring ordinary MCP servers and updating plugin-provided MCP servers without self-locking managed directories.
resource: https://github.com/LiKPO4/kimix/blob/master/src/components/layout/McpPanel.tsx
tags: [mcp, plugins, operations, troubleshooting]
timestamp: "2026-06-19T00:00:00+08:00"
---

# MCP and Plugin Lifecycle

Kimix distinguishes ordinary MCP configuration from MCP servers bundled inside a Kimi Plugin.

# Ordinary MCP Servers

* Ordinary entries are maintained in the Kimi Code `mcp.json` file with a backup before mutation.
* Writing a plugin MCP into `mcp.json` is a legacy compatibility action, not a prerequisite for Kimix or Kimi Code to use the plugin-provided server.
* The Kimi Code 0.18.0 CLI does not expose supported `kimi mcp ...` management subcommands, so Kimix must not fabricate that command path.

# Plugin-Provided MCP Servers

* Discovery and enablement use official SDK harness/plugin APIs.
* Updates use the plugin's original source or marketplace source through the official install API.
* Before updating a plugin loaded by the active runtime, Kimix closes that runtime and any internal plugin-management session that could hold the managed plugin directory open.
* A successful plugin change requires `/reload`, a new session, or application restart before the new MCP implementation is assumed active.
* `EBUSY`, `EPERM`, `ENOTEMPTY`, locked-directory, and resource-busy errors mean another Kimi Code or Kimix process may still hold the plugin directory.

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
