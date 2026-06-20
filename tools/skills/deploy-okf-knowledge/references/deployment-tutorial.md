# Tutorial: Deploy an OKF Knowledge Bundle

## Contents

1. Outcome and boundaries
2. Repository audit
3. Knowledge model
4. Bundle construction
5. Validation installation
6. CI and release integration
7. Maintenance workflow
8. Autonomous operation and distribution
9. Migration and rollback
10. Acceptance checklist

## 1. Outcome and boundaries

Create a dedicated bundle, normally `knowledge/`, that is:

- human-readable and agent-readable;
- reviewable through Git;
- conformant with OKF v0.1;
- stricter when the project chooses a documented producer profile;
- independent of a proprietary server, MCP implementation, or hosted index.

Do not start by converting every Markdown file. Existing README files, release notes, generated reports, incident logs, and task trackers usually have different lifecycles. Curate stable facts into concepts and cite the existing artifacts.

## 2. Repository audit

Read, in this order:

1. Agent/contributor rules (`AGENTS.md`, `CONTRIBUTING.md`).
2. README and package/build manifests.
3. Current task state and Git status.
4. Architecture decisions and migration plans.
5. Operational runbooks and release workflow.
6. Primary implementation files for any claimed architecture.

Write down candidate knowledge and classify it:

| Class | Put in OKF? | Example |
|---|---:|---|
| Stable architecture invariant | Yes | Server-first routing with SDK fallback |
| Integration lifecycle/runbook | Yes | Plugin update and reload sequence |
| Governance decision | Yes | Why the bundle is separate from docs |
| Release process | Yes | Tag-driven CI publish steps |
| Current ticket progress | No | “Button still needs visual QA” |
| Generated build output | No | Bundle hashes and temporary paths |
| Secret/personal data | Never | Tokens, credentials, private paths |

## 3. Knowledge model

Prefer a small hierarchy based on how readers retrieve information:

```text
knowledge/
├── index.md
├── log.md
├── project/
├── architecture/
├── operations/
├── maintenance/
├── decisions/
└── references/
```

Start with 5–10 verified concepts. One concept should answer one durable question. Use descriptive, open types such as `Product`, `Architecture`, `Runbook`, `Policy`, `Architecture Decision`, and `Standard`; OKF does not register types centrally.

Define the project profile before authoring. A practical strict profile requires:

- `type`, `title`, `description`, `tags`, `timestamp`;
- timezone-aware timestamps;
- H1 equal to `title`;
- an `index.md` in every directory;
- a root `log.md`;
- no broken internal links;
- primary-source citations for external claims.

State clearly that only `type` is normative in upstream v0.1.

## 4. Bundle construction

Copy and adapt the files under `assets/templates/`.

Root index:

```yaml
---
okf_version: "0.1"
---
```

Use sections and bullet links only. Subdirectory indexes contain no frontmatter. Use links to concrete `index.md` or concept files.

Concept frontmatter:

```yaml
---
type: Architecture
title: Runtime Routing
description: Explains the project's supported runtime routes and fallback boundary.
resource: https://github.com/example/project/tree/main/src/runtime
tags: [architecture, runtime, fallback]
timestamp: "2026-06-19T00:00:00Z"
---
```

Use bundle-root links for durable relationships:

```markdown
See [Runtime Routing](/architecture/runtime-routing.md).
```

Use `# Sources` or `# Citations` for external claims. Pin draft standards and volatile upstream source references to a commit.

## 5. Validation installation

### Node/pnpm project

1. Copy `scripts/validate-okf.mjs` from this Skill to the repository's `scripts/` directory.
2. Install the direct parser dependency:

```bash
pnpm add -D js-yaml@^4.1.1
```

3. Add scripts:

```json
{
  "scripts": {
    "knowledge:validate": "node scripts/validate-okf.mjs",
    "knowledge:validate:spec": "node scripts/validate-okf.mjs --spec-only",
    "knowledge:audit": "node scripts/validate-okf.mjs --audit --max-age-days 180"
  }
}
```

4. Add tests that execute the CLI against temporary bundles:
   - full strict-profile success;
   - missing `type` failure in spec-only mode;
   - type-only concept passes spec-only but fails strict mode;
   - broken link and missing index behavior if customized.
   - stale, future-dated, duplicate-title, and orphan concept failures in audit mode.

### Non-Node project

Port the validator into the repository's native language. Preserve these two modes:

- `spec-only`: normative errors; broken links and missing indexes remain warnings.
- strict/default: project profile elevates quality failures to errors.

Use a real YAML parser. Do not validate frontmatter with regular expressions alone.

## 6. CI and release integration

For GitHub Actions, copy `assets/templates/knowledge-workflow.yml` and adapt the package manager commands. Use path filters for change validation, plus a weekly schedule and manual dispatch for maintenance debt that appears without a code change.

If releases package or distribute the bundle, make release builds depend on a knowledge-validation job. Keep this job read-only and run with a frozen lockfile.

Validate the workflow YAML locally with the repository's YAML parser or `actionlint` when available.

## 7. Maintenance workflow

Add a short policy block to project rules. Use `assets/templates/maintenance-rules.md` as a starting point.

Update the bundle when:

- an architecture boundary changes;
- an integration lifecycle or recovery sequence changes;
- a release/operations procedure changes;
- a repeated incident yields a stable root cause;
- the OKF version or project profile changes.

For every meaningful concept change:

1. Update the concept body and `timestamp`.
2. Update the nearest directory index if title/description/path changed.
3. Update the root index if top-level discovery changed.
4. Add a newest-first entry to root `log.md`.
5. Run both validators and relevant project tests.
6. Review the diff for secrets, transient data, stale citations, and accidental mass conversion.

At the end of every implementation task, classify whether durable knowledge changed. Update the bundle automatically for verified architecture, lifecycle, operations, recurring-incident, or governance changes. If nothing durable changed, record that outcome in the handoff rather than creating filler. Escalate only conflicting, unverifiable, security-sensitive, or product-owner decisions.

Do not change timestamps for formatting-only edits.

## 8. Autonomous operation and distribution

Use [autonomous-maintenance.md](autonomous-maintenance.md) to define the automation boundary. Keep the canonical Skill directory in a versioned internal tools repository when a team needs it. Install it by copying the complete `deploy-okf-knowledge/` directory into each user's `$CODEX_HOME/skills/` directory, then run the official Skill validator and start a fresh session.

Do not treat the installed user copy as the canonical source. Update the versioned source, validate it, then roll it out. Record the source commit so teams can compare and roll back installations.

Forward-test the Skill on a second real repository before claiming cross-project portability. The acceptance evidence should include the generated bundle, validator output, CI parse, project tests/build, and a list of project-specific adaptations.

## 9. Migration and rollback

For an existing docs corpus:

1. Inventory files and owners.
2. Select stable concepts rather than copying everything.
3. Preserve canonical docs and cite them.
4. Introduce indexes and cross-links incrementally.
5. Run the strict validator after each category.

For an OKF version upgrade:

1. Pin and diff upstream specs.
2. Record an architecture decision.
3. Update templates and validator tests first.
4. Migrate concepts in a single reviewable series.
5. Keep the previous commit as the rollback point.

Rollback the deployment by reverting the narrow commit that introduced the bundle, validator, CI, dependency, and maintenance rules. Do not delete unrelated documentation.

## 10. Acceptance checklist

- Source status and commit are documented accurately.
- Bundle root declares the intended OKF version.
- Every concept passes a real YAML parser and has `type`.
- Strict profile is documented as project policy.
- Every directory is progressively discoverable.
- Internal links resolve under strict mode.
- External claims use primary citations.
- Negative validator tests prove the gate can fail.
- CI validates changes and release packaging when applicable.
- Weekly/manual audit rejects stale, orphaned, duplicate-title, and future-dated concepts.
- Every task handoff records whether durable knowledge changed.
- Shared installations trace back to a versioned Skill source and commit.
- A second real repository has passed a forward test before portability is declared complete.
- Full project tests/build still pass.
- Commit contains no caches, generated viewers, secrets, or unrelated files.
