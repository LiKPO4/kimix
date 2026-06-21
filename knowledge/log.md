# Kimix Knowledge Update Log

## 2026-06-21
* **Streaming Markdown**: Prevented tool or subagent boundaries from inserting paragraph breaks inside unfinished strong-emphasis syntax, and added canonical official-history recovery for previously cached malformed assistant Markdown.
* **Skill lifecycle correction**: Required Agent Skill synchronization on direct `/skill:` activation as well as ordinary prompts, and made newly created flattened registrations invalidate the active Server registry even when packaged source mtimes are older than the session.
* **Skill history correction**: Added persisted-session migration so cached `<kimi-skill-loaded>` payloads and synthetic activation titles cannot bypass raw official history sanitization.

## 2026-06-20
* **Skill lifecycle**: Added post-install synchronization from `~/.agents/skills` and timestamp-based runtime refresh before the next ordinary prompt, using an official fork to retain context while loading the new Skill registry. Nested Agent Skills are flattened into direct registration directories while preserving their slash-qualified route names.
* **Skill history**: Prevented official `<kimi-skill-loaded>` instruction payloads from appearing as user messages after history reload; retained only concise user-triggered commands or model-triggered Skill status.
* **Skill routing**: Required `/skill:<name>` to use official Skill activation rather than ordinary prompt fallback. Local/Codex candidates may be migrated without overwrite into the Kimi Code user Skill directory; the active session is then forked to retain context while refreshing its Skill registry before activation.
* **Runtime routing**: Consolidated renderer event delivery onto `kimi-code:event` and `kimi-code:status`; handoff, long-task, and legacy local-session handling now consume the same canonical Host event stream instead of duplicated legacy IPC broadcasts.
* **Startup**: Split daily launch, hot-reload development, and cold-cache verification. `start-kimix.bat` now defaults to the already-built Electron app to avoid Vite dev renderer compile white screens; `--dev` keeps hot reload and `--clean` keeps the full cache-clean rebuild path. Startup logs now separate main-window, renderer, and Kimi Server timings.
* **Runtime routing**: Clarified that startup must defer official history restore and stale runtime recovery until after renderer first paint; Server `yolo` approvals are auto-resolved via the official approval API.
* **Runtime routing**: Added the slash command rule that official Kimi Code commands, including `/skill:...`, route through Server/SDK prompt dispatch first, while Kimix-only commands stay local and SDK-era handlers act as fallback.
* **Runtime routing**: Documented that app startup must show the renderer before Kimi Server startup or runtime prewarm.
* **Runtime routing**: Added bounded Server recovery and safe promotion of idle SDK sessions when the same official session ID is available.
* **Automation**: Added end-of-task knowledge classification and a weekly maintenance audit for stale, orphaned, duplicated, or future-dated concepts.

## 2026-06-19
* **Initialization**: Established the Kimix OKF v0.1 knowledge bundle.
* **Creation**: Added project, runtime routing, MCP lifecycle, release, maintenance, adoption decision, and upstream specification concepts.
* **Validation**: Added spec-only and Kimix strict-profile validation commands plus CI enforcement.
