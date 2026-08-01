---
type: Architecture
title: Interface Style System
description: Defines the boundary between color themes and interface styles and assigns visual treatment by component role.
resource: https://github.com/LiKPO4/kimix/tree/master/src
tags: [architecture, ui, theme, style, css]
timestamp: "2026-08-01T21:30:00+08:00"
---

# Interface Style System

Kimix treats color themes and interface styles as orthogonal systems. A color theme owns surface, text, accent, semantic, and border colors. An interface style owns shape and texture: radius, shadow, edge treatment, and role-specific control depth. Selecting an interface style must not replace or reinterpret the active color palette.

# Style Contract

The contract has three layers. Theme tokens (`--surface-*`, `--text-*`, `--accent-*`, and `--border-*`) remain the only color authority. Semantic interface tokens (`--ui-control-*`, `--ui-compound-*`, `--ui-nav-action-*`, `--ui-nav-list-*`, `--ui-selection-*`, `--ui-toggle-*`, `--ui-popup-*`, `--ui-field-*`, `--ui-menu-trigger-*`, and `--ui-shell-*`) describe how a role should feel. Components enroll through role classes such as `.kimix-window-control`, `.kimix-split-control`, `.kimix-sidebar-nav-item`, `.kimix-sidebar-project-row`, `.kimix-menu-panel`, and `.kimix-modal-card`.

Adding a style preset therefore starts by overriding the semantic interface tokens at its root attribute. Component-specific preset selectors are reserved for a genuine signature device or a structural exception that cannot be expressed by the contract; they are not the default integration mechanism.

# Invariants

* Interface-style root blocks must not assign `--surface-*`, `--text-*`, `--accent-*`, or `--border-*` color tokens. Style rules consume those tokens and may use neutral transparent light/dark overlays only to express depth.
* Visual treatment is assigned by component role, not by global element selectors. Rules such as `[data-ui-style] button`, `[data-ui-style] textarea`, or a global `.kimix-icon-text-button` skin are prohibited because the same primitives serve unrelated roles across navigation, forms, dialogs, and primary actions.
* A nested control has one visible boundary owner. In the Composer, `.kimix-composer-card` owns border, focus, and elevation; `.kimix-composer-input` remains borderless and transparent. Settings inputs own their own inset boundary because they are standalone fields.
* Controls with the same role share one state language. `.kimix-control-button` represents a tool that opens more controls, while `.kimix-state-button` represents a binary mode and derives its selected appearance from `aria-pressed="true"`. Business components must not reconstruct selected borders, backgrounds, or shadows through inline styles.
* Selection direction is semantic, not global. `--ui-selection-*` is reserved for vertical navigation; a preset may use a leading accent edge or a complete quiet pill, but it must never leak either treatment into button-like modes. `--ui-toggle-*` is reserved for Swarm, Plan, expanded controls, and other button-like modes; it uses a complete surface and must never inherit a leading edge. `--ui-compound-*` gives launch/open split controls a persistent shared boundary without forcing every ordinary control to stay boxed.
* Every interactive shell touchpoint enrolls in a semantic role. Window controls and ordinary toolbar controls share the control contract; launch/open compound buttons use `.kimix-split-control`; primary sidebar actions use `.kimix-sidebar-nav-item`; project/session rows use their list roles; menu titles use `.kimix-top-menu-trigger`. A preset must not require business-component selectors to discover these surfaces.
* Floating surfaces share a semantic skeleton before any style preset is applied. Small menus use `.kimix-menu-panel` and `.kimix-menu-item`; popovers use `.kimix-floating-panel`; dialogs use `.kimix-modal-card`. The default Kimix style defines spacing, radius, elevation, and interaction states for these roles, and interface presets may change their material without changing their structure.
* Composer send, steer, and stop remain circular primary actions. ContextBar is one continuous control strip whose child actions become distinct only on hover or expanded state. ContextBar triggers expose `aria-expanded` so workspaces, usage, models, and later additions share the same open state treatment.
* Sidebar projects and sessions use one active-state grammar per preset. Default and Retro use a quiet selected surface plus one accent edge; Modern uses the Codex-style complete quiet pill with no directional marker. Active navigation must not stack a full outline, inset frame, and focus ring to communicate the same state.
* Compound states have explicit precedence. For project and session rows, `.is-active:hover` consumes the same `--ui-selection-*` tokens as `.is-active`; hover must never replace the complete `box-shadow` and erase the active accent edge. Expanded and pressed toolbar controls keep their own `--ui-toggle-*` state when hovered.
* Shell separation must communicate real structure. The sidebar does not draw a decorative full-height rule; `--ui-shell-divider` remains `none` unless a preset can justify the divider semantically. Separators inside split controls and menus use their dedicated role tokens and remain local to the grouped content.
* The chat toolbar bottom rule is a structural boundary between navigation/actions and conversation content, so every preset keeps it. Split-control dividers are a separate role owned by `--ui-compound-divider-shadow`: Modern may set that local divider to `none` for a seamless Codex-style compound control, while Default and Retro may retain it. A request about one divider must not be implemented by removing another boundary at a different hierarchy.
* A structural shell border is indivisible. Removing an ornamental sidebar divider must never be implemented by clearing one edge of `.kimix-app-shell-main`; every preset keeps the shell's four structural edges intact and controls ornamental separation through `--ui-shell-divider` or a dedicated spacer.
* Retro styling uses one signature device—the subtle Platinum title-bar stripe. Sidebars, window controls, ordinary toolbar actions, and content surfaces stay flat at rest; hover, active state, compound launch/open controls, and floating surfaces carry the tactile treatment. Enrolling a role must not make its boundary permanently visible.
* Modern styling uses a Codex-inspired shell language: a complete navigation pill, 18–20px content/composer shells, quiet flat controls, and softly elevated floating surfaces. It may add neutral translucent depth overlays, but it must not redefine theme color tokens or restructure business layouts such as Skills cards and settings sections.
* A preset may redistribute existing theme surfaces without becoming a color theme. Modern derives `--kimix-modern-workspace-background` only from `--surface-elevated` and `--surface-base`, then uses that brighter presentation surface for chat, settings, Plugins, and Hooks while leaving the sidebar on `--surface-ground`. It must never assign a new value to any `--surface-*`, `--text-*`, `--accent-*`, or `--border-*` source token.
* Modern user input uses a distinct but deliberately low-contrast reading surface without becoming a new color theme. `--kimix-modern-user-bubble-background` derives only from the active palette's `--surface-active` and `--surface-elevated`, with elevated remaining the majority surface in light mode; the bubble stays borderless and shadowless so contrast communicates authorship without turning short prompts into button-like chips.
* Modern radii are role-scoped instead of globally inflated: controls use 10px, cards 14px, panels 18px, and the main shell 20px. Generic `rounded-*` utilities keep a monotonic small-to-large scale and must not be used as a substitute for shell-role tokens.
* Nested radii remain concentric where two adjacent surfaces are simultaneously visible. The invariant is `outer radius = inner radius + visible inset`; the settings theme segment is the canonical example at 16px outer, 10px inner, and 6px inset. A full-bleed child clipped by its parent is not a second nested surface. Interactive press feedback uses the existing `scale: 0.96` convention, and transitions name only the properties that change.
* Modern content surfaces must enroll by semantic depth: grouped settings selectors use the 16px segment role, standalone content cards use 14px, and complete sub-region containers use 18px. New bordered or filled surfaces must not silently fall back to a generic small radius.
* Markdown tables expose frame, table, header, and cell roles before presets style them. Modern tables are page-aligned reading structures rather than cards: no outer frame, vertical grid, header fill, or zebra striping; a theme-derived subtle horizontal rule carries row separation. Default and Retro may retain their own grid treatment.

# Regression Gates

`src/utils/__tests__/uiStyles.test.ts` verifies that interface-style roots do not assign color-theme tokens, that Modern derives and applies its brighter workspace presentation surface without mutating source colors, that Modern establishes its Codex-style shell without a navigation leading edge, that the toolbar structural bottom rule is not suppressed, that split-control dividers consume the role token and Modern disables only that local divider, that its nested theme segment derives the outer radius from inner control radius plus inset, that grouped/card/panel content surfaces enroll in the correct radius role, that Modern Markdown tables remove outer/vertical/zebra layers while retaining a theme-derived horizontal rule, that Retro consumes the semantic contract rather than skinning the global icon-text primitive, that Retro keeps all four structural shell borders, that active-plus-hover keeps each preset's navigation selection treatment, that button modes use `--ui-toggle-*` instead of `--ui-selection-*`, that the removed sidebar rule cannot return, that shell controls and navigation are enrolled, and that the Composer input remains borderless under its styled outer shell.

# Main Components

* `src/index.css` defines style tokens and component-role selectors.
* `src/utils/uiStyles.ts` defines the selectable presets and root attribute.
* `src/components/chat/Composer.tsx`, `ContextRing.tsx`, and `ContextBar.tsx` expose role-specific controls and expanded/pressed state hooks.
* `src/components/layout/Sidebar.tsx` enrolls primary actions, projects, sessions, settings, and the project menu in navigation and popup roles.
* `src/components/layout/TopMenuBar.tsx` enrolls window controls, menu triggers, menu items, and local separators.
* `src/components/layout/SessionToolbar.tsx` enrolls launch/open split controls, utility buttons, expanded states, and dropdown menus.
* Context menus, file menus, popovers, and dialogs reuse the shared menu/popup skeleton.

# Related Knowledge

* [Kimix](/project/kimix.md)
* [Chat Viewport State](/architecture/chat-viewport-state.md)

# Sources

* [Mac OS 8 Human Interface Guidelines](https://interface.free.fr/Archives/Apple_HIGOS8_Guidelines.pdf)
