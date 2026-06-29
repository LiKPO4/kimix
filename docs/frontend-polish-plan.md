# Kimix Frontend Polish Plan

Date: 2026-06-26

Goal: improve alignment, spacing consistency, interaction feel, and visual polish without changing Kimix's current warm-paper editorial style.

## Style Boundaries

- Keep the existing warm paper palette, LXGW WenKai typography, restrained blue accent, rounded surfaces, and compact desktop-app density.
- Do not introduce a new theme, marketing-page composition, large decorative graphics, or dramatic animation.
- Follow `AGENTS.md` spacing rules first. Use explicit inline values or stable CSS tokens for high-risk spacing.
- Apply `make-interfaces-feel-better` principles only where they reinforce the existing Kimix style.

## Round 1: Global Polish Baseline

| Before | After |
| --- | --- |
| Button press feedback is uneven across shared action classes. | Shared action classes use a restrained `scale(0.96)` press state with explicit transform transitions. |
| Dynamic numbers, counters, durations, and progress values can shift width while changing. | Add a reusable tabular-number utility and apply it to common compact UI text through global helpers where safe. |
| Headings and short UI copy rely on browser default wrapping. | Headings use balanced wrapping; short UI text and Markdown paragraphs use prettier wrapping while long/preformatted content stays unchanged. |
| Images and media previews are sometimes separated only by background contrast. | Add neutral inset outlines to Markdown and media thumbnails for light/dark consistency without layout shift. |
| Some icon-only buttons have a smaller visual size and a smaller hit area. | Shared small action classes get at least a 40px interaction target, preserving their visible compact shape. |

Target files:

- `src/index.css`
- `package.json`
- `src/components/layout/Sidebar.tsx`
- `src/components/settings/SettingsPanel.tsx`
- `docs/release-notes/v2.11.58.md`
- `TASK_STATE.md`

## Round 2: Chat Surface Alignment

| Before | After |
| --- | --- |
| Assistant body, tool groups, Todo/Swarm panels, and status chips each have local spacing rhythm. | Normalize chat stream vertical rhythm into stable 8/12/16px layers. |
| Collapse rows sometimes use small ad hoc left padding. | Give collapse rows fixed icon/title/status columns so text starts align visually. |
| User, assistant, and metadata bubble offsets can drift by branch. | Define one message content column and one metadata column rule. |
| Markdown code, table, and formula surfaces have similar but not identical padding/radius. | Standardize block surfaces while preserving existing colors. |
| Floating scroll/status actions have local shadows and sizing. | Reuse a common floating action treatment. |

Likely files:

- `src/components/chat/ChatThread.tsx`
- `src/components/chat/MessageBubble.tsx`
- `src/components/chat/ToolCard.tsx`
- `src/components/chat/TodoPanel.tsx`
- `src/components/chat/SwarmPanel.tsx`
- `src/components/chat/MarkdownRenderer.tsx`
- `src/index.css`

## Round 3: Sidebar, Settings, Plugins, and Dialogs

| Before | After |
| --- | --- |
| Sidebar project rows, session rows, and bottom actions have small height/right-edge differences. | Normalize list rows with fixed action columns and consistent right padding. |
| Settings sections repeat local field/action spacing. | Introduce section card, field row, and action row rhythm without changing content. |
| Plugin page density is high and status/buttons can feel crowded. | Improve alignment and grouping first; defer larger official 0.20-style tab redesign. |
| Modal headers, close buttons, and footers vary slightly by dialog. | Normalize modal header/footer spacing and close-button hit area. |
| Some cards rely on hard borders for depth while others use shadows. | Keep separators as borders, but use subtle shadow/ring treatment for elevated cards and buttons. |

Likely files:

- `src/components/layout/Sidebar.tsx`
- `src/components/settings/SettingsPanel.tsx`
- `src/components/layout/SkillsPanel.tsx`
- `src/components/layout/DialogSystem.tsx`
- `src/components/layout/LongTasksPanel.tsx`
- `src/components/layout/SessionToolbar.tsx`
- `src/index.css`

## Verification

Each round should:

1. Bump Kimix version in `package.json`, `Sidebar.tsx`, and `SettingsPanel.tsx`.
2. Add a matching release note under `docs/release-notes/`.
3. Run targeted tests if component logic changes.
4. Run `pnpm test:run`, `pnpm knowledge:validate`, `pnpm build`, and `git diff --check`.
5. Commit only the round's relevant files.

## 2026-06-29 Follow-up Audit TodoList

The follow-up audit keeps the existing style and focuses on applying the established design system consistently.

### Round 1: Interaction Structure and Accessibility

- [x] Replace the nested attachment-card buttons with separate preview and remove controls.
- [x] Enlarge the sidebar session action controls and remove their remaining `transition-all` usage.
- [x] Keep hover-revealed sidebar and message actions visible during keyboard focus.
- [x] Restore visible focus treatment for interactive controls inside the Composer surface.

### Round 2: Shared Component Consistency

- [x] Apply tabular numerals to changing durations, token counts, percentages, progress, and diff totals.
- [x] Align toolbar and icon-action press feedback around the shared `scale(0.96)` behavior.
- [x] Replace high-frequency loading/success icon swaps with the shared CSS cross-fade pattern.
- [x] Consolidate remaining ad hoc icon actions onto shared compact/default action classes.

### Round 3: Motion and Surface Details

- [x] Add a project-wide `prefers-reduced-motion` fallback for non-essential movement.
- [x] Either wire the unused entrance animation helpers into appropriate overlays or remove them.
- [x] Add restrained enter/exit treatment to Toast and frequently used dialogs without animating page load.
- [x] Add the neutral light/dark inset outline to the large image preview.
- [x] Review elevated overlays for redundant hard-border plus heavy-shadow combinations while retaining input and divider borders.
