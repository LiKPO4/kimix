---
type: Architecture Decision
title: Adopt OKF v0.1
description: Kimix adopts a dedicated OKF v0.1 bundle for stable project knowledge while retaining existing task, documentation, and release-note systems.
resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d2b9e2e13ccb2528af555b207b3c73312757b7c5/okf/SPEC.md
tags: [decision, okf, documentation, interoperability]
timestamp: "2026-06-19T00:00:00+08:00"
---

# Adopt OKF v0.1

# Status

Accepted for project-local stable knowledge, with the upstream draft status explicitly recorded.

# Context

Kimix already has user documentation, release notes, a long-running task state, migration plans, and source comments. Converting those heterogeneous files in place would mix incompatible lifecycles and create large, low-value diffs. OKF defines a self-contained bundle as the distribution unit and permits that bundle to be a subdirectory of a larger repository.

# Decision

* Use `knowledge/` as the only OKF bundle root.
* Target upstream OKF version 0.1.
* Keep existing documents in their current roles and link to them as sources.
* Apply a Kimix producer profile that is stricter than normative conformance, while retaining a separate spec-only validator mode.
* Commit the bundle and validate it in CI so knowledge changes use the same review and history workflow as code.

# Consequences

* Humans and agents can inspect the same plain-text knowledge without a proprietary service.
* Stable concepts are progressively discoverable through directory indexes and cross-links.
* Maintainers must curate concepts rather than copy every transient update.
* Upstream OKF draft changes require explicit review and migration instead of silent schema drift.

# Related Knowledge

* [Knowledge Maintenance Policy](/maintenance/knowledge-maintenance.md)
* [Open Knowledge Format v0.1](/references/okf-v0.1.md)
