---
type: Standard
title: Open Knowledge Format v0.1
description: Draft vendor-neutral format for self-contained knowledge bundles made from linked Markdown concepts with YAML frontmatter.
resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d2b9e2e13ccb2528af555b207b3c73312757b7c5/okf/SPEC.md
tags: [okf, standard, markdown, yaml]
timestamp: "2026-06-19T00:00:00+08:00"
upstream_commit: d2b9e2e13ccb2528af555b207b3c73312757b7c5
upstream_status: draft
---

# Open Knowledge Format v0.1

OKF v0.1 is marked **Draft**. A bundle is a directory tree of UTF-8 Markdown files. Every non-reserved concept document has YAML frontmatter and a Markdown body. The only normative required concept field is a non-empty `type` string.

The enclosing repository is owned by the `GoogleCloudPlatform` GitHub organization, but its root README says the repository and its contents are not an official Google product. Kimix therefore treats OKF v0.1 as an upstream draft specification proposal, not a finalized Google standard.

# Reserved Files

* `index.md` is an optional progressive-disclosure directory listing. Only the bundle-root index may contain frontmatter to declare `okf_version`.
* `log.md` is an optional date-grouped update history ordered newest first.

# Consumption Rules

Consumers must tolerate unknown types, unknown additional frontmatter keys, missing optional fields, broken cross-links, and missing indexes. Standard Markdown links form graph edges; links beginning with `/` are relative to the bundle root and are recommended for stable concept relationships.

# Upstream Caveat

The proof-of-concept Python implementation currently validates `title`, `description`, and `timestamp` in addition to `type`, while `SPEC.md` makes those fields recommended rather than required. Kimix treats `SPEC.md` as the normative source and labels its extra checks as a project-specific strict profile.

# Citations

[1] [Pinned OKF v0.1 specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d2b9e2e13ccb2528af555b207b3c73312757b7c5/okf/SPEC.md)
[2] [Pinned OKF proof-of-concept README](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d2b9e2e13ccb2528af555b207b3c73312757b7c5/okf/README.md)
[3] [Pinned proof-of-concept document validator](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d2b9e2e13ccb2528af555b207b3c73312757b7c5/okf/src/enrichment_agent/bundle/document.py)
[4] [Repository root disclaimer](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d2b9e2e13ccb2528af555b207b3c73312757b7c5/README.md)
