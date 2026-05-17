# Service-Level Objectives

This document defines what "production-healthy" means for MONGOLZ
Security. Each SLO has an explicit target, the SLI used to measure it,
and the error budget consumed when it's missed.

Status is computed by `/api/slo-status` — a public read endpoint that
external monitors can poll.

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
| App availability | Sentry transactions API | every 10 min via `/api/monitoring/error-rate` cron |
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
