/**
 * Read-access ledger (2026-09-08 audit, finding 1 / 6.2).
 *
 * The hash-chained `audit_log` recorded only *mutations* and auth events: who
 * changed a camera, who approved a reveal, who signed in. Nobody recorded who
 * *looked* — decrypting a sealed face crop, streaming a camera, running a 1:N
 * biometric search, pulling a person's cross-camera trail, exporting alerts or
 * downloading reveal output all happened silently, while COMPLIANCE.md and the
 * DPIA promised that every privileged access is recorded.
 *
 * This module is the one way a read gets written down. Rules it enforces:
 *
 *   • Best effort, never fatal. A ledger write must not turn a working page
 *     into a 500, so every failure is swallowed and logged to stdout instead.
 *   • Only successful reads. Callers invoke it *after* authorization passed
 *     and the data was actually produced; a refusal uses its own action name
 *     (STREAM_DENIED) so "looked" and "was turned away" never blur together.
 *   • No secrets. `detail` identifies the object (face id, recording id,
 *     camera id, row count, job id) and never carries a signed URL, an RTSP
 *     source, a token or an embedding.
 *   • Bounded volume. `audit_log`'s hash-chain trigger takes a global
 *     advisory lock per insert, so a viewer's HLS player polling the playlist
 *     every few seconds could serialise the whole ledger behind itself.
 *     Object-scoped reads therefore collapse to one row per user per object
 *     per `ACCESS_THROTTLE_MS` (see `throttleMs` / `probeDb` below).
 */

import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/lib/log";

/**
 * Actions this module writes. One source of truth so routes, the /audit page
 * and the tests cannot drift apart. Names are verbs in the past tense and are
 * append-only: an operator's saved filter must keep working.
 */
export const READ_ACTIONS = {
  REVEAL_REFERENCE_VIEWED: "REVEAL_REFERENCE_VIEWED",
  /** A face crop was decrypted / streamed to an operator. */
  FACE_CROP_VIEWED: "FACE_CROP_VIEWED",
  /** A recording's masked view was rendered and streamed. */
  RECORDING_VIEWED: "RECORDING_VIEWED",
  /** A live camera playlist was handed out (the .ts segments are not logged). */
  STREAM_VIEWED: "STREAM_VIEWED",
  /** A live stream request was refused — the counterpart of STREAM_VIEWED. */
  STREAM_DENIED: "STREAM_DENIED",
  /** A 1:N biometric search ran over the face table. */
  FACE_SEARCH: "FACE_SEARCH",
  /** A cross-camera trail (movement history of one person) was pulled. */
  REID_TRAIL: "REID_TRAIL",
  /** Alert history left the system as a CSV file. */
  ALERTS_EXPORTED: "ALERTS_EXPORTED",
  /** Un-masked reveal output was downloaded / played back. */
  REVEAL_OUTPUT_DOWNLOADED: "REVEAL_OUTPUT_DOWNLOADED",
} as const;

export type ReadAction = (typeof READ_ACTIONS)[keyof typeof READ_ACTIONS];

/** Every read action, for the /audit page and tests. */
export const READ_ACTION_NAMES = Object.values(READ_ACTIONS) as ReadAction[];

/**
 * Default collapse window for object-scoped reads: one row per user per
 * object per 5 minutes. Chosen to match the `private, max-age=300` cache hint
 * on the media routes — inside that window the browser may not even reach the
 * server, so a finer granularity would record noise, not accesses.
 */
export const ACCESS_THROTTLE_MS = 5 * 60_000;

/** `detail` is free text; keep rows readable in the table and the CSV export. */
const DETAIL_MAX = 400;

/** Upper bound on the in-process throttle map (a lambda instance is long-lived). */
const THROTTLE_MAX_ENTRIES = 4096;

type HeaderSource = { headers: Headers } | Headers | null;

export interface AccessEntry {
  action: ReadAction;
  /** What was read — an object id and a count, never a secret. */
  detail: string;
  userId?: string | null;
  userEmail?: string | null;
  /** The incoming request (or its Headers) — used for the client IP. */
  request?: HeaderSource;
  /**
   * Collapse identical (action, user, detail) rows inside this window.
   * 0 / omitted = write every read (query-shaped events, where each call is a
   * distinct question and the detail differs anyway).
   */
  throttleMs?: number;
  /**
   * Also ask the ledger whether a matching row already exists in the window.
   * Costs one indexed SELECT, but survives a cold serverless instance — used
   * on the hot path (HLS playlist) where the in-process map alone cannot
   * promise a bound. A failing probe never suppresses the row.
   */
  probeDb?: boolean;
}

// ── in-process suppression ────────────────────────────────────────────
const lastSeen = new Map<string, number>();

function seenRecently(key: string, now: number, windowMs: number): boolean {
  const at = lastSeen.get(key);
  if (at === undefined) return false;
  if (now - at < windowMs) return true;
  lastSeen.delete(key);
  return false;
}

function remember(key: string, now: number): void {
  if (lastSeen.size >= THROTTLE_MAX_ENTRIES) {
    // Map keeps insertion order — drop the oldest quarter rather than
    // scanning for expiry on every write.
    let drop = Math.ceil(THROTTLE_MAX_ENTRIES / 4);
    for (const k of lastSeen.keys()) {
      lastSeen.delete(k);
      if (--drop <= 0) break;
    }
  }
  lastSeen.set(key, now);
}

/** Test-only: forget every suppression window. */
export function resetAccessThrottle(): void {
  lastSeen.clear();
}

// ── client IP ─────────────────────────────────────────────────────────
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+(?:\.\d{1,3}){0,3}$/;

/**
 * `audit_log.ip` is `inet`: a malformed value fails the INSERT and we lose the
 * whole row. `x-forwarded-for` is client-supplied (Vercel overwrites it, but
 * the ledger must not depend on that), so anything that is not a literal
 * address is dropped rather than sent to Postgres.
 */
function normaliseIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.split(",")[0]?.trim() ?? "";
  if (!v) return null;
  // "[::1]:443" → "::1"
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(v);
  if (bracketed) v = bracketed[1];
  // "1.2.3.4:5678" → "1.2.3.4" (an IPv6 literal has many colons — leave it)
  if (v.split(":").length === 2 && v.includes(".")) v = v.split(":")[0];
  if (IPV4_RE.test(v)) {
    return v.split(".").every((o) => Number(o) <= 255) ? v : null;
  }
  if (v.includes(":") && v.length <= 45 && IPV6_RE.test(v)) return v;
  return null;
}

async function clientIp(source: HeaderSource | undefined): Promise<string | null> {
  try {
    let h: Headers | undefined;
    if (source) h = source instanceof Headers ? source : source.headers;
    if (!h) {
      const { headers } = await import("next/headers");
      h = await headers();
    }
    return normaliseIp(h.get("x-forwarded-for")) ?? normaliseIp(h.get("x-real-ip"));
  } catch {
    // Outside a request scope (or headers unavailable) — the row is still
    // worth writing without an IP.
    return null;
  }
}

function truncate(detail: string): string {
  const flat = detail.replace(/\s+/g, " ").trim();
  return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX - 1)}…` : flat;
}

// ── the helper ────────────────────────────────────────────────────────
/**
 * Write one "someone read personal data" row. Never throws, never rejects.
 */
export async function recordAccess(entry: AccessEntry): Promise<void> {
  try {
    const detail = truncate(entry.detail);
    const windowMs = entry.throttleMs ?? 0;
    const key = `${entry.action}|${entry.userId ?? "anon"}|${detail}`;
    const now = Date.now();
    if (windowMs > 0 && seenRecently(key, now, windowMs)) return;

    const svc = createServiceClient();

    if (windowMs > 0 && entry.probeDb && entry.userId) {
      const already = await ledgerHasRecent(svc, entry.action, entry.userId, detail, windowMs);
      if (already) {
        remember(key, now);
        return;
      }
    }

    const ip = await clientIp(entry.request);
    const res = await svc.from("audit_log").insert({
      action: entry.action,
      detail,
      user_id: entry.userId ?? null,
      user_email: entry.userEmail ?? null,
      ...(ip ? { ip } : {}),
    });
    if (res?.error) {
      // Do not remember a failed write — the next read should try again.
      log.warn("audit: read-access row rejected", {
        action: entry.action,
        code: res.error.code,
      });
      return;
    }
    if (windowMs > 0) remember(key, now);
  } catch (err) {
    log.warn("audit: read-access row not written", {
      action: entry.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * True when an identical row already exists inside the window. A failure
 * (client shape, network, RLS) answers "no" so the access is still recorded:
 * an extra row is harmless, a missing one is the bug this module exists for.
 */
async function ledgerHasRecent(
  svc: ServiceClient,
  action: ReadAction,
  userId: string,
  detail: string,
  windowMs: number,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - windowMs).toISOString();
    const res = await svc
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", action)
      .eq("user_id", userId)
      .eq("detail", detail)
      .gte("created_at", since);
    return (res?.count ?? 0) > 0;
  } catch {
    return false;
  }
}
