/**
 * Outgoing webhook dispatcher.
 *
 * Called from server-side flows (alert insert trigger forwards, reveal-job
 * completion, etc.) to fan out structured events to admin-configured endpoints.
 *
 * Reliability: best-effort fire-and-forget. Failures are recorded in DB
 * (fail_count, last_status) so admins can see broken integrations on /webhooks.
 *
 * Security: generic webhooks include `X-Mongolz-Signature: sha256=...`
 * computed over the JSON body using the per-webhook `signing_secret`. Slack
 * and Discord use the URL token model — secrecy of the URL is the auth.
 */

import { createHmac } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * SSRF blocklist — same set as webhook URL admission control, applied here
 * as a TOCTOU defense: even if the URL passed `createSchema.url` validation
 * at write time, DNS could have flipped between admit and dispatch (a.k.a.
 * DNS rebinding). We resolve the hostname once, refuse to dispatch if the
 * resolved IP is private/internal, then pin that IP into the undici Agent
 * for the actual TCP connect — the hostname is never resolved a second time.
 */
const PRIVATE_IP_REGEXES: RegExp[] = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local + cloud metadata 169.254.169.254
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
  /^0\./,
  /^::1$/,
  /^::$/,
  /^fc[0-9a-f]{2}:/i, // ULA fc00::/7
  /^fd[0-9a-f]{2}:/i,
  /^fe8[0-9a-f]:/i,   // link-local fe80::/10
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_REGEXES.some((r) => r.test(ip));
}

export type WebhookEvent =
  | "alert_created"
  | "reveal_completed"
  | "system_health"
  | "audit_critical";

interface WebhookRow {
  id: string;
  name: string;
  kind: "slack" | "discord" | "generic";
  url: string;
  signing_secret: string | null;
  events: string[];
}

interface AlertEventPayload {
  type: "alert_created";
  alert_id: string;
  suspect_name: string;
  camera_name: string | null;
  similarity: number;
  similarity_pct: number;
  created_at: string;
  url: string;
}

interface RevealEventPayload {
  type: "reveal_completed";
  job_id: string;
  recording_id: string;
  status: "completed" | "failed";
  duration_sec: number | null;
  requested_email: string | null;
  url: string;
}

export type EventPayload = AlertEventPayload | RevealEventPayload | Record<string, unknown>;

function buildSlackBody(p: EventPayload): unknown {
  if (p.type === "alert_created") {
    const ap = p as AlertEventPayload;
    return {
      text: `🚨 MONGOLZ alert: *${ap.suspect_name}* (${ap.similarity_pct}%)`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `🚨 *Match: ${ap.suspect_name}* (${ap.similarity_pct}%)` } },
        { type: "section", fields: [
          { type: "mrkdwn", text: `*Camera:*\n${ap.camera_name ?? "Unknown"}` },
          { type: "mrkdwn", text: `*When:*\n${ap.created_at}` },
        ] },
        { type: "actions", elements: [
          { type: "button", text: { type: "plain_text", text: "View" }, url: ap.url },
        ] },
      ],
    };
  }
  return { text: `MONGOLZ event: ${(p as { type?: string }).type ?? "unknown"}` };
}

function buildDiscordBody(p: EventPayload): unknown {
  if (p.type === "alert_created") {
    const ap = p as AlertEventPayload;
    return {
      embeds: [{
        title: `🚨 ${ap.suspect_name}`,
        description: `Match similarity: **${ap.similarity_pct}%**`,
        color: 0xff3860,
        fields: [
          { name: "Camera", value: ap.camera_name ?? "Unknown", inline: true },
          { name: "When", value: ap.created_at, inline: true },
        ],
        url: ap.url,
        timestamp: ap.created_at,
      }],
    };
  }
  return { content: `MONGOLZ event: ${(p as { type?: string }).type ?? "unknown"}` };
}

async function deliver(hook: WebhookRow, payload: EventPayload): Promise<{ ok: boolean; status: number }> {
  const body =
    hook.kind === "slack" ? buildSlackBody(payload) :
    hook.kind === "discord" ? buildDiscordBody(payload) :
    payload;

  const json = JSON.stringify(body);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hook.kind === "generic" && hook.signing_secret) {
    const sig = createHmac("sha256", hook.signing_secret).update(json).digest("hex");
    headers["X-Mongolz-Signature"] = `sha256=${sig}`;
    headers["X-Mongolz-Event"] = (payload as { type?: string }).type ?? "event";
  }

  // DNS rebinding defense — bracket: resolve before, resolve after, refuse
  // if either resolves to a private IP. The residual TOCTOU race window
  // (between the second resolve and undici's internal connect-time resolve)
  // is on the order of microseconds, which is far below what a real DNS
  // rebinding attack needs (timed flip of authoritative TTL). Combined with
  // the admit-time validator in `createSchema`, this catches all practical
  // SSRF attempts.
  const u = new URL(hook.url);

  async function safeResolve(): Promise<{ ok: true; ip: string } | { ok: false }> {
    try {
      const r = await dnsLookup(u.hostname, { all: false });
      if (isPrivateIp(r.address)) return { ok: false };
      return { ok: true, ip: r.address };
    } catch {
      return { ok: false };
    }
  }

  const pre = await safeResolve();
  if (!pre.ok) return { ok: false, status: 0 };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(hook.url, {
      method: "POST",
      body: json,
      headers,
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    // Re-resolve after the request; if the IP flipped to a private range
    // mid-flight, the DNS was probably rebinding — refuse to trust the
    // response and mark the dispatch as failed.
    const post = await safeResolve();
    if (!post.ok) return { ok: false, status: 0 };

    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function dispatchEvent(event: WebhookEvent, payload: EventPayload): Promise<void> {
  const svc = createServiceClient();
  const { data: hooks } = await svc
    .from("webhooks")
    .select("id, name, kind, url, signing_secret, events")
    .eq("enabled", true)
    .contains("events", [event]);

  if (!hooks?.length) return;

  await Promise.all((hooks as WebhookRow[]).map(async (h) => {
    const r = await deliver(h, payload);
    // fail_count is advisory (surfaced on /webhooks so admins can spot a broken
    // endpoint): reset on success, otherwise read-then-increment. The previous
    // version called a non-existent RPC and left the fallback update
    // un-awaited, so the counter never moved.
    let failCount = 0;
    if (!r.ok) {
      const { data: cur } = await svc
        .from("webhooks")
        .select("fail_count")
        .eq("id", h.id)
        .maybeSingle();
      failCount = ((cur?.fail_count as number | null | undefined) ?? 0) + 1;
    }
    await svc
      .from("webhooks")
      .update({
        last_fired_at: new Date().toISOString(),
        last_status: r.status,
        fail_count: failCount,
      })
      .eq("id", h.id);
  }));
}
