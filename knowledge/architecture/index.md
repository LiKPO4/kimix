# Architecture

* [Chat Viewport State](chat-viewport-state.md) - How completed turns, tail following, explicit navigation, and detached viewport anchoring keep one state owner.
* [Composer Draft Lifecycle](composer-draft-lifecycle.md) - How unsent Composer content survives workspace unmounts and restarts without leaking between conversations.
* [Collaboration Room Routing](collaboration-room-routing.md) - How one Kimix room isolates runtime ownership, preserves repeated user prompts through identity-safe replay repair, survives renderer reload, binds official history, queues work, and settles unavailable Agent runtimes safely.
* [Interface Style System](interface-style-system.md) - How color themes stay independent from role-based shape, depth, focus, interaction styling, directional panel seams, quiet parent-row reveal actions, and bounded imported metadata.
* [Runtime Routing](runtime-routing.md) - How Kimix routes official sessions while preserving runtime authority, session-scoped Plan/work-chip state, structured attachment transport, session-model ownership, declared custom-model capabilities, snapshot identity, completion barriers, isolated credentials, usage metadata, and process history.
* [Streaming Render Pipeline](streaming-render-pipeline.md)
* [Sidebar Session Catalog Confirmation](sidebar-session-catalog.md) - Expanding a project confirms the official session catalog before rendering its list, so Web-archived sessions never flash in and then vanish. - How streaming output stays cheap through identity-preserving projection, active-turn draft writes, provider-isolated local/cloud thinking translation, plain streaming markdown, and scroll-yield viewport gates.
