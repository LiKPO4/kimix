# Chat viewport ownership event snapshot

Captured from `diag.log` on 2026-07-17 for runtime `session_8723c487-47bf-4bc6-95a6-8ca7d3063fa6`. Message bodies are intentionally omitted.

## Main/runtime sequence

| UTC time | Evidence |
| --- | --- |
| 07:07:19.640 | Live stream opens one Assistant. |
| 07:07:26.590 | `runningSessionId` becomes `null` before the prompt ends. |
| 07:07:27.972 | Later stream activity tracks the same runtime again. |
| 07:07:32.862 | Runtime becomes `null` a second time. |
| 07:07:33.448 | More Assistant deltas reopen output. |
| 07:07:36.084 | Authoritative final batch closes the Assistant. |

This was the Server `turn.ended` versus `prompt.completed` scope mismatch fixed by commit `780e6629`. It caused repeated process-detail collapse and expansion during one prompt.

## Renderer/viewport sequence

| UTC time | Evidence |
| --- | --- |
| 07:10:11.454 | Navigation moves the detached viewport near the top (`scrollTop=1`, `autoFollow=false`, `userScroll=true`). |
| 07:10:11.942 | The next Assistant batch changes `contentVersion`. |
| 07:10:11.984 | Manual restore uses the pre-navigation anchor and forces `scrollTop=1672 -> 2363`; the viewport is pulled back near the tail. |
| 07:10:16.849 | The same stale anchor forces `1960 -> 2362` again. |
| 07:10:23.702 | The same stale anchor forces `1960 -> 2262` again. |

The navigation path changed `autoFollowRef` / `userScrollRef` directly but did not call the shared explicit-user-intent transaction. Its old anchor generation therefore remained valid. Chromium native scroll anchoring and Kimix's manual anchor also remained enabled simultaneously, allowing two independent writers to react to the same streaming reflow.

## Reproduction fixture

1. Start from a completed Assistant response with a captured viewport anchor.
2. Mark the session running before the next optimistic user event is rendered.
3. Navigate to an older rail marker while output continues.
4. Apply a new `contentVersion`.

Expected invariants:

- A completed prior response never becomes incomplete solely because the session-level runtime is active.
- Rail/search navigation atomically enters detached mode and invalidates the previous anchor before moving.
- While detached, only Kimix's explicit anchor owns reflow compensation; Chromium implicit anchoring is disabled.
