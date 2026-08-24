# Architecture

* [Chat Viewport State](chat-viewport-state.md) - How completed turns, tail following, explicit navigation, and detached viewport anchoring keep one state owner.
* [Composer Draft Lifecycle](composer-draft-lifecycle.md) - How unsent Composer content survives workspace unmounts and restarts without leaking between conversations.
* [Collaboration Room Routing](collaboration-room-routing.md) - How one Kimix room isolates runtime ownership, preserves repeated user prompts through identity-safe replay repair, survives renderer reload, binds official history, queues work, and settles unavailable Agent runtimes safely.
* [Interface Style System](interface-style-system.md) - How role-based material styling stays separate from color-token generation while custom styles carry one controlled, backward-compatible palette linkage.
* [Runtime Routing](runtime-routing.md) - How Kimix routes official sessions while preserving runtime authority, session-scoped Plan/work-chip state, structured attachment transport, session-model ownership, declared custom-model capabilities, snapshot identity, completion barriers, isolated credentials, usage metadata, and process history.
* [Streaming Render Pipeline](streaming-render-pipeline.md) - How streaming output and derived file-change cards preserve source identity and current-turn ownership through replay, projection, active drafts, and viewport rendering.
* [Sidebar Session Catalog Refresh](sidebar-session-catalog.md) - Expanding a project shows its store sessions immediately while the official catalog refresh runs in the background, so archives settle with a bounded one-frame update instead of a forced wait.
