# Kimi Code 0.14.0 Follow-up

- Date: 2026-06-11
- Upstream package: `@moonshot-ai/kimi-code@0.14.0`
- Upstream tag: `@moonshot-ai/kimi-code@0.14.0`
- Upstream commit: `ecc049611508ca0e1b8ffbc8a2788b5ccc4c250e`
- Official node SDK package version: `@moonshot-ai/kimi-code-sdk@0.9.1`

## Completed In Kimix v2.9.22

- Refreshed `vendor/kimi-code-sdk/index.mjs` from the official 0.14.0 source tree.
- Updated vendor provenance in `vendor/kimi-code-sdk/README.md`.
- Confirmed the refreshed SDK imports, creates a session, reads config, lists plugins/skills, and exposes newer session APIs including `setSwarmMode`, `swarm`, `reloadPlugins`, `removePlugin`, `getPluginInfo`, and `undoHistory`.
- Added official `Interrupt` to Kimix hook event types, validation, generation prompt, and the Hooks panel event picker.
- Added a minimum `/swarm` SDK bridge in Kimix: `/swarm on`, `/swarm off`, and `/swarm <task>` now call official `Session.setSwarmMode()` / `Session.swarm()` instead of falling through as normal text.
- `/swarm <task>` now explicitly enters official task-triggered Swarm mode before sending and shows a local "Swarm task started" status instead of inserting an artificial empty assistant placeholder.
- Added a TodoList-like composer dock card for Swarm subagents. It is derived from official `subagent.spawned` / `subagent.started` / `subagent.suspended` / `subagent.completed` / `subagent.failed` events and can be collapsed into the right session sidebar.

## Probe Notes

- Installed CLI: `kimi --version` -> `0.14.0`.
- npm latest: `pnpm view @moonshot-ai/kimi-code version` -> `0.14.0`.
- Official SDK build in the research checkout completed successfully, including `build:dts`.
- Light runtime probe created session `session_c58288a0-41ff-4714-9e92-9b0438ddbd2a` and verified `setSwarmMode(false)`.
- `Session.listPlugins()` currently returns installed plugin fields such as `id`, `displayName`, `version`, `enabled`, `state`, `source`, and `originalSource`; it does not include marketplace update metadata, so Kimix must compare installed plugins with marketplace entries itself.

## Still Not Fully Followed Up

- `/swarm` richer UI: the composer dock card now shows lifecycle progress, but it still does not display each subagent's live model delta/tool-call tail.
- Interactive undo selector: Kimix has `/undo <count>` and one-step toolbar undo, but not the official interactive selector or clearer limit UI.
- Marketplace plugin update badges and in-place update: Kimix has marketplace/install support, but needs local-vs-latest comparison and an explicit update action.
- Tool image output rendering for OpenAI-compatible models: upstream 0.14.0 preserves tool image outputs; Kimix still needs an event-payload fixture to confirm `kimiCodeEventMapper` and `MessageBubble` render those images.
- Grouped subagent progress parity: Kimix displays subagent summaries, but not all official grouped progress details and timing.
- OpenAI-compatible `xhigh` reasoning effort: needs a config roundtrip check before exposing or preserving it in the settings UI.
