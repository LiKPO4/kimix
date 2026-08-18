---
okf_version: "0.1"
---

# Project

* [Kimix](project/kimix.md) - Codex-style desktop interface built on the official Kimi Code runtime.

# Architecture

* [Collaboration Room Routing](architecture/collaboration-room-routing.md) - How multi-Agent rooms isolate official sessions while projecting routing, queues, visible-body sharing, and recovery into one conversation.
* [Interface Style System](architecture/interface-style-system.md) - How color themes remain independent while component roles own shape, depth, focus, and interaction styling.
* [Runtime Routing](architecture/runtime-routing.md)
* [Sidebar Session Catalog Confirmation](architecture/sidebar-session-catalog.md) - Expanding a project confirms the official session catalog before rendering its list, so Web-archived sessions never flash in and then vanish. - How Kimix routes sessions between the official Server and vendored SDK fallback.
* [Streaming Render Pipeline](architecture/streaming-render-pipeline.md) - How streaming output stays cheap and correct through identity-preserving projection, offset-anchored draft assembly, and scroll-yield viewport gates.
* [Chat Viewport State](architecture/chat-viewport-state.md) - How completed turns, tail following, explicit navigation, and detached viewport anchoring keep one state owner.

# Operations

* [MCP and Plugin Lifecycle](operations/mcp-and-plugin-lifecycle.md) - Safe discovery, update, reload, and recovery rules for MCP servers and Kimi plugins.
* [Release Process](operations/release-process.md) - Tag-driven GitHub Actions release procedure and required release-note checks.

# Maintenance

* [Knowledge Maintenance Policy](maintenance/knowledge-maintenance.md) - End-of-task and scheduled rules for keeping this OKF bundle accurate, discoverable, and conformant.

# Decisions

* [User-Controlled Multi-Agent Rooms](decisions/user-controlled-multi-agent-rooms.md) - Why ordinary conversations can add independently configured, explicitly routed Agent participants without a separate product mode.
* [Adopt OKF v0.1](decisions/adopt-okf-v0.1.md) - Why Kimix uses a dedicated OKF bundle and how project rules extend the draft specification.

# References

* [Open Knowledge Format v0.1](references/okf-v0.1.md) - Pinned upstream specification facts, implementation caveats, and source links.
