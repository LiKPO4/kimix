---
type: Runbook
title: Diagnostics Log Recording
description: How the settings diagnostics section records a bounded, shareable runtime log - what it captures, where files land, and the invariants that keep recording cheap and reliable.
resource: https://github.com/LiKPO4/kimix/blob/master/electron/diagRecording.ts
tags: [diagnostics, logging, operations, troubleshooting, performance]
timestamp: "2026-09-14T11:00:00+08:00"
---

# Diagnostics Log Recording

设置 → 诊断 → 日志录制 records a bounded (default five minutes) runtime log, so a janky or misbehaving session can be captured and shared without launch-time environment flags.

# Behavior

* The main-process controller (`electron/diagRecording.ts`) owns the file: it creates `userData/diagnostics/kimix-record-<local timestamp>.log`, writes a version/platform/redaction header, and appends a `# stopped=... reason=...` footer. Stop reasons are `manual`, `timeout` (auto-stop at the deadline) and `size-cap` (16 MB ceiling).
* Writes are serialized through one promise queue and stay fully async; the footer task is enqueued after all pending content writes, so a recording never ends with out-of-order lines. Repeated stop is idempotent and returns the last result.
* The renderer controller (`src/utils/diagRecorder.ts`) owns collection: rAF frame gaps over 100 ms, a 10-second frames/max-gap/JS-heap sample, console lines and longtasks forwarded from the renderer lag detector, and 1 s / 40-line batching over IPC (`app:appendDiagRecording`). It auto-stops at the deadline and reconciles with `app:getDiagRecordingStatus` on startup and settings mount, so a renderer reload continues an active recording.
* While a recording is active, every `diag.log` line (live state-machine transitions, stream keyframes, error reports) is duplicated into the recording file by the main process; renderer heartbeats add one redacted summary line per 2 s (visibility, heap, event count, engine, running state).
* Recordings inherit the diagnostic redaction default; unrestricted payloads still require the `KIMIX_DETAILED_DIAGNOSTICS=1` launch environment.

# Boundaries

* Only one recording runs at a time; a second start request returns the active session instead of creating another file.
* The recording file is never trimmed the way `diag.log` is; the 16 MB cap stops the recording instead.
* Recording captures structural and timing data, not message bodies or tool payloads - it is a diagnostics log, not a transcript.
