# Kimix Knowledge Update Log

## 2026-06-20
* **Runtime routing**: Consolidated renderer event delivery onto `kimi-code:event` and `kimi-code:status`; handoff, long-task, and legacy local-session handling now consume the same canonical Host event stream instead of duplicated legacy IPC broadcasts.
* **Startup**: Split daily launch, hot-reload development, and cold-cache verification. `start-kimix.bat` now defaults to the already-built Electron app to avoid Vite dev renderer compile white screens; `--dev` keeps hot reload and `--clean` keeps the full cache-clean rebuild path. Startup logs now separate main-window, renderer, and Kimi Server timings.
* **Runtime routing**: Clarified that startup must defer official history restore and stale runtime recovery until after renderer first paint; Server `yolo` approvals are auto-resolved via the official approval API.
* **Runtime routing**: Added the slash command rule that official Kimi Code commands, including `/skill:...`, route through Server/SDK prompt dispatch first, while Kimix-only commands stay local and SDK-era handlers act as fallback.
* **Runtime routing**: Documented that app startup must show the renderer before Kimi Server startup or runtime prewarm.
* **Runtime routing**: Added bounded Server recovery and safe promotion of idle SDK sessions when the same official session ID is available.
* **Automation**: Added end-of-task knowledge classification and a weekly maintenance audit for stale, orphaned, duplicated, or future-dated concepts.

## 2026-06-19
* **Initialization**: Established the Kimix OKF v0.1 knowledge bundle.
* **Creation**: Added project, runtime routing, MCP lifecycle, release, maintenance, adoption decision, and upstream specification concepts.
* **Validation**: Added spec-only and Kimix strict-profile validation commands plus CI enforcement.
