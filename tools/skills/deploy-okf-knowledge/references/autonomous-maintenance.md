# Autonomous Maintenance Boundary

## Goal

Remove routine knowledge housekeeping from the project owner while preserving human authority over ambiguous facts and product decisions.

## Automatic actions

At the end of every implementation task, inspect the diff and evidence. Update concepts, indexes, timestamps, and the root log without asking when a verified change affects:

- architecture boundaries or invariants;
- integration lifecycle, configuration, recovery, or security;
- release and operational procedures;
- a repeated incident with a stable root cause;
- governance or knowledge-profile rules.

If no durable fact changed, state `Knowledge: no update required` in the handoff. Never create filler concepts merely to satisfy the closure rule.

Run strict validation on every relevant change. Run `--audit --max-age-days 180` weekly and by manual dispatch. Treat these as blocking audit findings:

- a meaningful concept has not been reviewed within the configured age;
- a concept is not linked from any `index.md`;
- normalized concept titles collide;
- a timestamp is materially in the future.

## Escalate to the owner

Ask for a decision only when sources conflict, a fact cannot be verified, ownership or product intent changes, or the action affects secrets, security posture, irreversible release behavior, or external commitments. Report the conflicting evidence and the smallest decision needed.

## Team distribution

Keep one canonical Skill directory in a versioned tools repository. Roll it out as a complete directory to `$CODEX_HOME/skills/deploy-okf-knowledge`; do not copy individual files. Validate the source and installed copy with `quick_validate.py`, compare file hashes, and start a fresh Codex session so discovery refreshes.

Use source commits as versions. Roll back by reinstalling the previous commit. Avoid embedding credentials, private machine paths, generated caches, or project-only facts in the reusable Skill.

## Honest autonomy claim

Automation can prove structure, age, discoverability, and internal consistency. It cannot prove that a business or architecture statement remains true. Claim low-touch maintenance only after a second real-project forward test; never claim fully ownerless semantic governance.
