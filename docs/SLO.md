# Service-Level Objectives

This document defines what "production-healthy" means for MONGOLZ
Security. Each SLO has an explicit target, the SLI used to measure it,
and the error budget consumed when it's missed.

Status is computed by `/api/slo-status` — a public read endpoint that
external monitors can poll. Read "Status semantics" below before trusting
a green answer: an SLO with no samples reports `no_data`, never `met`.

## SLO table

| # | Service / journey | SLO (28-day window) | SLI | Error budget |
|---|---|---|---|---|
| 1 | **App availability** | 99.5 % of requests return < 5xx | Sentry transaction success rate | 3h 36m / 28d |
| 2 | **Login latency** | 95 % of `POST /login` complete in < 1500 ms | Web Vitals `INP` on `/login` + Sentry transaction p95 | n/a — latency SLO |
| 3 | **Playback latency** | 95 % of `/playback/[id]` LCP < 4 000 ms | Web Vitals `LCP` from `VitalsReporter` p75 | n/a — latency SLO |
| 4 | **ML detect latency** | 95 % of `/detect` calls complete in < 800 ms | `mongolz-ml` Railway HTTP histogram | n/a — latency SLO |
| 5 | **Reveal turnaround** | 90 % of approved reveals produce a video in < 5 min | `reveal_jobs.completed_at - approved_at` | 73 hours / 28d |
| 6 | **Alert pipeline freshness** | 95 % of face detections produce a row in `alerts` (when a suspect match exists) within 60 s | gap between `faces.detected_at` and `alerts.created_at` | n/a — freshness SLO |
| 7 | **Audit chain integrity** | 100 % | `verify_audit_chain()` returns zero rows | **zero tolerance** — chain break is a P0 |
| 8 | **Encryption integrity** | 100 % of `recordings` decryptable end-to-end | `npm run backup:verify` random-sample success rate | **zero tolerance** — P0 |

## Status semantics

`/api/slo-status` answers with one state per SLO (`app/api/slo-status/slo.ts`):

| `state` | Meaning | `ok` |
|---|---|---|
| `met` | Measured, and the measurement clears the target | `true` |
| `breached` | Measured, and it does not | `false` |
| `no_data` | Nothing to measure, or fewer than 5 samples in the window | `false` |
| `error` | The measurement itself failed — not knowing is a signal | `false` |

Each entry also carries `evidence` (`sufficient` / `insufficient` / `none`)
so a consumer can tell "we are green" from "we have not seen enough to
say". The 5-sample floor exists because a ratio over one or two samples is
noise: one slow reveal out of two would read as a 50 % breach.

Top-level `status` and the HTTP code:

| `status` | When | HTTP |
|---|---|---|
| `ok` | Every SLO measured and met | 200 |
| `partial` | Nothing breached, but at least one SLO has no usable evidence | 200 |
| `degraded` | At least one SLO breached, or unmeasurable | 503 |

"Not enough data yet" is honest, but it is not an outage — it must not page
an on-call, hence 200. Only `degraded` returns 503.

**What the endpoint publishes.** It is unauthenticated, so it emits SLO
state and nothing else: a ratio (`"96.4%"`) or a latency (`"1800 ms"`),
never the sample counts behind them. How many reveals ran in 28 days or how
many alerts fired in a week is operational volume, not SLO state; the audit
chain likewise answers `0` / `≥1`, not a break count. Exact numbers live
behind auth on `/health` and `/audit`.

Before 2026-09-09 the probe computed `ratio = samples === 0 ? 1 : …` and
published `"100.0% (0 samples)" · ok: true` — four green SLOs on a system
that had done nothing at all. Regression tests: `__tests__/slo-status.test.ts`.

## Error budget policy

When an SLO with a budget runs out:

1. **Freeze non-critical merges** to `main` until the next 28-day
   window starts or the budget recovers.
2. Spend the remaining sprint on reliability work — backlog item from
   the corresponding post-incident report.
3. Communicate the freeze in a release note + the staging banner.

## SLO computation cadence

| Signal | Source | Refresh |
|---|---|---|
| App availability | Sentry transactions API + `audit_log` failure counts | hourly on the hour (vercel.json cron) via `/api/monitoring/error-rate` |
| Web Vitals p75 | `public.web_vitals_p75` view | real-time on `/perf-budget` page |
| ML latency | Railway logs → manual benchmark page | hourly via `/api/ml/bench` |
| Reveal turnaround | DB query against `reveal_jobs` | on read at `/api/slo-status` |
| Alert freshness | DB query joining `faces` + `alerts` | on read |
| Audit chain | `verify_audit_chain()` RPC | on read (also CI-daily) |
| Decrypt-success | `npm run backup:verify` cron | daily |

## Why these numbers

* **99.5 %** (not 99.9 %) is the realistic target for a Vercel Hobby
  + Supabase Free + Railway Hobby stack with zero redundancy. Adding a
  9 each requires a roughly 10× cost increase.
* **5 min reveal** is the operational p90 we observed during the
  capstone polish phase — fast enough to be useful for live ops, slow
  enough to allow human + 4-eyes review.
* **60 s alert freshness** is the dedup window we already enforce on
  the ML side; setting the SLO equal to the dedup avoids a spurious
  SLO breach when consecutive frames of the same person get coalesced.

## Roadmap

* Move audit-chain check from "on read" to a daily Vercel Cron job that
  posts a Slack alert on any break.
* Wire OpenTelemetry into `/api/slo-status` so each SLO has trace-ID
  context the on-call admin can pull up directly.
* Publish a public-facing status page that mirrors the SLO table.
