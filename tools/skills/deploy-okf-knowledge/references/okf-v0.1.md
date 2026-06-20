# OKF v0.1 Source and Conformance Reference

## Pinned research baseline

- Repository: `GoogleCloudPlatform/knowledge-catalog`
- Commit: `d2b9e2e13ccb2528af555b207b3c73312757b7c5`
- Inspected date: 2026-06-19
- Specification: `okf/SPEC.md`
- Declared version/status: `0.1 — Draft`

Pinned sources:

- [SPEC.md](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d2b9e2e13ccb2528af555b207b3c73312757b7c5/okf/SPEC.md)
- [OKF proof-of-concept README](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d2b9e2e13ccb2528af555b207b3c73312757b7c5/okf/README.md)
- [PoC document validator](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d2b9e2e13ccb2528af555b207b3c73312757b7c5/okf/src/enrichment_agent/bundle/document.py)
- [Repository disclaimer](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d2b9e2e13ccb2528af555b207b3c73312757b7c5/README.md)

The repository is under the GoogleCloudPlatform organization, but its root README says its contents are not an official Google product. Describe v0.1 as an upstream draft specification proposal unless newer primary evidence changes that status.

## Normative v0.1 requirements

A conformant bundle:

1. Is a directory tree of Markdown files.
2. Gives every non-reserved `.md` concept parseable YAML frontmatter.
3. Gives every concept a non-empty `type` field.
4. Uses `index.md` and `log.md` only with their reserved meanings when present.

Consumers must not reject a bundle because of missing optional fields, unknown types, unknown extra keys, broken links, or missing indexes.

## Recommended, not normative

- `title`
- one-line `description`
- `resource`
- `tags`
- ISO 8601 `timestamp`
- conventional `# Schema`, `# Examples`, `# Citations` sections
- bundle-absolute cross-links beginning with `/`
- Git distribution

## Upstream inconsistency

The PoC `document.py` requires `type`, `title`, `description`, and `timestamp`, while `SPEC.md` requires only `type`. Treat `SPEC.md` as normative. A project may intentionally adopt the stronger PoC-like requirements, but must label them as a producer profile.

## Version upgrade rule

When researching a later version:

1. Fetch the upstream default branch and record the commit.
2. Compare the new `SPEC.md` against this baseline.
3. Separate backward-compatible additions from breaking changes.
4. Record a project decision before migrating.
5. Update validator behavior, templates, bundle declaration, tests, and maintenance rules together.
6. Keep best-effort consumption for unknown versions unless the project has a documented security reason to reject them.
