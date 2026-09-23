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
import { isPrivateIp } from "@/lib/net-guard";
import type { WebhookEvent } from "@/lib/webhook-events";

/**
 * SSRF defence. Admission (/webhooks action) refuses private hosts; delivery
 * resolves the hostname before AND after the request and refuses private
 * answers (lib/net-guard.ts normalises IPv4-mapped IPv6 and covers the
 * reserved ranges). Redirects are never followed (`redirect: "manual"`, any
 * 3xx is a failed delivery): following one sent the POST to whatever
 * address the Location named — a 302 to http://127.0.0.1 was fetched and
 * its status shown on /webhooks. The connect itself is NOT pinned to the
 * pre-resolved IP (no undici Agent is available here), so a residual
 * rebinding window remains between the checks; admission + both resolves
 * are the controls.
 */

/**
 * Event vocabulary: lib/webhook-events.ts (client-safe, shared with the
 * form). Re-exported for the server action and existing importers.
 */
export { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhook-events";

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

/**
 * A reveal job was created and is waiting for a SECOND admin (4-eyes). The
 * link points at the approvals queue rather than the job so the recipient
 * lands where the decision is taken.
 */
export interface RevealRequestedEventPayload {
  type: "reveal_requested";
  job_id: string;
  recording_id: string;
  method: string;
  threshold: number | null;
  requested_email: string | null;
  created_at: string;
  url: string;
}

/**
 * Lifecycle end of a reveal request. `approved` / `rejected` are the 4-eyes
 * decisions (no separate decision event exists by design — subscribers opt
 * into one "reveal finished" stream); `completed` / `failed` are reserved for
 * the ML run itself.
 */
export interface RevealEventPayload {
  type: "reveal_completed";
  job_id: string;
  recording_id: string;
  status: "completed" | "failed" | "approved" | "rejected";
  duration_sec: number | null;
  requested_email: string | null;
  decided_email?: string | null;
  reason?: string | null;
  url: string;
}

export type EventPayload =
  | AlertEventPayload
  | RevealRequestedEventPayload
  | RevealEventPayload
  | Record<string, unknown>;

const REVEAL_STATUS_LABEL: Record<RevealEventPayload["status"], string> = {
  completed: "✅ Reveal completed",
  failed: "❌ Reveal failed",
  approved: "✅ Reveal approved",
  rejected: "⛔ Reveal rejected",
};

// Discord embed colours: green for a positive outcome, red otherwise.
const REVEAL_STATUS_COLOR: Record<RevealEventPayload["status"], number> = {
  completed: 0x23d160,
  failed: 0xff3860,
  approved: 0x23d160,
  rejected: 0xff3860,
};

function shortId(id: unknown): string {
  return typeof id === "string" && id ? id.slice(0, 8) : "?";
}

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
  if (p.type === "reveal_requested") {
    const rp = p as RevealRequestedEventPayload;
    return {
      text: `🔐 MONGOLZ reveal request from *${rp.requested_email ?? "unknown"}* — awaiting 2nd-admin approval`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `🔐 *Reveal request — awaiting 4-eyes approval*` } },
        { type: "section", fields: [
          { type: "mrkdwn", text: `*Requester:*\n${rp.requested_email ?? "unknown"}` },
          { type: "mrkdwn", text: `*Recording:*\n\`${shortId(rp.recording_id)}\`` },
          { type: "mrkdwn", text: `*Method:*\n${rp.method}` },
          { type: "mrkdwn", text: `*When:*\n${rp.created_at}` },
        ] },
        { type: "actions", elements: [
          { type: "button", text: { type: "plain_text", text: "Review" }, url: rp.url },
        ] },
      ],
    };
  }
  if (p.type === "reveal_completed") {
    const rp = p as RevealEventPayload;
    const label = REVEAL_STATUS_LABEL[rp.status] ?? `Reveal ${rp.status}`;
    const fields = [
      { type: "mrkdwn", text: `*Requester:*\n${rp.requested_email ?? "unknown"}` },
      { type: "mrkdwn", text: `*Recording:*\n\`${shortId(rp.recording_id)}\`` },
    ];
    if (rp.decided_email) fields.push({ type: "mrkdwn", text: `*Decided by:*\n${rp.decided_email}` });
    if (rp.reason) fields.push({ type: "mrkdwn", text: `*Reason:*\n${rp.reason}` });
    return {
      text: `${label} — ${rp.requested_email ?? "unknown"}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${label}*` } },
        { type: "section", fields },
        { type: "actions", elements: [
          { type: "button", text: { type: "plain_text", text: "View" }, url: rp.url },
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
  if (p.type === "reveal_requested") {
    const rp = p as RevealRequestedEventPayload;
    return {
      embeds: [{
        title: "🔐 Reveal request — awaiting 4-eyes approval",
        description: `**${rp.requested_email ?? "unknown"}** asked to un-blur a recording. A second admin must approve.`,
        color: 0xffdd57,
        fields: [
          { name: "Recording", value: shortId(rp.recording_id), inline: true },
          { name: "Method", value: rp.method, inline: true },
          { name: "When", value: rp.created_at, inline: true },
        ],
        url: rp.url,
        timestamp: rp.created_at,
      }],
    };
  }
  if (p.type === "reveal_completed") {
    const rp = p as RevealEventPayload;
    const fields = [
      { name: "Requester", value: rp.requested_email ?? "unknown", inline: true },
      { name: "Recording", value: shortId(rp.recording_id), inline: true },
    ];
    if (rp.decided_email) fields.push({ name: "Decided by", value: rp.decided_email, inline: true });
    if (rp.reason) fields.push({ name: "Reason", value: rp.reason, inline: false });
    return {
      embeds: [{
        title: REVEAL_STATUS_LABEL[rp.status] ?? `Reveal ${rp.status}`,
        color: REVEAL_STATUS_COLOR[rp.status] ?? 0x7a7a7a,
        fields,
        url: rp.url,
      }],
    };
  }
  return { content: `MONGOLZ event: ${(p as { type?: string }).type ?? "unknown"}` };
}

export type DeliveryResult = { ok: boolean; status: number };

async function deliver(hook: WebhookRow, payload: EventPayload): Promise<DeliveryResult> {
  // One malformed payload must never reject the whole fan-out.
  let json: string;
  try {
    const body =
      hook.kind === "slack" ? buildSlackBody(payload) :
      hook.kind === "discord" ? buildDiscordBody(payload) :
      payload;
    json = JSON.stringify(body);
  } catch {
    return { ok: false, status: 0 };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hook.kind === "generic" && hook.signing_secret) {
    const sig = createHmac("sha256", hook.signing_secret).update(json).digest("hex");
    headers["X-Mongolz-Signature"] = `sha256=${sig}`;
    headers["X-Mongolz-Event"] = (payload as { type?: string }).type ?? "event";
  }

  // DNS rebinding defence — bracket: resolve before and after, refuse if
  // ANY answer is private. See the module comment for the residual window.
  let u: URL;
  try {
    u = new URL(hook.url);
  } catch {
    return { ok: false, status: 0 };
  }
  if (u.protocol !== "https:") return { ok: false, status: 0 };

  async function safeResolve(): Promise<{ ok: true } | { ok: false }> {
    try {
      const host = u.hostname.replace(/^\[|\]$/g, "");
      const all = await dnsLookup(host, { all: true });
      if (!all.length || all.some((r) => isPrivateIp(r.address))) return { ok: false };
      return { ok: true };
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
      redirect: "manual",
    });
    clearTimeout(timer);
    // Never follow a redirect: Location could name an internal address.
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      return { ok: false, status: res.status };
    }

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

type ServiceClient = ReturnType<typeof createServiceClient>;

async function recordDelivery(svc: ServiceClient, id: string, r: DeliveryResult): Promise<void> {
  // fail_count is advisory (surfaced on /webhooks so admins can spot a broken
  // endpoint): reset on success, otherwise read-then-increment.
  let failCount = 0;
  if (!r.ok) {
    const { data: cur } = await svc
      .from("webhooks")
      .select("fail_count")
      .eq("id", id)
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
    .eq("id", id);
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
    await recordDelivery(svc, h.id, r);
  }));
}

/**
 * Deliver to exactly ONE webhook, enabled or not — the /webhooks "Test"
 * button. dispatchEvent() fans out to every enabled hook subscribed to the
 * event, so a test used to page every on-call channel and rewrite the other
 * hooks' health counters, and did nothing at all for a disabled hook.
 */
export async function dispatchToHook(hookId: string, payload: EventPayload): Promise<DeliveryResult | null> {
  const svc = createServiceClient();
  const { data: hook } = await svc
    .from("webhooks")
    .select("id, name, kind, url, signing_secret, events")
    .eq("id", hookId)
    .maybeSingle();
  if (!hook) return null;
  const r = await deliver(hook as WebhookRow, payload);
  await recordDelivery(svc, hookId, r);
  return r;
}
