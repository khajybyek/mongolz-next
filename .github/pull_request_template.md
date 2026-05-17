<!--
Conventional commit message — the PR title becomes the merge commit:

  type(scope)!: short imperative summary

  type   = feat | fix | docs | refactor | perf | test | build | ci | chore
  scope  = ml | auth | playback | live | alerts | infra | docs … (optional)
  !      = if this PR contains a BREAKING CHANGE

Examples:
  feat(alerts): per-suspect dedup window in alert_rules
  fix(auth): step-up TOTP cookie missing on /faces
  refactor(suspects)!: move CRUD behind SuspectRepository
-->

## Summary

<!-- 1-3 bullets — what changed and why. -->

-

## Linked

<!-- "Closes #123", "Refs ADR-0006", or "Defense panel feedback 2026-05-17". -->

-

## Type of change

- [ ] **feat** — user-visible new capability
- [ ] **fix** — bug fix (no behaviour additions)
- [ ] **refactor** — code restructure with no behaviour change
- [ ] **perf** — measurable performance improvement
- [ ] **docs** — README / ADR / inline comment
- [ ] **test** — added or fixed test coverage
- [ ] **build / ci** — pipeline, deps, scripts
- [ ] **chore** — anything else

## Risk

- [ ] **No-risk** — docs, comments, tests only
- [ ] **Low** — bounded code change, easy revert
- [ ] **Medium** — touches auth, encryption, or migrations
- [ ] **High** — breaking change, multi-table migration, or new external dependency

## Pre-merge checklist

- [ ] `npm run lint` clean
- [ ] `npm run typecheck` clean
- [ ] `npm test` and `cd ml-service && pytest` green
- [ ] Migrations are **forward-only** and tested on a staging dataset
- [ ] Updated relevant ADR if architecture changed (see `docs/adr/`)
- [ ] Updated `CLAUDE.md` if operational procedure changed
- [ ] Screenshot or short clip attached for UI changes
- [ ] Security advisor sweep clean (`mcp call get_advisors`)
- [ ] Tested as `viewer` AND `admin` role if route-related

## Rollback plan

<!-- One paragraph: how do we revert if this PR causes production
     pain? "git revert + redeploy" is fine for most code-only PRs.
     Migrations need a specific down-migration or feature-flag kill
     switch. -->


## Screenshots / clips

<!-- For UI-affecting PRs. Drag-drop here. -->
