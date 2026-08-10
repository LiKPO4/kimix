# Steer / compaction conversation split snapshot

Date: 2026-08-10

## Scope and evidence boundary

The affected runtime session was not available as a raw Host log. This snapshot therefore records the smallest code-backed event sequence that reproduces the screenshot's three symptoms. It is intentionally not presented as a verbatim user-session SSE capture.

## Host / timeline event sequence

| order | type | id | agentTurnId | roomMessageId | content length | meaning |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | `user_message` | `user-1` | `turn-8` | `room-1` | 2 | original user boundary |
| 2 | `assistant_message` | `assistant-1` | `turn-8` | `room-1` | 3 | committed body before steer |
| 3 | `steer_message` | `steer-1` | `turn-8` | `room-1` | 2 | injected guidance boundary |
| 4 | `assistant_message` | `assistant-2` | `turn-8` | `room-1` | 3 | continued streaming segment |
| 5 | `user_message` | `user-2` | `turn-8` | `room-2` | 2 | canonical/replayed user boundary |
| 6 | `assistant_message` | `assistant-3` | `turn-8` | `room-2` | 0 | latest live placeholder |

Compaction begin/end events may be interleaved with the sequence. They do not directly flush a turn in `buildRenderItems`; the duplicate boundaries and shared turn identity are sufficient to reproduce the defect.

## UI render snapshot before the fix

`buildRenderItems` conditionally flushes at the steer and always flushes at the later user boundary. All Assistant segments then derived the same id:

```text
assistant:turn-8
assistant:turn-8
assistant:turn-8
```

That value was reused as the React key, `data-kimix-render-key`, navigation item key, marker key, and `data-kimix-event-id`. `ChatNavigationRail` stored DOM nodes in a `Map` by this key, so several markers shared one geometry entry. Event focusing queried several same-id nodes and selected the first sibling, making every marker jump to the same upper position.

The old and current Assistant segments could also both be marked active because `roomAgentActivityMatchesTurn` matched their shared `agentTurnId`. Both bubbles then subscribed to the same active-draft key:

```text
<sessionId>\0primary\0turn-8
```

One delta notification consequently rerendered both locations.

## Corrected render snapshot

Segment order is now part of the derived render identity while the underlying protocol turn identity remains unchanged:

```text
assistant:turn-8
assistant:turn-8:segment-1
assistant:turn-8:segment-2
```

Only the latest segment after a same-Agent user boundary remains live. Navigation geometry and preview state are synchronously discarded when the session identity changes, and an in-flight smooth scroll is cancelled before the shared viewport is reused.

## Regression fixture

`src/utils/__tests__/chatRenderItems.test.ts` contains the exact six-event fixture. It asserts globally unique Assistant ids and exactly one active Assistant after the canonical user boundary.
