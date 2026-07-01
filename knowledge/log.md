# Kimix Knowledge Update Log

## 2026-07-01

* **Bottom-first session rendering**: Replaced whole-chat startup hiding with an eager four-item tail; canonical history expands upward in a layout commit while preserving the bottom position. See [/project/kimix.md](/project/kimix.md).
* **Startup Markdown settlement**: Extended the startup reveal gate through eager visible-range Markdown rendering so bottom alignment uses real DOM height rather than deferred placeholder estimates. See [/project/kimix.md](/project/kimix.md).
* **Startup chat reveal gate**: The cached active session can populate navigation immediately, but the chat stream is revealed only after official history hydration settles and layout-phase bottom alignment runs. See [/project/kimix.md](/project/kimix.md).
* **Scroll intent boundary**: Documented that browser clamping after asynchronous content shrink is not user scrolling and must not cancel the session-open auto-follow window. See [/project/kimix.md](/project/kimix.md).
* **Per-turn model attribution**: Historical response badges now use official turn-scoped usage records, while the footer follows the latest active runtime and is refreshed after Server-to-SDK migration.
* **Lazy model compatibility correction**: Moved missing OpenAI-compatible `max_output_size` normalization from model selection to the first real prompt; provider resolution comes from the active configured alias and each model is checked once per process.
* **Model-switch compatibility**: Restricted switching to configured aliases, added the missing third-party OpenAI output cap through the official config API, and prevented idle model status from rewriting the preceding turn metadata.
* **Session-scoped model switching**: Documented that the chat footer uses official Server/SDK session model APIs, never rewrites the global default, and only updates local display state after official success while the turn is idle.

## 2026-06-30

* **Mid-turn fallback prohibition**: Added invariant #36 that Server→SDK fallback is only permitted between turns; mid-turn Server prompt failure propagates as an error and the next turn uses the existing SDK session.
* **Error reporting convention**: Documented `reportError` utility in release-process.md; background operation failures must use reportError or logError instead of silent .catch(() => {}).
* **Long-task status deduplication**: Generic kimi-code status listener now skips longTask sessions; the dedicated longTask listener is the sole handler.
* **Long-task thinking**: `longTasks:create` now forwards the user's defaultThinking setting to the executor session via createSession.
* **Long-task pause targeting**: Pause now cancels the active agent's runtime (reviewer or executor) instead of always targeting executorSessionId.
* **Recovery draft fallback**: `applyTargetStep` falls back to persisted `longTask.targetStep` when draft is empty for recovery continuation.
* **Structured session-missing detection**: Both renderer and main-process `isKimiCodeSessionMissingError` now check `error.statusCode` before regex fallback; HTTP/Api errors in `kimiCodeServerClient.request` carry statusCode.
* **Per-runtime ref cleanup**: Added `cleanupRuntimeRefs` to trim `notifiedQuestionRequestRef`, `hiddenLongTaskEventsRef`, and `longTaskReviewDispatchRef` when runtime sessions end.
* **History loading cap**: `parseKimiCodeWireEvents` truncates to the most recent 2000 events to prevent OOM on very long sessions.
* **Bootstrap setters stability**: `useBootstrap` now receives a `useMemo`-stabilized setters object so `listRecentProjects()` does not fire on every render.
* **ChatThread debug effect removed**: The no-dependency `useEffect` that logged render state and visibility to console and writeDiag on every frame has been removed.
* **Sidebar sync dep narrowed**: Sidebar session-sync effect now depends only on `currentSessionId`, `updatedAt`, and `eventsLength` instead of the whole session object.
* **Reviewing stage label**: LongTaskInspectorPanel now displays "审查中" instead of "paused" when the long task stage is reviewing.
* **Archive runningSessionId cleanup**: Archiving a running session now clears `runningSessionId` in the app store.
* **moveChat view switching**: `moveChat` now sets workspace view to "chat" when switching sessions.
* **Project service concurrency**: Added `serialWrite` mutex to serialize read-modify-write operations in projectService.

## 2026-06-30
* **History cache migration**: Added the invariant that persisted Kimi timelines carry a mapping version and stale caches reload once from official history, with richer canonical process events replacing incomplete local mirrors.
* **Local history tool boundaries**: Recorded that Kimi wire history nests `tool.call` and `tool.result` inside loop events and these records must survive parsing for thought/tool interleaving to remain reconstructable.
* **Assistant process timeline**: Documented that thinking phases must retain tool-call boundaries, including the official equal-timestamp think-before-tool convention, and use each phase's final natural paragraph as its collapsed summary.
* **Safe bidirectional theme deletion**: Split local preset removal from destructive source deletion and documented the confirmation plus main-process path guard required before deleting a Kimi theme JSON.
* **Theme scan reconciliation**: Documented that imported Kimi theme presets mirror their source directory and must remove stale cached records when source JSON files are deleted, without deleting presets from other sources.
* **Visible slash command invariant**: Slash commands handled outside the generic prompt path now append the original command as an optimistic user message before dispatch; matching official Skill echoes are deduplicated so commands remain visible without duplicate bubbles.
* **Official slash routing**: Confirmed Kimi Code 0.20.2 exposes `custom-theme`, `import-from-cc-codex`, and `mcp-config` as built-in user-only Skills and documented that Kimix must activate Skills and dispatch Server-supported session commands through official APIs before generic prompt submission; Goal, Swarm, and reload remain SDK-only compatibility boundaries.

## 2026-06-29
* **Kimi Web readiness**: Documented that browser session deep links must wait for the official health endpoint because a successful launcher exit can precede daemon port and WebSocket readiness, especially while replacing a stale lock.

## 2026-06-26
* **Runtime routing**: Documented managed Server process protection: exited foreground children and repeated WebSocket reconnect failures must demote Server routing and enter bounded recovery instead of keeping a stale ready state.

## 2026-06-23
* **Background task boundary**: Confirmed Server 0.19 exposes `/tasks` list/get/cancel but no foreground-to-background detach REST route; Kimix keeps Server task viewing in the existing panel and exposes SDK `detachBackgroundTask` only on the compatibility chain.
* **Kimi Code 0.19 correctness probes**: Added the Server snapshot schema probe, confirmed 0.19 snapshot fields remain compatible with Kimix history and pending-gate replay, mapped `reason: filtered` turns as safety-policy blocks, and aligned inline image MIME handling with upstream byte sniffing.
* **Kimi Code 0.19 runtime routing**: Refreshed the vendored SDK to official node-sdk `0.10.0` and wired Kimix extra work directories into SDK-backed create/resume/startRuntime through official `additionalDirs`; Server REST still has no explicit additionalDirs create field, so Kimix treats that as an upstream capability boundary.

## 2026-06-21
* **Prompt runtime recovery**: Made prompt dispatch re-register persisted sessions missing from active runtime maps; queued prompts can rebuild a truly missing runtime in the same project and retain recoverable failures locally without exposing internal session errors.
* **Server history gates**: Added a history-specific snapshot replay path that restores pending approval and question events when reopening Server sessions, while preserving the live resync path.
* **Official default model**: Routed default-model-only changes through the catalog action, clarified concise settings messages, and documented that Server 0.18 has no destructive model or Provider route.
* **Official config writes**: Routed non-destructive global config mutations through the Server merge API with explicit camelCase-to-wire conversion and SDK fallback.
* **Official OAuth lifecycle**: Preferred Server auth state, device login, pending-flow cancellation, and logout while retaining SDK and local-credential fallbacks for unavailable or failed Server routes.
* **Official file uploads**: Routed local Server prompt images through the multipart `/files` lifecycle and referenced the returned file ID across prompt, steer, and BTW routes.
* **Official image content**: Kept the Electron-native folder picker as a platform adapter and replaced legacy Server `image_url` prompt payloads with official image base64/URL sources.
* **Official file preview**: Routed Server-backed project text previews through session-scoped `fs:read` with root matching, UTF-8 and size gates, while keeping user-home Kimi plan files on the local path.
* **Official file search**: Routed Server-backed file mentions through the session-scoped official filesystem search with project-root validation, retaining local search for SDK, empty-query, unavailable, and failure paths.
* **Official workspace binding**: New Server sessions now register or touch their project root through the official workspace API and use the returned workspace ID and canonical root, while Kimix keeps local project-only metadata separate.
* **Runtime-aware Slash catalog**: Made Slash completion depend on the active Server or SDK session and use a conservative catalog while runtime identity is unavailable, preventing Server sessions from advertising SDK-only Goal, Swarm, or reload actions.
* **Prompt queue coordination**: Added a lightweight official prompt-queue check before local pending-message dispatch; Server active/queued prompts defer local shift, and abort no longer reports interruption while official prompts remain.
* **Official history source**: Made Server snapshots the preferred source for loading session history, including user-message replay and content.part assistant chunks, with local mirror fallback for unavailable snapshots and legacy sessions.
* **Session catalog authority**: Switched startup and project-change catalog reconciliation to the successful official Server session list; missing same-project official mirrors are locally archived while SDK fallback, local-only, long-task, and other-project sessions are preserved.
* **Runtime capability boundary**: Marked Goal, Swarm, and direct reload as unsupported on Server sessions until official Server APIs exist; these paths must fail explicitly instead of falling through to SDK-only session lookup or pretending a metadata refresh is a reload.
* **Archive lifecycle**: Made official archive success authoritative, removed local-only unarchive, stopped Server subscriptions after archive, and changed unavailable SDK archive capability from silent success to an explicit error.
* **Session discovery**: Made the local sidebar catalog a recoverable mirror of every visible non-archived official session, with lazy message loading and preservation of local content and archive tombstones.
* **Canonical text assembly**: Removed process-boundary paragraph guessing from assistant delta merging; recent cached assistant bodies now reconcile against official completed history to repair arbitrary word, list, and heading splits.
* **Turn timing**: Unified live and completed assistant timing around the initiating user message; process phase changes no longer reset elapsed time, and user-facing durations use Chinese minute/second units.
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
