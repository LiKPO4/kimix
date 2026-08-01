# Design QA — Modern radius coverage and quiet tables v2.20.104

final result: implementation verified in the running app

## Source visual truth

- Kimix issue capture: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-92ab32d6-672d-4585-8eab-a91a4a59922a.png`
- Codex table reference: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-5962b891-3c42-4b12-a0ea-877ee591946d.png`
- Settings radius captures: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-5e49c40a-6469-4fe4-8a3d-43e4d25ab7de.png` and `codex-clipboard-05309e84-7254-43cc-84cd-02523addc6f7.png`

## Accepted implementation evidence

1. Models and providers — healthy. The 18px provider panel contains 14px model rows without clipping or reverse radius nesting. Evidence: `C:/Users/Administrator/AppData/Local/Temp/kimix-style-audit-22104/01-models.png`.
2. Appearance — healthy. Theme segments use 16px outer / 10px inner concentric radii; interface and palette cards consistently use 14px. Evidence: `C:/Users/Administrator/AppData/Local/Temp/kimix-style-audit-22104/02-appearance.png`.
3. Conversation and permissions — healthy. Full-bleed selected rows are clipped by a 16px group owner, preserving one continuous container boundary. Evidence: `C:/Users/Administrator/AppData/Local/Temp/kimix-style-audit-22104/03-permissions.png`.
4. Markdown table — healthy. Modern removes the outer card, vertical grid, header fill, and zebra striping; theme-derived horizontal rules retain row scanning and the first/last columns align with surrounding prose. Evidence: `C:/Users/Administrator/AppData/Local/Temp/kimix-style-audit-22104/04-modern-table.png`.

## Evidence limits

- Screenshots verify light-theme geometry, hierarchy, clipping, and visible contrast only. Dark-theme token ownership is covered by source/test gates, but keyboard traversal, screen-reader table semantics, and high-contrast OS modes were not re-audited in this visual pass.

---

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
