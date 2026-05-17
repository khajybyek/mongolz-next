/**
 * OpenTelemetry helper layer for MONGOLZ Security.
 *
 * Background
 * ----------
 * `instrumentation.ts` boots a NodeSDK + HttpInstrumentation when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set. That gives us outbound HTTP spans
 * for free, but everything else (API route handlers, DB calls, ML
 * service calls) is invisible to the trace until we wrap it.
 *
 * This file adds two things:
 *
 *   1. `withSpan(name, fn, attrs?)` — wrap an async block in a span so
 *      the work shows up in the trace, with attributes attached.
 *
 *   2. `tracedFetch(url, init?)` — drop-in fetch replacement that adds
 *      W3C `traceparent` to the outbound headers so the receiver (our
 *      ML service on Railway, Supabase Edge Functions, etc.) can
 *      continue the trace.
 *
 * Both helpers are no-ops if OTEL isn't initialised — they pay only the
 * tiniest call-overhead in that case so they're safe to sprinkle
 * everywhere.
 */
import { context, propagation, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Span, SpanOptions, Tracer } from "@opentelemetry/api";

const TRACER_NAME = "mongolz-next";

function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

/** Run `fn` inside a span. Records exceptions + sets status correctly
 *  so the trace UI shows red on failure. */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  options?: SpanOptions,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, options ?? {}, async (span) => {
    try {
      const out = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return out;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Fetch wrapper that adds W3C `traceparent` so receivers can join the
 *  trace. Falls back to plain fetch when OTEL isn't loaded. */
export async function tracedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? "GET";

  return withSpan(
    `HTTP ${method} ${shortenUrl(url)}`,
    async (span) => {
      span.setAttribute("http.method", method);
      span.setAttribute("http.url", url);

      const headers = new Headers(init?.headers);
      propagation.inject(context.active(), headers, {
        set: (carrier, key, value) => carrier.set(key, String(value)),
      });

      const res = await fetch(input, { ...init, headers });
      span.setAttribute("http.status_code", res.status);
      if (res.status >= 400) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.status}` });
      }
      return res;
    },
    { kind: 2 /* SpanKind.CLIENT */ },
  );
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url.slice(0, 80);
  }
}

/** Pull the active trace_id (if any) so structured logs can correlate
 *  with traces in Tempo / Grafana / SigNoz. */
export function activeTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  const ctx = span?.spanContext();
  return ctx && ctx.traceId !== "00000000000000000000000000000000" ? ctx.traceId : undefined;
}
