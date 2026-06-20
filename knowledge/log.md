# Kimix Knowledge Update Log

## 2026-06-20
* **Runtime routing**: Added the slash command rule that official Kimi Code commands, including `/skill:...`, route through Server/SDK prompt dispatch first, while Kimix-only commands stay local and SDK-era handlers act as fallback.
* **Runtime routing**: Documented that app startup must show the renderer before Kimi Server startup or runtime prewarm.
* **Runtime routing**: Added bounded Server recovery and safe promotion of idle SDK sessions when the same official session ID is available.
* **Automation**: Added end-of-task knowledge classification and a weekly maintenance audit for stale, orphaned, duplicated, or future-dated concepts.

## 2026-06-19
* **Initialization**: Established the Kimix OKF v0.1 knowledge bundle.
* **Creation**: Added project, runtime routing, MCP lifecycle, release, maintenance, adoption decision, and upstream specification concepts.
* **Validation**: Added spec-only and Kimix strict-profile validation commands plus CI enforcement.
