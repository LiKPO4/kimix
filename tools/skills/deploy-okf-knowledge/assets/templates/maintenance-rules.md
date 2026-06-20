## Project Knowledge (OKF)

- Treat `knowledge/` as the repository's only OKF bundle.
- Keep volatile task progress in the existing task system; store only durable architecture, integration, runbook, policy, decision, and reference knowledge in OKF.
- Require valid YAML frontmatter and non-empty `type` for every concept. Label any stronger metadata requirements as the project producer profile.
- Reserve `index.md` and `log.md`; maintain an index in every directory and a newest-first root log under the strict profile.
- Prefer bundle-root concept links and primary-source citations.
- Update concepts, indexes, log entries, and meaningful timestamps together.
- At the end of every implementation task, classify whether verified durable knowledge changed; update it without prompting, or state `Knowledge: no update required` in the handoff.
- Escalate only conflicting, unverifiable, security-sensitive, irreversible, or product-owner facts.
- Run strict and spec-only validation before committing; run the 180-day maintenance audit weekly and by manual dispatch.
- Treat stale, orphaned, duplicate-title, and future-dated concepts as blocking maintenance debt.
- Pin and review upstream draft changes before migrating OKF versions.
