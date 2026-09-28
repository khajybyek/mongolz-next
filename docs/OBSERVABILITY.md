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

## Where Sentry is initialised

| Runtime | File | Loaded by |
|---|---|---|
| Browser | `instrumentation-client.ts` | Next file convention — the client bootstrap requires it before `hydrate()` |
| Node | `sentry.server.config.ts` | `instrumentation.ts#register()` |
| Edge | `sentry.edge.config.ts` | `instrumentation.ts#register()` |

**Do not reintroduce `sentry.client.config.ts`.** That file is injected by
the Sentry *webpack* plugin only. Next 16 builds with Turbopack, so from the
day this project moved to Next 16 until 2026-09-09 the browser SDK was
configured but never loaded: not a single browser event reached Sentry,
while the crash screens told users the error "has been reported
automatically". `@sentry/nextjs` now prints a deprecation warning saying
exactly this.

All three runtimes share `lib/error-reporting.ts`:

* `beforeSend` drops cookies, `Authorization`/`Cookie`/`X-ML-Token` headers
  and query strings (HLS stream tickets ride in those) from **every** event,
  not just `/api/auth` as the old browser config did.
* `beforeBreadcrumb` strips query strings from fetch/xhr breadcrumbs.
* `dataCollection: SENTRY_DATA_COLLECTION` everywhere. SDK v11 removed
  `sendDefaultPii`; left unset, `dataCollection` collects client IPs,
  cookies, every header, request bodies and query strings, and only masks
  names that look like "token"/"secret". The shared constant turns off user
  info, cookies, bodies, query strings and payload capture, and denies the
  IP / geo headers (`x-forwarded-for`, `x-real-ip`, `x-vercel-ip-*`).
  `beforeSend` never runs on **sampled spans**, so this is what keeps
  those clean — but `urlQueryParams: false` filters only the attributes
  the SDK builds (`url.full`, `url.query`). Next sets `http.target` to the
  raw `req.url` on every root span, so on the server and edge
  `beforeSendSpan: scrubSentrySpan` strips the query from `http.target`
  and from the `referer` / `location` header attributes (stream
  `?ticket=`, `/audit?q=…`). `beforeSend` also drops request bodies,
  `user.ip_address` and the same headers, as a second line.
* `attachStacktrace: false` on the server, so `captureMessage` (CSP
  beacons, the boot-time config check) stays a message instead of a
  synthetic exception. CSP issues are fingerprinted per directive.
* Production events are tagged `environment: production` (SDK v11 uses
  `VERCEL_TARGET_ENV`; before v11 it was `vercel-production`). Sentry alert
  rules and saved searches must filter on the new name.
* Session Replay is deliberately **off**: it records the DOM of a console
  that displays face crops, camera names and RTSP hostnames.

**When `NEXT_PUBLIC_SENTRY_DSN` is unset, `Sentry.init` is never called** —
no global handlers, no network, no console noise. `captureException` in the
error boundaries degrades to a no-op, and each boundary switches to copy
that does not claim the error was reported (`errorReportingEnabled()`).
`/health` shows the same flag per runtime, so an admin can see at a glance
whether anything is listening.

The DSN is inlined into the client bundle at **build** time, so changing it
requires a redeploy, not just an env edit.

## Failure-rate monitor

`/api/monitoring/error-rate` counts `LOGIN_FAILED` + `TOTP_LOGIN_FAILED` +
`LOGIN_BLOCKED` audit rows in the last **24 hours** against the preceding
**7 days**, and on a spike writes a `MONITOR_ALARM` audit row, pushes every
admin and posts to Telegram (`lib/notify.ts#notifyOpsAlarm`); it also posts
to `SLACK_ALERT_WEBHOOK` when that optional channel is configured.

It runs **once a day** (`10 2 * * *`, 02:10 UTC) because the project is on
the Vercel Hobby plan, which refuses any cron that fires more than once a
day — an hourly schedule fails the whole deployment. The recent window is
exactly the interval between runs, so every minute of the day is examined by
one run, but **detection can take up to 24 hours**. For faster detection,
move to a paid plan and set the schedule and `RECENT_WINDOW_MIN` /
`BASELINE_WINDOW_MIN` in `app/api/monitoring/error-rate/window.ts` together
(e.g. hourly with 60 / 23 × 60) — `__tests__/observability.test.ts` reads
`vercel.json` and fails when the two disagree.

A failed count query now answers 500 (`status: "error"`) instead of
reporting a green window built on a query that never ran.

## Uptime alerting

pg_cron probes `GET https://aicctv.dev/api/uptime` every 5 minutes
(`private.uptime_probe()`) and `private.uptime_collect()` turns each reply
into a `public.uptime_checks` row with three independent verdicts:

| Column | Meaning | Unknown (NULL) when |
|---|---|---|
| `web_ok` | The web app answered with `/api/uptime`'s JSON body (HTTP 200 or 503) | not collected yet |
| `db_ok` | `checks.db.ok` from that body — Vercel → Supabase round trip (`public.ping()`) | the web app did not answer |
| `ml_ok` | `checks.ml.ok` — Vercel → Railway ML health | the web app did not answer |

A timeout, no response, an HTML 5xx or a foreign JSON body is `web_ok =
false` — never "ML down". Telegram receives one message per transition
(`web_down` / `web_recovered` / `db_down` / `db_recovered` / `ml_down` /
`ml_recovered`) through the `telegram-alerts` edge function; each probe is
compared with the one before it for web, and with the previous web-answered
probe for db and ml — also when a late response resolves two probes in one
collector run. `notified` records what was sent, so nothing is sent twice. Detection
takes one probe interval plus the 2-minute collection lag (≤ ~7 min).
Details and inspection queries: [RUNBOOK §5](RUNBOOK.md#uptime-monitor-pg_cron).

**Limitation: a complete Postgres outage cannot alert from here.** pg_cron,
pg_net and the vault secrets all live inside the database, so when Postgres
is down the monitor stops instead of reporting. `db_down` therefore means
"the app cannot reach the database while Postgres itself still runs"
(PostgREST, pooler, API key, network). Covering a full outage needs a probe
outside Supabase: `.github/workflows/uptime-probe.yml` runs
`scripts/uptime-probe.cjs` on GitHub's runners every hour (`7 * * * *`, plus
`workflow_dispatch`). It calls `/api/uptime` (three attempts, 20 s apart) and
sends a Telegram message straight to the Bot API — no Supabase or Vercel on the
alert path — when the web app stops or resumes answering, or when it answers
that its database check fails or recovers (ML stays with pg_cron, so an ML
incident is not reported twice). State is carried between runs with
`actions/cache`, so each change is announced once. While web or database is
down the job fails, and GitHub e-mails the owner about the failed scheduled
run — that works even before the Telegram secrets exist. It needs
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as GitHub Actions secrets
([RUNBOOK §5](RUNBOOK.md#external-probe-covers-a-full-database-outage)).

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
*something* in the SLO table is red — breached, or impossible to measure.

Each SLO reports `met` / `breached` / `no_data` / `error`, never "green by
default": an empty sample set (or fewer than 5 samples) is `no_data`, which
answers 200 with a top-level `status: "partial"`. Alert on `status !== "ok"`
if you want to know about missing evidence, on HTTP 503 if you only want
real breaches. The response carries aggregate state only — ratios and
latencies, never the underlying counts.

## Setup

| Var | Where | What |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel (build time) | Browser + server Sentry destination. Unset ⇒ the SDK never initialises and the UI stops claiming errors are reported |
| `SENTRY_DSN` | Vercel (optional), ML Service | Server-only override; wins over the public DSN in the Node/edge runtimes |
| `SENTRY_AUTH_TOKEN` | Vercel build env | Source-map upload |
| `SENTRY_ERROR_RATE_THRESHOLD` | Vercel | Spike threshold for the failure-rate monitor (default `0.10`; anything unparseable falls back to the default instead of silently becoming `NaN`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Vercel + ML Service | OTLP collector — when set, NodeSDK initialises |
| `OTEL_SERVICE_NAME` | Vercel + ML Service | Auto-set per service |

The OTLP endpoint is optional. Note how it interacts with Sentry: when a
Sentry DSN is set, `Sentry.init` registers the global OpenTelemetry tracer
provider first, so `withSpan` / `tracedFetch` spans become Sentry spans
(they are no-ops only when neither Sentry nor an endpoint is configured),
and `lib/telemetry.ts`'s NodeSDK — started after Sentry — has its own
provider registration refused, so nothing is exported over OTLP. Real
OTLP export needs setup 3 of the Sentry v11 migration guide ("your own
OpenTelemetry, Sentry linked to it": `enableOpenTelemetrySetup: false` +
`Sentry.openTelemetryIntegration()`), which moves Next.js server spans
out of Sentry. Sentry transactions work without any of this.

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
