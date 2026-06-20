---
type: Policy
title: Knowledge Maintenance Policy
description: Defines what belongs in the Kimix OKF bundle, when it must change, and how every update is validated and reviewed.
resource: https://github.com/LiKPO4/kimix/tree/master/knowledge
tags: [okf, knowledge, maintenance, governance]
timestamp: "2026-06-20T00:00:00+08:00"
---

# Knowledge Maintenance Policy

The `knowledge/` directory is the portable OKF bundle. It stores stable project knowledge that should remain useful across sessions and tools. It does not replace high-frequency task tracking in `TASK_STATE.md`, historical release notes, source-code comments, or user documentation.

# Add or Update a Concept When

* A durable architecture boundary or runtime invariant changes.
* A supported integration gains a new lifecycle, configuration, recovery, or security rule.
* A release or operational procedure changes.
* A repeated incident yields a stable root cause and runbook.
* The OKF specification version or Kimix strict profile changes.

# Authoring Rules

1. Every concept is one UTF-8 Markdown file with YAML frontmatter.
2. OKF v0.1 requires `type`; the Kimix profile additionally requires `title`, one-line `description`, non-empty `tags`, and an ISO 8601 `timestamp` with timezone.
3. Use bundle-absolute links such as `/architecture/runtime-routing.md` for concept relationships.
4. Put source-backed claims under `# Sources` or `# Citations` and prefer primary sources.
5. Preserve unknown frontmatter fields and tolerate unknown concept types when consuming bundles.
6. Update the nearest `index.md`, root `index.md` when needed, and root `log.md` with the newest date first.
7. Change `timestamp` only for a meaningful content change, not formatting-only edits.
8. Keep volatile status, screenshots, generated output, secrets, caches, and binaries out of the bundle.

# Validation

* `pnpm knowledge:validate` applies OKF v0.1 plus the Kimix strict profile.
* `pnpm knowledge:validate:spec` checks only normative OKF v0.1 requirements and reports soft guidance separately.
* CI validates knowledge changes and the release workflow revalidates the bundle before packaging.
* Broken links are warnings under spec-only consumption but errors for Kimix producers.
* `pnpm knowledge:audit` additionally rejects concepts older than 180 days, duplicate titles, future-dated entries, and concepts not linked from an index.
* GitHub Actions runs the maintenance audit every Monday and supports manual dispatch; ordinary pull requests keep the faster strict validation gate.

# End-of-Task Closure

Every implementation task must classify its durable knowledge impact before handoff. Agents update the bundle without prompting when architecture, lifecycle, operational, incident, or governance facts changed. If nothing durable changed, the handoff states `Knowledge: no update required` instead of creating filler content. Conflicting or unverifiable facts are escalated for a project-owner decision.

# Upstream Changes

OKF v0.1 is a draft. Before adopting a newer version, compare its normative rules with the pinned [Open Knowledge Format v0.1](/references/okf-v0.1.md), record an architecture decision, update the validator, migrate the bundle, and retain a clear rollback commit.

# Related Knowledge

* [Adopt OKF v0.1](/decisions/adopt-okf-v0.1.md)
* [Release Process](/operations/release-process.md)
