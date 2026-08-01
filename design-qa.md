# Design QA — Empty-state semantic icons v2.20.101

final result: implementation verified; running-view confirmation pending

## Source visual truth

- Issue capture: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-f989b8a1-7263-48fc-af42-6659d3ac679f.png`
- State: Modern interface, project empty conversation, five project-aware suggestions restored from current and historical sessions.

## Root cause

Project suggestions persist across releases, but the icon resolver recognized only four exact current strings. Historical wording and truncated conversation prompts missed the map and all inherited the same Sparkles fallback.

## Design decision

Icons encode the action, not the row position. Continue-context prompts use RotateCcw, risk/review prompts use GitBranch, task-planning prompts use ListChecks, problem-analysis prompts use Bug, and general project discovery uses Sparkles. Repeated actions may intentionally share one icon; unrelated actions may not collapse to the fallback merely because their display copy changed.

## Regression gates

- [x] The exact legacy strings visible in the issue capture are covered by unit tests.
- [x] Current built-in suggestions retain their intended icon mapping.
- [x] Unknown suggestions retain one stable neutral fallback.
- [x] Persisted suggestions are not deleted or rewritten.
- [ ] User confirms icon rendering in the running v2.20.101 window.
