---
name: workflow-preferences
description: Development workflow habits for Kimix project
metadata:
  type: feedback
---

After every code fix, restart Kimix dev server so the user can verify visually.
**Why:** The user explicitly asked for this — "每次完成后就重启一下kimix让我看".
**How to apply:** After any fix that affects UI behavior, kill existing electron.exe processes and run `pnpm dev` in background, then confirm the window is running.
