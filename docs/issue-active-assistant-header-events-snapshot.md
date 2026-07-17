# Active Assistant header event snapshot

Captured on 2026-07-17 from the reported Project06 turn and the corresponding
renderer fixture. Message bodies are omitted except for their lengths.

## Runtime and timeline evidence

| Scope | Time / order | Evidence |
| --- | --- | --- |
| Previous turn | `t=1..4` | `user_message:user`, completed `assistant_message:assistant` (`contentLength=4`), then two terminal metric statuses. |
| Latest turn | `t=5` | `user_message:user-next` is visible and the session runtime is active. |
| Latest turn | before first delta | No incomplete `assistant_message` remains after the user event. This can occur during reload/snapshot reconciliation or before the first authoritative model event. |
| Render projection | same commit | `buildRenderItems` marks the latest turn as awaiting output but emits no render item because `mergedAssistantEvent` is absent. The UI therefore shows `运行中` without the Assistant process header. |

The screenshot is consistent with this state: the new user bubble and runtime
indicator are present, while the Assistant header between them is absent. This
is a renderer projection defect; it is not evidence that the Server or model
failed to start the turn.

## Minimal reproduction

1. Render a completed user/Assistant turn.
2. Append `user_message:user-next`.
3. Set the session runtime to active without appending an incomplete Assistant
   event (equivalent to a lost optimistic placeholder).
4. Build render items.

Before the fix, no Assistant item follows `user-next`. The invariant is now:

- A completed prior response never reopens solely because the runtime is busy.
- An active latest user turn always has exactly one process header, even before
  or without a persisted optimistic Assistant placeholder.
- The derived placeholder is render-only and has the stable identity
  `assistant-pending-<userEventId>`; the first real Assistant event replaces it.

## v2.16.41 follow-up: previous footer reactivation

The v2.16.41 acceptance screenshot confirmed that the derived current-turn
header was present, but also exposed a separate ownership violation. The
previous response's final model/Tokens/Context footer changed to
“消息处理中” while the new turn ran, then recovered after completion.

The reproducing event sequence is:

| Order | Event | State |
| --- | --- | --- |
| 1 | `user_message:user-previous` | Previous prompt. |
| 2 | `assistant_message:assistant-stale-open` | Durable body exists, but a reconciled segment leaves `isComplete=false`. |
| 3 | `status_update:usage-previous` | Final input/output/context metrics exist. |
| 4 | `user_message:user-current` | Hard single-Agent turn boundary. |
| 5 | `assistant_message:assistant-current` | New active placeholder; session runtime is running. |

Two independent computations caused the regression. `buildRenderItems` did not
treat the next user message as a hard settlement boundary when an old Assistant
or tool flag remained open. `AssistantMessageBubble` then read the global
`runningSessionId` and reactivated that historical row.

Activity is now resolved once by the turn projection and passed explicitly to
the bubble. In a single-Agent session, a later user message settles the previous
turn for display, preserves its final usage, and normalizes stale Assistant
completion state. Historical bubbles no longer subscribe to session-global
runtime activity.

## v2.16.42 follow-up: synthetic-primary ownership was still missing

The v2.16.42 screenshots and the matching official Server journal disproved the
remaining assumption in the earlier fixtures. The affected session has no
`collaboration` state, but all live Server events are still scoped by Kimix to a
synthetic primary identity (`room-agent:<ui-session-id>`). The ordinary Composer
set only `runningSessionId`; it did not create a `RoomAgentActivity` or bind the
optimistic user/Assistant events to a stable `roomMessageId + agentTurnId`.

The captured prompt had this lifecycle (identifiers and bodies omitted):

| Official order | Time | Meaning |
| --- | --- | --- |
| `turn.started`, `turn.step.started(step=1)` | 16:41:13 | Prompt and first model step started. |
| `turn.step.completed(step=1, finishReason=tool_use)` | 16:41:44 | Only the first tool-use step ended. The runtime remained busy. |
| `turn.step.started/completed(step=2..11, tool_use)` | 16:41:44–16:45:52 | More model/tool steps continued. |
| `turn.step.started(step=12)` | 16:45:52 | Final model step started. |
| `turn.step.completed(step=12, end_turn)`, `turn.ended`, `prompt.completed` | 16:46:32 | The prompt became terminal for the first time. |

At every intermediate step boundary, the renderer store briefly contained no
open Assistant (`openBefore=0`) and the next model segment opened another one.
That is valid step-level streaming, not prompt completion. The UI projection
failed in two ways:

1. A scoped synthetic-primary event disabled the old `!roomAgentId` latest-turn
   fallback, so the header could disappear between sending and the first delta.
2. Agent-level activity had no concrete message/turn identity. When no matching
   activity existed at a `tool_use` boundary, a complete step fragment was
   presented as `输出完成` even though the prompt and footer were still running.

The required invariant is stronger than a session or Agent busy flag:

- An ordinary primary prompt establishes its stable `roomMessageId` and
  `agentTurnId` before dispatch and keeps them through sending, accepted,
  running, approval/question waits, and terminal status.
- Render activity matches those identities. It may keep the current step
  visually open, but it may not reopen another turn owned by the same Agent.
- `tool_use` is only a step boundary. The Assistant becomes complete only after
  the prompt activity becomes terminal (`prompt.completed` on Server routing).
