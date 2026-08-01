# Design QA — Shell borders and nested radii v2.20.98

final result: passed

## Source visual truth

- Retro clipped shell edge: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-555f9d8b-d1d2-4379-9014-e4dedb934fbe.png`
- Modern reversed nested radii: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-3f74816f-b2d6-4a6f-8f09-c7127c5c0863.png`

## Implementation evidence

- Modern settings: `C:/Users/Administrator/AppData/Local/Temp/kimix-ui-audit-22098/01-modern-settings.png`
- Retro settings: `C:/Users/Administrator/AppData/Local/Temp/kimix-ui-audit-22098/02-retro-settings.png`
- Retro conversation: `C:/Users/Administrator/AppData/Local/Temp/kimix-ui-audit-22098/03-retro-main.png`
- All implementation captures use the running v2.20.98 Electron window at 1280 × 800 and 1× capture density.
- State: light theme, warm-paper color scheme; Settings on Appearance for both styles, then the existing conversation workspace in Retro.

## Audit scope

- Main shell: outer corners, all four structural edges, overflow clipping, title toolbar junction, settings and conversation variants.
- Nested surfaces: theme segmented control, interface-style cards, palette cards with action columns, Composer, floating panels, menu items, navigation pills, split controls, and ContextBar.
- Radius ownership: global utility scale versus role tokens for controls, cards, panels, and the main shell.
- Color ownership: no interface-style rule takes control of theme surface, text, accent, semantic, or border colors.

## Full-view comparison evidence

- Retro settings and conversation now show the main shell's left edge continuously from the upper-left corner to the lower-left corner. The sidebar still has no independent decorative full-height divider, so the restored edge communicates the content shell rather than splitting the sidebar.
- Modern's theme selector now has a 16px outer radius and a 10px option radius separated by 6px on every side. The active option no longer bulges beyond the outer contour.
- Modern cards, panels, Composer, menus, and the main shell now use explicit 14px, 18px, and 20px role radii. Small generic controls use 10px or less, preventing a utility class from accidentally acquiring shell-scale curvature.
- Full-bleed toolbar children clipped by the 20px main shell were treated as part of the shell, not as separate inset surfaces; no artificial inner corner was added where there is no visible inset.

## Findings

- No actionable P0/P1/P2 findings remain in the audited shell/radius scope.
- [P3] Retro and Modern intentionally keep different curvature density: Retro uses small Platinum corners, while Modern uses a large Codex-inspired shell. Their shared invariant is complete structural edges and role-correct nesting, not identical numeric radii.
- [P3] Palette rows with dedicated action columns are one clipped card surface; transparent action cells therefore do not need their own inner radii.

## Regression gates

- [x] Retro main shell declares a complete 1px border and cannot reintroduce `border-left-width: 0`.
- [x] Modern nested segment derives its outer radius from control radius plus inset.
- [x] Modern utility radii remain monotonic and separate from role-specific shell radii.
- [x] Interface styles remain color-theme-neutral.
- [x] Running Electron verification covers Modern settings, Retro settings, and Retro conversation shell.

## Comparison history

- v2.20.97 exposed the defect: removing the retro divider was implemented by deleting a structural shell edge, while Modern enlarged global utility radii and produced a 10px outer / 14px inner segment.
- v2.20.98 fixes both causes at the contract level. No screenshot-only compensating overlay, negative offset, or one-page exception was introduced.
