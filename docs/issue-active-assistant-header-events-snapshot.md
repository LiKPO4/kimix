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
