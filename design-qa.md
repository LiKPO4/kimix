# Design QA

- Source visual truth: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-f5d37fe1-a62e-430f-8ad1-3e9a234e32f1.png`, `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-5cb48ae1-8830-4ef9-9cc2-3fd9ad1eb16b.png`
- Implementation state: Kimix v2.12.26, light theme, idle session, model menu open at 1280 x 800.
- Full-view comparison: the popover is anchored above the existing footer model control and preserves the current compact status-bar layout.
- Focused-region comparison: provider grouping, current-model checkmark, 40px rows, explicit horizontal padding, search threshold, running-state lock, and the separated manage-model footer match the approved behavior.
- Patch after visual review: compacted provider-prefixed row labels and raised the list viewport to 340px so the common seven-model configuration does not become needlessly tall or repetitive.
- Remaining visual check: v2.12.25 was user-tested; the v2.12.26 event ownership and Provider compatibility corrections require another user-side functional pass.

final result: blocked
