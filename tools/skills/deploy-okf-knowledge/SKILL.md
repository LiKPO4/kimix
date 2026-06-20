---
name: deploy-okf-knowledge
description: Deploy, migrate, audit, validate, distribute, and autonomously maintain an Open Knowledge Format (OKF) project knowledge bundle. Use when Codex needs to add a Git-versioned Markdown plus YAML knowledge base to a repository, distinguish upstream OKF v0.1 rules from stricter project policy, create concept/index/log structure, add deterministic validation and scheduled health gates, require end-of-task knowledge closure, share the workflow across projects or teams, convert durable project knowledge without dumping transient docs, or upgrade an existing OKF bundle safely.
---

# Deploy OKF Project Knowledge

Build a portable, reviewable knowledge bundle without misrepresenting a draft proposal as a finalized standard.

## Start With Source Integrity

Read [references/okf-v0.1.md](references/okf-v0.1.md) before making conformance claims. Treat the pinned upstream `SPEC.md` as normative for v0.1. Keep project-specific quality rules explicitly separate.

When the user requests the latest OKF version, browse or fetch the upstream repository and pin the inspected commit. Do not rely on social-media summaries or third-party tools as the specification source.

## Follow This Workflow

1. **Audit the repository.** Read project rules, README, package/build files, CI, current status, architecture notes, operational runbooks, and Git state. Preserve unrelated changes.
2. **Define the boundary.** Prefer a dedicated `knowledge/` bundle inside a larger repository. Do not mechanically convert all docs, release notes, generated reports, or task logs.
3. **Classify durable knowledge.** Capture stable product boundaries, architecture invariants, integration lifecycles, runbooks, policies, decisions, and primary-source references. Keep volatile progress in the project's existing task system.
4. **Choose a producer profile.** Enforce normative OKF separately from optional project quality rules. Recommended strict rules: title, one-line description, tags, timezone-aware timestamp, matching H1, directory indexes, root log, and no broken links.
5. **Create the bundle.** Use the templates in `assets/templates/`; replace every placeholder with verified project facts. Prefer bundle-root links such as `/architecture/runtime-routing.md`.
6. **Install validation.** Copy `scripts/validate-okf.mjs` into the target repository. For Node projects, add `js-yaml@^4.1.1` as a direct dev dependency and expose strict plus spec-only commands. For non-Node projects, port the same checks to the native toolchain instead of forcing Node.
7. **Connect maintenance.** Add concise authoring rules to the repository's agent/contributor instructions. Require an end-of-task durable-knowledge decision. Add path-filtered CI plus a weekly/manual maintenance audit, and make release pipelines depend on knowledge validation when releases ship the bundle.
8. **Verify proportionally.** Run spec-only validation, strict validation, maintenance audit, validator regression tests, workflow YAML parsing, the repository's full tests/build, and `git diff --check`. Test stale and orphan invalid fixtures.
9. **Commit narrowly.** Stage only the bundle, validator, tests, dependency lock, CI, and maintenance documentation. Follow the repository's commit rules.

Read [references/deployment-tutorial.md](references/deployment-tutorial.md) for the complete tutorial, decision points, command examples, CI variants, maintenance cadence, and rollback procedure.
Read [references/autonomous-maintenance.md](references/autonomous-maintenance.md) when the user wants low-touch operation, scheduled audits, escalation boundaries, or team-wide Skill distribution.

## Preserve These Semantics

- A concept ID is its bundle-relative path without `.md`.
- Every non-reserved concept is UTF-8 Markdown with parseable YAML frontmatter and a non-empty string `type`.
- `index.md` and `log.md` are reserved and are not concepts.
- Only the root `index.md` may use frontmatter to declare `okf_version: "0.1"`.
- Unknown types and unknown frontmatter fields remain consumable.
- Broken links and missing indexes are soft under v0.1 consumption; a project producer profile may elevate them to errors.
- External claims cite primary sources. Pin draft-spec references to a commit when reproducibility matters.

## Avoid These Failure Modes

- Do not call OKF v0.1 a finalized Google standard. The inspected upstream marks it Draft, and the enclosing repository disclaims official-product status.
- Do not claim `title`, `description`, `tags`, or `timestamp` are normative v0.1 requirements.
- Do not replace user docs, ADRs, release notes, or task state with OKF; link and curate instead.
- Do not add an MCP server merely because the bundle exists. Plain files are sufficient; serving/search is an optional consumer layer.
- Do not generate placeholder concepts and declare the deployment complete.
- Do not make CI depend on unpinned third-party OKF tools when a local deterministic validator is available.

## Deliverable Checklist

- Dedicated, conformant bundle with root index and maintainable hierarchy
- Initial concepts grounded in repository facts and primary sources
- Explicit strict-profile policy distinct from upstream conformance
- Deterministic validator and negative regression tests
- CI, scheduled maintenance, and release gates appropriate to the repository
- Contributor/agent maintenance rules
- End-of-task knowledge classification and explicit escalation boundaries
- Versioned team source plus a tested installation/copy procedure when sharing is requested
- Validation evidence, risk statement, rollback point, and narrow commit
