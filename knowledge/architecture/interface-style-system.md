---
type: Architecture
title: Interface Style System
description: Defines the boundary between color themes and interface styles and assigns visual treatment by component role.
resource: https://github.com/LiKPO4/kimix/tree/master/src
tags: [architecture, ui, theme, style, css]
timestamp: "2026-08-01T18:00:00+08:00"
---

# Interface Style System

Kimix treats color themes and interface styles as orthogonal systems. A color theme owns surface, text, accent, semantic, and border colors. An interface style owns shape and texture: radius, shadow, edge treatment, and role-specific control depth. Selecting an interface style must not replace or reinterpret the active color palette.

# Invariants

* Interface-style root blocks must not assign `--surface-*`, `--text-*`, `--accent-*`, or `--border-*` color tokens. Style rules consume those tokens and may use neutral transparent light/dark overlays only to express depth.
* Visual treatment is assigned by component role, not by global element selectors. Rules such as `[data-ui-style] button`, `[data-ui-style] textarea`, or a global `.kimix-icon-text-button` skin are prohibited because the same primitives serve unrelated roles across navigation, forms, dialogs, and primary actions.
* A nested control has one visible boundary owner. In the Composer, `.kimix-composer-card` owns border, focus, and elevation; `.kimix-composer-input` remains borderless and transparent. Settings inputs own their own inset boundary because they are standalone fields.
* Controls with the same role share one state language. Window toolbar buttons and Composer secondary tool/mode buttons use the same idle, hover, and pressed depth. Composer send, steer, and stop remain circular primary actions. ContextBar is one continuous control strip whose child actions become distinct only on hover or expanded state.
* Retro styling uses one signature device—the subtle Platinum title-bar stripe. Sidebars and content surfaces stay restrained so the signature does not compete with message content.
* Nested radii remain concentric where surfaces are visually adjacent. Interactive press feedback uses the existing `scale: 0.96` convention, and transitions name only the properties that change.

# Regression Gates

`src/utils/__tests__/uiStyles.test.ts` verifies that interface-style roots do not override color-theme tokens, that the retro style does not skin the global icon-text button primitive, and that the Composer input remains borderless under its styled outer shell.

# Main Components

* `src/index.css` defines style tokens and component-role selectors.
* `src/utils/uiStyles.ts` defines the selectable presets and root attribute.
* `src/components/chat/Composer.tsx`, `ContextRing.tsx`, and `ContextBar.tsx` expose role-specific style hooks.
* `src/components/layout/Sidebar.tsx` exposes explicit active project and session states.

# Related Knowledge

* [Kimix](/project/kimix.md)
* [Chat Viewport State](/architecture/chat-viewport-state.md)

# Sources

* [Mac OS 8 Human Interface Guidelines](https://interface.free.fr/Archives/Apple_HIGOS8_Guidelines.pdf)
