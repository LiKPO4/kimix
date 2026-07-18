# Architecture

* [Chat Viewport State](chat-viewport-state.md) - How completed turns, tail following, explicit navigation, and detached viewport anchoring keep one state owner.
* [Collaboration Room Routing](collaboration-room-routing.md) - How one Kimix room isolates runtime ownership, preserves repeated user prompts through identity-safe replay repair, survives renderer reload, binds official history, queues work, and settles unavailable Agent runtimes safely.
* [Runtime Routing](runtime-routing.md) - How Kimix routes sessions between the official Server and vendored SDK fallback while preserving live-turn authority, snapshot message identity, and process history.
