# Contributing to MONGOLZ Security

This is a capstone project, but the engineering process mirrors what a
small production team would use. Read this once before your first PR.

## TL;DR

```bash
# 1. Branch
git switch -c feat/your-thing

# 2. Code + test
npm run dev                 # Next.js
cd ml-service && python -m uvicorn main:app --reload   # ML service

# 3. Verify
npm run lint
npm run typecheck
npm test
cd ml-service && pytest

# 4. Commit (Conventional Commits)
git commit -m "feat(alerts): per-suspect dedup window"

# 5. PR
gh pr create --fill
```

## Branching

- `main` is **always deployable**. Vercel auto-deploys it to
  `mongolz.vercel.app` + `live.mongolz.dev` on every push.
- Work happens on short-lived branches off `main`. Naming:
  `feat/…`, `fix/…`, `refactor/…`, `docs/…`, `chore/…`.
- Squash-merge — no fast-forward, no merge commits. The PR title
  becomes the squash-commit subject.

## Commit messages — Conventional Commits

```
<type>(<scope>)!: <imperative subject>

<body — wrap at 72 chars, explain *why*>

<footer — "Refs #123" / "BREAKING CHANGE: …" / "Co-Authored-By: …">
```

`type` must be one of: `feat | fix | docs | refactor | perf | test | build | ci | chore`.

The `release-please` action reads commits on `main` to:

- Auto-bump `package.json` version (feat = minor, fix = patch, ! = major).
- Auto-generate `CHANGELOG.md`.
- Open a release PR; merging it tags the release.

## Pull requests

Use the PR template — it has the risk classification, rollback plan,
and security-advisor checklist that we expect on every change.

A PR needs:

1. CI green (lint + typecheck + jest + pytest).
2. Security workflow green (Semgrep SAST).
3. Code-owner approval (see `CODEOWNERS`).
4. Either no schema changes, or a corresponding migration in
   `supabase/migrations/` with a smoke-test query in the file.

## Database changes

Forward-only migrations. Every migration must be:

- **Idempotent on re-run** — use `CREATE TABLE IF NOT EXISTS`,
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, etc.
- **Backwards-compatible** with the previous app version — code
  shipping with the migration must run against *both* the pre- and
  post-migration schema. (Three-phase deploys: add column → ship
  code that double-writes → ship code that reads new column.)
- Recorded in a single `.sql` file under `supabase/migrations/` with a
  timestamp prefix `YYYYMMDDHHMMSS_short_name.sql`.

Run `mcp call get_advisors security` and `mcp call get_advisors
performance` after applying — any new WARN-level finding must either
be resolved or documented as intentional with an inline ADR reference.

## Architectural decisions

If your PR makes a non-obvious design choice (a new dependency, a new
encryption scheme, a new auth flow), write an ADR in `docs/adr/`. Use
the existing 0001-0008 as templates. ADRs are immutable once merged.

## Code style

- TypeScript: `eslint .` + `tsc --noEmit` clean.
- Python: `ruff` (config in `ml-service/pyproject.toml`) + `pytest`.
- SQL: lower-case keywords in migrations, indented by 2 spaces.
- No `// TODO` without a linked issue number.
- No `console.log` — use `lib/log.ts` so logs end up structured.
- No `any` without a `// eslint-disable-next-line` and a justification.

## Secrets

Never commit a `.env` file. Never `console.log` a token, password,
session cookie, or recording key. Use `lib/log.ts` redaction.

`vercel env add` is the canonical way to set production secrets.
Local dev uses `.env.local` (git-ignored).

## On-call / incident

If production is degraded:

1. Check `https://mongolz.vercel.app/api/uptime` (public probe).
2. Sentry — current open issues.
3. Vercel + Supabase + Railway status pages.
4. Trigger `/api/cron/anomaly-sweep` manually if needed.

Open a P0 issue from the bug template. Postmortem within 48 h.

## macOS + iCloud Drive

If your checkout lives under `~/Desktop` or `~/Documents` (both
default-synced to iCloud) you'll periodically see weird breakage:

* `node_modules/.bin/next` missing.
* TypeScript complaining about `* 2.ts` files.
* `python` venv shows duplicate `.pyc 2` files.

The cause is iCloud Drive creating "Filename 2.ext" copies of files
it thinks conflict. The fix is to route the offending directories
through a `*.nosync` suffix — macOS's file provider skips that suffix
by convention. The repo already wires this up; if `npm install` ever
clobbers the symlink, just run:

```bash
npm run heal:icloud
```

The script moves `node_modules`, `.next`, and `ml-service/venv` under
their respective `*.nosync` siblings and re-creates the symlinks.

## Reaching us

- Defense panel feedback / capstone questions: open an issue.
- Security issue: **do not** open a public issue. Email
  `admin@mongolz.local` (see `app/.well-known/security.txt`).
