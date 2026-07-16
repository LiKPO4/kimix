---
type: Architecture
title: Chat Viewport State
description: Why ChatThread.contentVersion is intentionally coarse and how the viewport hook uses it without coupling to render item rebuilds.
resource: https://github.com/LiKPO4/kimix/tree/master/src/components/chat
tags: [architecture, chat, viewport, scrolling, content-version]
timestamp: "2026-07-16T02:30:00+08:00"
---

# Chat Viewport State

## `contentVersion` is intentionally coarse

`ChatThread` computes `contentVersion` as:

```ts
const contentVersion = useMemo(() => {
  return `${session?.id ?? ""}:${session?.updatedAt ?? 0}:${roomTimeline.length}`;
}, [roomTimeline.length, session?.id, session?.updatedAt]);
```

This is deliberately **not** derived from `renderItems` or any other derived timeline
view. The viewport hook uses `contentVersion` as a stable change signal for
scroll/resize effects. If it were tied to `renderItems`, every streaming delta
would rebuild `renderItems`, invalidate `contentVersion`, and re-trigger the
viewport effects, causing jank and fighting the user’s scroll position.

By anchoring `contentVersion` to:

- `session.id` — clears when the session changes
- `session.updatedAt` — advances when the session model is mutated
- `roomTimeline.length` — advances when events are appended/removed

we get a change signal that is stable during intra-turn streaming but still
reacts to meaningful conversation changes.

### Consequences

- Viewport effects that depend on `contentVersion` must **not** assume that every
  render-item change is reflected in it.
- Any effect that needs to react to render-item-level changes should depend on
  `renderItems.length` directly, not on `contentVersion`.
- This design was introduced in `a3ab47d3` and preserved during the P0-3
  `useChatViewport` extraction.
