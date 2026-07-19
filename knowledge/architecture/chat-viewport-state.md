---
type: Architecture
title: Chat Viewport State
description: How chat rendering assigns turn activity and gives one owner control of tail-follow and detached viewport anchoring.
resource: https://github.com/LiKPO4/kimix/tree/master/src/components/chat
tags: [architecture, chat, viewport, scrolling, content-version]
timestamp: "2026-07-19T09:15:00+08:00"
---

# Chat Viewport State

## Turn ownership

Runtime state and timeline state answer different questions. `runningSessionId`
means the runtime is busy; it does not identify which already-rendered Assistant
bubble owns that work. A completed Assistant with durable body or thinking stays
complete when a later prompt starts. The active turn remains open only through
its own incomplete Assistant, running tool/subagent, room activity identity, or
an output-less latest turn that is still waiting for its first authoritative
event. This prevents the previous bubble from flashing back to “消息处理中” during
the short state-ordering gap before the next optimistic user event is rendered.
The optimistic Assistant event is not presentation authority: if reload,
snapshot reconciliation, or a slow first model event leaves an active latest
user turn without that event, the renderer derives one stable process header
from the user event identity. A busy runtime therefore cannot remove the new
turn's header or attach it to the completed turn above.

Assistant activity is decided once by the turn projection and passed as an
explicit render property. Individual bubbles never consume session-global
runtime state. In a single-Agent timeline, the next `user_message` is a hard
display settlement boundary: it preserves the previous turn's final usage and
normalizes stale incomplete Assistant/process flags instead of allowing the new
runtime to reactivate that footer. A legacy/non-collaboration session still has
a synthetic primary room Agent at the live-event boundary, so its Composer must
create a concrete `roomMessageId + agentTurnId` before prompt dispatch. Sending,
accepted, running, approval/question waits, and terminal updates preserve that
identity. The renderer matches activity by turn identity rather than Agent ID:
an intermediate `tool_use` step may close its streamed segment, but cannot mark
the prompt complete or reactivate another turn owned by the same Agent. Room
activity uses the same identity rule because later queued room messages do not
necessarily settle an earlier Agent delivery.

## Viewport ownership

The chat viewport has two modes:

- Following mode owns the canonical tail and may write the bottom position when
  content or viewport geometry changes.
- Detached mode belongs to explicit user intent. Wheel, touch, scrollbar,
  navigation keys, rail navigation, and search focus atomically cancel tail
  settlement, invalidate the old anchor generation, and capture a new rendered
  message anchor after the move. Streaming may preserve that anchor but may not
  resume following without explicit downward intent reaching the tail.

The session-open transaction starts only after the real scroll viewport has
mounted. An official-history loading placeholder has no scroll owner and may
not mark the session as primed; when loading finishes, readiness re-runs both
bottom settlement and `ResizeObserver` attachment against the mounted node.
The bounded initial tail remains structurally stable during ordinary wheel or
touch input. Hidden history is mounted only by an explicit history disclosure
or navigation request, with a rendered-message anchor protecting that explicit
expansion. User input must never both move the viewport and change its history
window in the same transaction.

Rail/search navigation uses an immediate scroll transaction. A smooth animation
would expose multiple intermediate `scrollTop` values while streaming commits
are also trying to preserve an anchor, so it is not a stable ownership boundary.
Navigation retry state exists only while older rendered history can still be
expanded. A terminal miss clears that attempt immediately so an asynchronously
mounted target is focusable on the next click. Highlight expiry is a replaceable
lease owned by the latest target: focusing another marker cancels the previous
timer, which may never clear the newer highlight.

Chromium native scroll anchoring remains enabled in following mode as the first
line of tail stabilization. It is disabled only in detached mode, where Kimix's
rendered-message anchor must be the sole reflow writer.

## Content revisions

`contentVersion` is a bounded structural revision token. It contains session
identity/recency, timeline and render-item counts, the last render key, bounded
Assistant lengths, and object-identity revisions for already-bounded render
items. It never serializes or hashes full message bodies. The viewport uses it
to detect same-length canonical corrections, process updates, and other layout
changes that may need detached-anchor recovery.

`ResizeObserver` owns asynchronous content and viewport geometry changes.
`contentVersion` participates in synchronous detached-anchor recovery but never
creates another tail-follow loop. Process-collapse transactions may temporarily
add exact tail compensation when content shrink would otherwise clamp the saved
anchor beyond the new scroll range.
