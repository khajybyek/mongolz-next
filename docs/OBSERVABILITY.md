# Observability

How we know production is healthy, what to grab when it's not, and how
to navigate from a Sentry alert all the way down to the DB row that
caused it.

## Three pillars

| Pillar | Stack | What we see |
|---|---|---|
| **Logs** | Vercel log drain → `console.*` JSON (via `lib/log.ts`) | Per-request structured lines with `trace_id`, `user_id`, `request_id` |
| **Metrics** | Sentry transactions + Vercel Speed Insights + `public.web_vitals_p75` | Latency p75/p95, error rate, real-user CWV |
| **Traces** | OpenTelemetry → optional OTLP endpoint (Grafana Tempo / SigNoz) | End-to-end span tree across Vercel → Supabase → Railway |

## Trace propagation

`lib/trace.ts` exports `withSpan(name, fn)` and `tracedFetch(url)`.
`tracedFetch` injects the W3C `traceparent` header so the receiver can
extend the same trace.

Pattern for API routes that call the ML service:

```ts
import { tracedFetch } from "@/lib/trace";

const res = await tracedFetch(`${ML_URL}/embed`, {
  method: "POST",
  body: form,
  headers: { Authorization: `Bearer ${token}` },
});
```

Pattern for wrapping a unit of work:

```ts
import { withSpan } from "@/lib/trace";

await withSpan("alerts.dispatch", async (span) => {
  span.setAttribute("alert.id", id);
  await dispatchTelegram(id);
  await dispatchWebPush(id);
});
```

## Structured logging

`lib/log.ts` emits single-line JSON. Always pass IDs as structured
fields, not interpolated strings — that's what makes logs queryable.

```ts
import { log } from "@/lib/log";
import { activeTraceId } from "@/lib/trace";

log.info("reveal.approved", {
  trace_id: activeTraceId(),
  reveal_job_id: id,
  approver: profile.email,
});
```

Sensitive keys (`password`, `*_token`, `*_secret`, etc.) are redacted
automatically — see the `REDACT_KEYS` set in `lib/log.ts`.

## SLO status

`/api/slo-status` returns the live SLI vs SLO comparison documented in
[`SLO.md`](SLO.md). External uptime monitors poll it; a 503 means
*something* in the SLO table is red.

## Setup

| Var | Where | What |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel + ML Service | Browser + server Sentry destination |
| `SENTRY_AUTH_TOKEN` | Vercel build env | Source-map upload |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Vercel + ML Service | OTLP collector — when set, NodeSDK initialises |
| `OTEL_SERVICE_NAME` | Vercel + ML Service | Auto-set per service |

The OTLP endpoint is optional — without it, all `withSpan` /
`tracedFetch` calls are zero-cost no-ops. Sentry transactions still
work via the Sentry SDK.

## On-call runbook (abbreviated)

1. Open the on-call Sentry alert.
2. Grab the `trace_id` from the event tags.
3. Pull the matching trace in Tempo (`{trace_id}`) — the spans show
   you which downstream call failed.
4. If the failure is DB-side, jump to Supabase logs filtered by
   `trace_id`.
5. If the failure is ML-side, the Railway log for that
   `mongolz-ml-production` instance is filtered the same way.
6. Patch + roll-forward via PR (or feature-flag kill via `lib/flags.ts`
   if the bug is in a flagged path).
7. Post-mortem within 48h — template in `docs/POSTMORTEM_TEMPLATE.md`.

## Roadmap

* Add `lib/trace.ts.activeTraceId()` to every `log.info` call as a
  bound `child` field at the API boundary (currently called manually).
* Wire OTLP endpoint to a self-hosted SigNoz instance.
* Move from `SimpleSpanProcessor` to a batched exporter once volume
  justifies it.
* Add a daily Vercel Cron that calls `verify_audit_chain()` and posts
  to Slack on any break — closes the audit SLO #7 manual-only gap.
