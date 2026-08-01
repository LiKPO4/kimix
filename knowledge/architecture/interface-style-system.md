---
type: Architecture
title: Interface Style System
description: Defines the boundary between color themes and interface styles and assigns visual treatment by component role.
resource: https://github.com/LiKPO4/kimix/tree/master/src
tags: [architecture, ui, theme, style, css]
timestamp: "2026-08-01T18:14:23+08:00"
---

# Interface Style System

Kimix treats color themes and interface styles as orthogonal systems. A color theme owns surface, text, accent, semantic, and border colors. An interface style owns shape and texture: radius, shadow, edge treatment, and role-specific control depth. Selecting an interface style must not replace or reinterpret the active color palette.

# Invariants

* Interface-style root blocks must not assign `--surface-*`, `--text-*`, `--accent-*`, or `--border-*` color tokens. Style rules consume those tokens and may use neutral transparent light/dark overlays only to express depth.
* Visual treatment is assigned by component role, not by global element selectors. Rules such as `[data-ui-style] button`, `[data-ui-style] textarea`, or a global `.kimix-icon-text-button` skin are prohibited because the same primitives serve unrelated roles across navigation, forms, dialogs, and primary actions.
* A nested control has one visible boundary owner. In the Composer, `.kimix-composer-card` owns border, focus, and elevation; `.kimix-composer-input` remains borderless and transparent. Settings inputs own their own inset boundary because they are standalone fields.
* Controls with the same role share one state language. `.kimix-control-button` represents a tool that opens more controls, while `.kimix-state-button` represents a binary mode and derives its selected appearance from `aria-pressed="true"`. Business components must not reconstruct selected borders, backgrounds, or shadows through inline styles.
* Floating surfaces share a semantic skeleton before any style preset is applied. Small menus use `.kimix-menu-panel` and `.kimix-menu-item`; popovers use `.kimix-floating-panel`; dialogs use `.kimix-modal-card`. The default Kimix style defines spacing, radius, elevation, and interaction states for these roles, and interface presets may change their material without changing their structure.
* Composer send, steer, and stop remain circular primary actions. ContextBar is one continuous control strip whose child actions become distinct only on hover or expanded state. ContextBar triggers expose `aria-expanded` so workspaces, usage, models, and later additions share the same open state treatment.
* Sidebar projects and sessions use one active-state grammar: a quiet selected surface plus one accent edge. Active navigation must not stack a full outline, inset frame, and focus ring to communicate the same state.
* Retro styling uses one signature device—the subtle Platinum title-bar stripe. Sidebars and content surfaces stay restrained so the signature does not compete with message content.
* Nested radii remain concentric where surfaces are visually adjacent. Interactive press feedback uses the existing `scale: 0.96` convention, and transitions name only the properties that change.

# Regression Gates

`src/utils/__tests__/uiStyles.test.ts` verifies that interface-style roots do not override color-theme tokens, that the retro style does not skin the global icon-text button primitive, that shared state/menu/popup roles remain present in the default layer, and that the Composer input remains borderless under its styled outer shell.

# Main Components

* `src/index.css` defines style tokens and component-role selectors.
* `src/utils/uiStyles.ts` defines the selectable presets and root attribute.
* `src/components/chat/Composer.tsx`, `ContextRing.tsx`, and `ContextBar.tsx` expose role-specific controls and expanded/pressed state hooks.
* `src/components/layout/Sidebar.tsx` exposes explicit active project/session states and the shared project menu skeleton.
* `src/components/layout/TopMenuBar.tsx`, context menus, file menus, and dialogs reuse the shared menu/popup skeleton.

# Related Knowledge

* [Kimix](/project/kimix.md)
* [Chat Viewport State](/architecture/chat-viewport-state.md)

# Sources

* [Mac OS 8 Human Interface Guidelines](https://interface.free.fr/Archives/Apple_HIGOS8_Guidelines.pdf)
