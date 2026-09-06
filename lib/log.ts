/**
 * Structured JSON logger for MONGOLZ Security.
 *
 * Each log line is a single-line JSON object so Vercel's log drains
 * (and any downstream Datadog / Grafana Loki / OpenSearch pipeline)
 * can index fields directly instead of scraping a free-form string.
 *
 * Fields:
 *   ts       — ISO 8601 timestamp
 *   level    — debug | info | warn | error
 *   msg      — human-readable message (the only freeform field)
 *   ...rest  — arbitrary structured fields. Sensitive keys get masked
 *              before serialisation (see REDACT_KEYS).
 *
 * Use sparingly in hot paths — every log line is a Vercel function
 * invocation cost. Prefer one structured line at the *boundary* of a
 * unit of work (request in / request out) over many lines inside.
 */

type Level = "debug" | "info" | "warn" | "error";

const REDACT_KEYS = new Set([
  "password",
  "totp_secret",
  "totp_code",
  "session",
  "cookie",
  "authorization",
  "x-api-key",
  "ml_service_token",
  "vapid_private_key",
  "supabase_service_role_key",
  "service_role_key",
  "anon_key",
  "encryption_key",
  "camera_url_key",
  "stream_ticket_secret",
  "reauth_cookie_secret",
  "session_pin_secret",
  "push_dispatch_secret",
  "cron_secret",
  "access_token",
  "refresh_token",
  "id_token",
  "secret",
  "token",
  "jwt",
  "bearer",
  "apikey",
  "api_key",
]);

// Substring patterns — catch secret-shaped keys we didn't enumerate
// (e.g. "stripe_token", "my_password", "webhook_secret"). Deliberately
// excludes the bare word "key" (too many false positives: "keyboard",
// "publishable_key", "keyword").
const REDACT_SUBSTRINGS = [
  "password",
  "passwd",
  "secret",
  "token",
  "jwt",
  "apikey",
  "api_key",
  "private_key",
  "privatekey",
  "credential",
  "recovery_code",
];

function keyIsSensitive(key: string): boolean {
  const k = key.toLowerCase();
  if (REDACT_KEYS.has(k)) return true;
  return REDACT_SUBSTRINGS.some((p) => k.includes(p));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function redactValue(): unknown {
  // Never echo any part of the secret — a 4-char prefix is half of a short
  // password.
  return "[redacted]";
}

function redact(obj: unknown, depth = 0, seen?: WeakSet<object>): unknown {
  if (depth > 6) return "[depth-limit]";
  if (Array.isArray(obj)) {
    const set = seen ?? new WeakSet<object>();
    if (set.has(obj)) return "[cycle]";
    set.add(obj);
    return obj.map((v) => redact(v, depth + 1, set));
  }
  if (!isObject(obj)) return obj;
  const set = seen ?? new WeakSet<object>();
  if (set.has(obj)) return "[cycle]";
  set.add(obj);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (keyIsSensitive(k)) {
      out[k] = redactValue();
    } else {
      out[k] = redact(v, depth + 1, set);
    }
  }
  return out;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  const text = JSON.stringify(line);
  // Route through the matching console fn so Vercel + Sentry + browser
  // dev-tools all see the correct severity.
  switch (level) {
    case "debug":
      console.debug(text);
      break;
    case "info":
      console.info(text);
      break;
    case "warn":
      console.warn(text);
      break;
    case "error":
      console.error(text);
      break;
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) =>
    emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) =>
    emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) =>
    emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) =>
    emit("error", msg, fields),

  /** Convenience: log an unknown thrown value as `error`. */
  exception(msg: string, err: unknown, fields?: Record<string, unknown>): void {
    const errObj =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { value: String(err) };
    emit("error", msg, { ...fields, error: errObj });
  },

  /** Bind a trace_id (and optional fields) to every emit on the
   *  returned logger — useful for request-scoped logging. */
  child(bound: Record<string, unknown>) {
    return {
      debug: (msg: string, fields?: Record<string, unknown>) =>
        emit("debug", msg, { ...bound, ...fields }),
      info: (msg: string, fields?: Record<string, unknown>) =>
        emit("info", msg, { ...bound, ...fields }),
      warn: (msg: string, fields?: Record<string, unknown>) =>
        emit("warn", msg, { ...bound, ...fields }),
      error: (msg: string, fields?: Record<string, unknown>) =>
        emit("error", msg, { ...bound, ...fields }),
      exception: (msg: string, err: unknown, fields?: Record<string, unknown>) => {
        const errObj =
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : { value: String(err) };
        emit("error", msg, { ...bound, ...fields, error: errObj });
      },
    };
  },
};

export type Logger = typeof log;
