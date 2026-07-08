# Kimix Knowledge Update Log

## 2026-07-08

* **Update history comes from GitHub Releases**: The dialog receives the latest three repository releases through the main-process update check, with the GitHub Releases Atom feed as a rate-limit fallback instead of bundled stale records. See [/project/kimix.md](/project/kimix.md).

## 2026-07-07

* **Session toolbar actions stay inside the chat main area**: The toolbar now uses a shrinkable title column plus a fixed actions column, so opening the right inspector moves the complete action group left instead of clipping its trailing buttons. See [/project/kimix.md](/project/kimix.md).
* **Font-size baseline migration**: The adjustable UI font setting now preserves the historical 15px chat/Composer baseline and migrates the accidentally persisted 14px default once, while a migration marker protects later explicit 14px choices. See [/project/kimix.md](/project/kimix.md).
* **Non-foldable process text matches thinking summaries**: Kimi Web single-paragraph items without expandable detail share the same secondary typography as foldable thinking summaries; only the foldable item gains button, hover, and disclosure behavior, while final Assistant Markdown remains primary text. See [/project/kimix.md](/project/kimix.md).
* **Electron chat shell uses viewport units**: Runtime DOM measurement proved `height: 100%` expanded with an 18k-pixel history despite an 800px root; `height/max-height: 100dvh` is the definite outer boundary that keeps Composer visible and delegates long content to the inner scroller. See [/project/kimix.md](/project/kimix.md).
* **Startup catalog has no implicit navigation ownership**: Official catalog reconciliation may populate the sidebar, but it may hydrate and select a startup conversation only when it matches a persisted active/local runtime identity; catalog position zero is not a navigation fallback. See [/project/kimix.md](/project/kimix.md).
* **Chat shell height ownership**: Definite Grid tracks own the application and chat-panel height, every nested viewport remains shrinkable, and only the inner message viewport owns overflow; long histories cannot push Composer or ContextBar outside the Electron window. See [/project/kimix.md](/project/kimix.md).
* **Thinking defaults preserve official ownership**: Missing session `thinking` is no longer normalized to `off`; Kimix omits the field for Kimi managed defaults and only sends `off` for explicit user disablement or known third-party downgrade. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Official archive restore**: Settings now distinguishes official archived sessions from local archive records, lists official archived sessions via `archived_only=true`, and restores them through Server `:restore` before clearing local tombstones. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Official `select_tools` flag passthrough**: Kimix exposes Kimi Code 0.23's `tool-select` experimental flag as a narrow setting and writes it through the official config merge route while relying on the upstream model capability gate. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Queue UI ownership matches official Web**: Editable queued messages remain a frontend-local queue, while Server prompt active/queued state is only a dispatch gate; Server 0.23 token headers remain required when present. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Server archive restore boundary**: Official Server active catalog rows may now clear local archive state, while SDK active rows remain blocked by tombstones to avoid accidental resurrection. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).

## 2026-07-06

* **Streaming scroll diagnostics stay off hot paths**: Routine contentVersion/resize logs and no-op manual anchor restores are removed or throttled so tool output does not block renderer timers and painting. See [/project/kimix.md](/project/kimix.md).
* **Streaming content shrink preserves the viewport**: Auto-follow snapshots the pre-commit bottom distance and restores it synchronously when Kimi Web thinking folds from multiple lines to a shorter paragraph. See [/project/kimix.md](/project/kimix.md).
* **Terminal runtime errors close all visible work**: SDK failure reasons, including quota HTTP 403, now terminate open subagents, tools, partial Assistant output, timers, and busy indicators instead of leaving the local timeline running. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Missing terminal-envelope display recovery**: An official `turn.step.completed` with `finishReason: end_turn` now closes Assistant display and timing when `turn.ended` is absent, without weakening the live turn boundary required by permission and other runtime mutations. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Inactive-session model mutation recovery**: Chat-footer model switching now shares the verified inactive-runtime recovery boundary with permission changes, including same-session resume, project-root validation, retry on the returned runtime ID, and no replacement session creation. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).

## 2026-07-05

* **Active-turn reload recovery**: Renderer reload now restores busy state from the still-managed official runtime, keeps in-flight snapshot Assistant content open, and reconciles richer snapshots after a quiet stream interval instead of falsely completing the turn. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).

## 2026-07-04

* **Hydrated session model authority**: Historical Assistant/usage events override stale cached session model metadata, while a pending manual switch remains visible until a later Assistant confirms the active model. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Frozen startup conversation identity**: Sidebar and startup fallback order by real user/steer/Assistant activity, while the exit-time active context is frozen before initialization and restored across UI/runtime/official/Skill-parent identities. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Official withdraw-to-draft boundary**: Withdrawing the latest completed user turn first applies official `undoHistory(1)`, then truncates the local mirror and restores text/attachments into the Composer without automatic dispatch; failed local sends skip undo, older nodes remain disabled, and external tool side effects are not rolled back. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Open-work busy boundary**: Runtime terminal/idle status cannot clear a visible turn while local live events still contain open subagents, tools, steer messages, or assistant output; the stale window is only for historical residue cleanup. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Session-locked Swarm route**: Swarm remains SDK-only, but an idle Server-backed conversation may switch the same official session ID to SDK and stay pinned there instead of forking or later promoting back to Server. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **SDK Plugin command boundary**: SDK slash completion may expose current-session Plugin manifest commands and activate them through official `activatePluginCommand`, while Server sessions must not route those commands through the temporary plugin-management session. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Same-ID Skill registry refresh**: Missing `/skill:...` activation now prefers reloading the same session ID; idle Server sessions may degrade to SDK route under that ID because Server 0.22 lacks reload REST, with `skill-*` fork retained only as fallback. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Read-only session hydration**: Opening or searching an old session may fill history but must not rewrite non-default titles or refresh recency; navigation clicks are not conversation activity. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **First-paint Skill mirror title guard**: Sidebar first-paint dedupe may use same-project/same-title only when a row carries `skill-*` or a recorded Skill-fork parent; ordinary same-title conversations remain distinct. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Local-parent Skill fork folding**: When the official catalog only returns a `skill-*` leaf, Kimix may use its local same-project/same-title non-skill mirror as the unique transparent parent and must fall back to that parent history during startup or sidebar loading. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Metadata-loss Skill fork folding**: `skill-*` registry-refresh forks remain transparent even when official catalog metadata omits `source=kimix-fork`; Kimix folds only same-project/same-title unique predecessors and falls back to parent history if the leaf snapshot is empty. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Large-delta manual scroll recovery**: Manual chat scroll anchoring must not reuse the small resize delta cap when recovering from jump-to-top; finding the anchor without applying the required delta is a false success. See [/project/kimix.md](/project/kimix.md).
* **Manual chat scroll anchoring**: After user wheel/touch/scrollbar intent, layout-only commits from permission controls, runtime snapshots, or deferred Markdown settlement must restore a rendered message anchor rather than allowing the container to reset to the top. See [/project/kimix.md](/project/kimix.md).
* **Idle runtime status snapshots stay out of chat history**: Permission changes may trigger `agent.status.updated`, but idle snapshots are no longer appended to the visible conversation or allowed to rewrite Assistant footer time / Tokens / Context. Real `usage.record` events remain visible. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Permission changes do not re-render the chat stream**: `ChatThread` is memoized so parent permission-mode updates cannot force Markdown and message bubbles through a fresh render pass. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Permission controls are scroll-neutral**: Chat rendering no longer subscribes to permission preferences, and layout-only resizes from permission controls preserve the current viewport instead of re-running bottom-follow scrolling. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Scroll-neutral permission recovery**: Permission-mode recovery repairs inactive runtime IDs without refreshing conversation recency or replacing the current chat object, so configuration changes do not reset the chat viewport. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Inactive-session permission recovery**: User-triggered permission changes resume and verify the same old session only when `setPermission` reports inactive, then retry without creating a replacement runtime or drifting the UI mode. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Read-only old-session navigation**: Selecting an old conversation no longer resumes its runtime; stale tool calls and recovery interruptions settle without counting the offline interval as execution time. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).

## 2026-07-03

* **No implicit prompt-time Skill forks**: Ordinary messages and already-visible Skills now reuse the current runtime; only an explicit missing `/skill:...` activation may trigger one controlled registry-refresh fork. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Transparent Skill-fork lineage**: Registry-refresh `skill-*` forks now reconcile as one stable visible conversation bound to the newest runtime leaf; explicit branches and unrelated same-title sessions remain distinct. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Authoritative deferred-permission boundary**: Active-turn permission changes are bound to the current runtime and consumed only by its live `turn.ended`; renderer activity timeouts, status reconciliation, and snapshot replay cannot apply them early. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Turn-boundary permission changes**: Permission and Plan preferences no longer invalidate runtime prewarm; active-turn permission changes are deferred and applied to the existing runtime before the next prompt. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Active-context lifecycle boundary**: Active project/session state now flushes on real unload and is never written from React effect cleanup, preventing Strict Mode/HMR from erasing startup restoration state. See [/project/kimix.md](/project/kimix.md).
* **Bilingual default-title handling**: English and Chinese Kimi placeholder titles now share one fallback rule across catalog and live metadata paths. See [/project/kimix.md](/project/kimix.md).
* **First-frame stale placeholder filtering**: Shell and sidebar now share the same rule for hiding expired empty official sessions before catalog reconciliation. See [/project/kimix.md](/project/kimix.md).
* **Stable catalog titles and loading indicators**: Non-default official titles now win before prompt fallbacks, and inactive rows ignore stale view-loading flags. See [/project/kimix.md](/project/kimix.md).
* **Conversation-based sidebar recency**: Sidebar times now prefer the latest conversational event instead of generic session metadata updates. See [/project/kimix.md](/project/kimix.md).
* **Markdown horizontal overflow containment**: Prose and inline code visually wrap long unbroken paths while fenced code, tables, and formulas keep local overflow ownership. See [/project/kimix.md](/project/kimix.md).
* **Catalog-time title parity**: SDK summaries now carry first-prompt briefs and custom-title metadata so unlocked sidebar titles match post-hydration titles before users open a session. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Explicit SDK archive reconciliation**: SDK catalogs include archived summaries so official `archived: true` identities close local mirrors and any stale loading view without relying on absence inference. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).

## 2026-07-02

* **First-paint catalog confirmation**: Old empty local placeholders remain hidden until the official catalog confirms them, preventing archived or empty sessions from flashing before slow SDK initialization completes. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **SDK SessionStore-compatible archival**: Runtime inspection proved the 0.22 public Harness omits its internal archive RPC; fallback archival now resolves the authoritative session directory and applies the official non-destructive state transition after closing the session. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Title-independent empty-session cleanup**: Empty mirrors omitted by the SDK catalog are now identified by content and age instead of `New Session` titles, while a creation grace period protects fresh unsent sessions. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Empty-session catalog parity**: Server and SDK catalogs now follow official `exclude_empty` semantics, and abandoned empty local mirrors are hidden without deleting Kimi Code session files. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Migrated history fallback**: Empty, failed, or timed-out Server snapshots now fall back to the SDK wire mirror, and every loading entry point settles its placeholder. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Archive identity closure**: Archiving now covers every local mirror sharing an official runtime identity and writes tombstones immediately with a larger retention bound. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Kimi Code 0.22 runtime alignment**: Updated the vendored fallback to Node SDK 0.12, normalized `thinkingEffort`, retained the bounded MCP startup timeout, and verified official image-compression exports. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Durable model overrides**: Effective effort metadata now crosses the Server catalog boundary, and lazy OpenAI-compatible output limits persist under official model overrides so provider refreshes do not erase them. See [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
* **Normalize tall single-message sessions**: Initial-tail completion no longer requires hidden items; bottom-origin coordinates are replaced with normal scrolling before users browse very tall Markdown answers. See [/project/kimix.md](/project/kimix.md).
* **Stable progressive startup tail**: The first history batch now fills upward while retaining bottom-origin coordinates; explicit older-history expansion preserves a rendered message anchor across the later coordinate switch. See [/project/kimix.md](/project/kimix.md).
* **Conversation-aware startup tail**: The eager tail expands within a fixed cap to retain recent completed Assistant answers when trailing unanswered user turns would otherwise crowd them out. See [/project/kimix.md](/project/kimix.md).
* **Single-writer startup history**: The active restored session is gated before entering the store, background repair excludes it, and SDK wrapped wire records retain their original timestamp. See [/project/kimix.md](/project/kimix.md).
* **Canonical startup tail gate**: Persisted messages are no longer presented as the real bottom while an official session's first history synchronization is pending; startup history loading also begins without the former 1.2-second delay. See [/project/kimix.md](/project/kimix.md).
* **Server replay timestamps**: Snapshot-derived history frames now retain each official message's `created_at`; protocol sequence numbers are no longer interpreted as message time. See [/project/kimix.md](/project/kimix.md).
* **Bottom-origin startup tail**: The initial eager tail now uses reverse scroll coordinates so asynchronous body growth extends upward without temporarily moving the viewport away from the bottom. See [/project/kimix.md](/project/kimix.md).

## 2026-07-01

* **Demand-loaded older chat**: Background hydration no longer auto-expands the bottom-first tail; older messages prepend only on explicit upward browsing with scroll-height delta compensation. See [/project/kimix.md](/project/kimix.md).
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
