---
type: Architecture
title: Runtime Routing
description: Kimix prefers the official Kimi Code Server session protocol and keeps the vendored Node SDK as a compatibility fallback.
resource: https://github.com/LiKPO4/kimix/tree/master/electron
tags: [architecture, kimi-code, server, sdk, fallback]
timestamp: "2026-06-20T00:00:00+08:00"
---

# Runtime Routing

Kimix has two supported Kimi Code integration paths. `KimiCodeServerHost` and `KimiCodeServerClient` expose official REST and WebSocket sessions when capability checks succeed. `KimiCodeHost` loads the self-contained vendored Node SDK and remains the fallback when Server startup, capability gates, or a session request fails.

# Invariants

1. A visible Kimix session maps to an official Kimi Code runtime session identifier when one is available.
2. Prompt, steer, cancel, approval, question, usage, Skill, MCP, session-tree, and diagnostic events come from official Server or SDK contracts rather than terminal-screen inference.
3. Server failure must degrade to the SDK path without discarding Kimix-local conversation history.
4. SDK refreshes must be regenerated from an identified upstream tag and commit, with provenance recorded under `vendor/kimi-code-sdk/README.md`.
5. Experimental or incomplete upstream capabilities remain behind capability checks or explicit settings.
6. A transient Server failure schedules a bounded background recovery attempt. When Server becomes ready again, an idle SDK session may return to the Server route only if the Server can resolve the same official session ID; otherwise the SDK session remains authoritative.
7. App startup must not await Kimi Server startup or session prewarm before showing the main window. The renderer should paint first; Server startup and Kimi runtime prewarm run afterward in the background.
8. Slash commands that are also official Kimi Code commands should reach the official prompt route first, including `/skill:...`. Kimix only handles product-specific slash commands locally, such as theme mapping and Claude/Codex import; local SDK-era handlers are fallback behavior after official dispatch fails.

# Main Components

* `electron/kimiCodeServerHost.ts` discovers or starts the official foreground Server.
* `electron/kimiCodeServerClient.ts` implements REST, WebSocket, reconnect, replay, and session APIs.
* `electron/kimiCodeHost.ts` adapts the official Node SDK and plugin-management APIs.
* `src/utils/kimiCodeEventMapper.ts` maps official runtime events into the Kimix timeline.

# Related Knowledge

* [Kimix](/project/kimix.md)
* [MCP and Plugin Lifecycle](/operations/mcp-and-plugin-lifecycle.md)

# Sources

* [Kimi Code 0.17 capability audit](https://github.com/LiKPO4/kimix/blob/master/docs/kimi-code-0.17-capability-gap.md)
* [Kimi Code 0.18 follow-up](https://github.com/LiKPO4/kimix/blob/master/docs/kimi-code-0.18-followup.md)
