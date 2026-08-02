---
type: Architecture
title: Composer Draft Lifecycle
description: Defines ownership, persistence, isolation, and clearing rules for unsent Composer text and attachments.
resource: https://github.com/LiKPO4/kimix/tree/master/src/components/chat/Composer.tsx
tags: [architecture, composer, draft, persistence, reliability]
timestamp: "2026-08-02T12:40:45+08:00"
---

# Composer Draft Lifecycle

Kimix treats unsent Composer content as user data rather than transient component state. Workspace navigation conditionally unmounts the chat tree, so `Composer` local React state cannot be the sole owner of a draft.

# Ownership

Each existing conversation owns one draft under `session:<sessionId>`. A project that has not created its next conversation yet owns a separate draft under `project:<projectId>:new`. The session identity always wins when both a session and project are available. Changing conversations remounts `Composer` by this identity, preventing one conversation's text or attachments from leaking into another while restoring the target conversation's own draft.

# Persistence Boundary

`src/utils/composerDraft.ts` is the persistence boundary. Every Composer text mutation synchronously updates an in-memory copy and `localStorage`; exact whitespace and line breaks are preserved. This makes text survive settings, Plugins, Hooks, and other workspace unmounts as well as a renderer or application restart.

Each renderer window writes its own persistent slot beneath the logical session/project draft key. The window identity is retained in `sessionStorage`, so a reload keeps writing the same slot while a second Electron window cannot overwrite it. Restoration prefers the current window's slot; a newly opened window without a slot scans the legacy record and other window slots, choosing the most recently updated valid text. Explicit clear/send writes an empty tombstone only for the current window, so its Composer stays blank while another open window's unsent text remains preserved. At most twelve writer slots are retained per logical draft to bound stale-window accumulation.

Attachments remain in the in-memory draft so ordinary workspace and conversation round trips preserve them without duplicating large data URLs into synchronous browser storage. They are not promised across a full process restart; adding that guarantee requires a bounded IndexedDB attachment store rather than expanding the text storage record.

# Invariants

* Unsent text must never be owned only by a mounted textarea or React component.
* Draft identity must be resolved before restoration; project-new and session drafts never share a key.
* Renderer windows never share a writable persistent record. Logical identity selects the draft family, while writer identity selects the slot within that family.
* A text change writes the draft synchronously in the same update path. Debounce may be added only as a secondary optimization, never as the sole durable copy.
* Workspace navigation and component unmount flush current text and attachments but never clear them.
* Only a deliberate Composer replacement or clear operation, including explicit submission after the content enters the send lifecycle, may remove the stored draft.
* Storage corruption, quota, or permission errors must not break input. The in-memory copy remains authoritative for the current application run.

# Regression Gates

`src/utils/__tests__/composerDraft.test.ts` verifies exact-text restoration, per-session isolation, parallel-window slot preservation, explicit clearing, attachment retention during unmounts, corrupt-storage tolerance, and the integration wiring in `Composer` and `AppShell`.

# Sources

* [/architecture/runtime-routing.md](/architecture/runtime-routing.md)
* [/project/kimix.md](/project/kimix.md)
