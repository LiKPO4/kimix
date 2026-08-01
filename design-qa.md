# Design QA — Divider ownership and empty-state slots v2.20.102

final result: implementation verified; running-view confirmation pending

## Source visual truth

- Issue capture: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-61e9cafa-7996-4fc5-9cad-b7142ed1f1d6.png`
- State: Modern interface, project empty conversation, historical suggestions present.

## Corrected interpretation

The toolbar-to-canvas horizontal rule is useful structure and must remain. The unwanted rules are the two vertical seams inside the launch/open split controls. They now have separate role ownership, so Modern can remove those seams without changing toolbar hierarchy or other presets.

## Empty-state composition

Suggestion rows now have content priority instead of insertion-order priority. Project overview has a permanent first slot. Continue context has at most one canonical `继续：…` row and prefers the latest project user message. Historical non-continue prompts fill the remaining personalized slots before unused defaults.

## Regression gates

- [x] Modern no longer suppresses the toolbar bottom border.
- [x] Split-control internal seams consume `--ui-compound-divider-shadow`.
- [x] Modern sets only the compound divider token to `none`; Default and Retro retain a divider.
- [x] Screenshot-equivalent data yields exactly one normalized continue row.
- [x] Project overview remains first even when five or more saved candidates exist.
- [x] Historical non-continue suggestions keep their semantic icons.
- [ ] User confirms the running v2.20.102 view.
