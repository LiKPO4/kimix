---
type: Architecture
title: Runtime Routing
description: Kimix prefers the official Kimi Code Server session protocol and keeps the vendored Node SDK as a compatibility fallback.
resource: https://github.com/LiKPO4/kimix/tree/master/electron
tags: [architecture, kimi-code, server, sdk, fallback]
timestamp: "2026-06-21T09:33:00+08:00"
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
7. App startup must not await Kimi Server startup, session prewarm, official history restore, or stale runtime recovery before showing the main window. The renderer should paint first; Server startup, Kimi runtime prewarm, and official history recovery run afterward in the background.
8. Kimix permission modes mirror official Kimi Code permission modes: `manual`, `auto`, and `yolo`. Server approval events in `yolo` mode are resolved through the official approval API without surfacing a user approval card.
9. Slash commands that have an official Kimi Code API should use that API instead of being sent as ordinary prompt text. `/skill:<name>` must resolve the Skill from the official session list and call the official activation endpoint. A local/Codex Skill candidate may be copied without overwrite into the Kimi Code user Skill directory; because a running Server session keeps its initial Skill registry, Kimix must fork that session to preserve context while refreshing the registry, switch the visible session to the forked runtime, and confirm visibility before activation. Migration or activation failure must not fall through to a plain prompt with the Skill prefix removed. Kimix-only commands, such as theme mapping and Claude/Codex bulk import, remain local.
10. Development startup should distinguish daily launch, hot-reload development, and cold-cache verification. `start-kimix.bat` defaults to the already-built Electron app so the renderer does not block first paint on Vite dev compilation; `start-kimix.bat --dev` is the explicit hot-reload path, and `start-kimix.bat --clean` kills old dev processes, clears caches, rebuilds, and then launches the built app.
11. Renderer runtime events and statuses use only the `kimi-code:event` and `kimi-code:status` IPC channels. Handoff jobs, long tasks, and sessions restored from older local data share this canonical event source; the main process must not duplicate Host events onto legacy `kimi:event` or `kimi:status` channels.
12. Agent Skills installed by Skill workflows under `~/.agents/skills` are synchronized without overwrite into the Kimi Code user Skill directory before every prompt path that may use them, including direct `/skill:` activation. Because Server discovery only registers direct children of the Skill root, nested Agent Skills are also copied as top-level registration directories while their frontmatter names preserve full routes such as `game-development/game-design`. Creating any new synchronized registration entry invalidates the active Server registry regardless of the source file's older mtime; the runtime must be forked before activation or prompt submission so context is retained and the new registry is loaded.
13. Official Skill activation prompts contain `<kimi-skill-loaded>` internal instructions in wire history. Neither raw history mapping nor persisted local-session restoration may expose that payload as user-authored text: user-triggered activation is summarized as `/skill:<name> [args]`, while model-triggered activation is represented as Skill status metadata. Persisted official titles beginning with `User activated the skill` are migrated to a concise local title during restoration.
14. Server text deltas may be interleaved with tool, compaction, or subagent lifecycle events at arbitrary token boundaries, including inside words, Markdown constructs, list items, and headings. Renderer process events must never synthesize whitespace into assistant content; text deltas are concatenated exactly, and line breaks come only from Server content. Startup recovery reconciles recent locally accumulated assistant bodies with canonical completed official history so previously cached assembly errors are replaced.
15. The assistant process timer measures one complete user turn, from the initiating user message until the terminal turn event. Thinking, output, tool, subagent, status, and steer phase transitions may change the process label but must not reset the elapsed-time anchor. Completed duration prefers the user-turn interval over assistant-phase duration fields.

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
