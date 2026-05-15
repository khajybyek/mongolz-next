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
import { createServiceClient } from "@/lib/supabase/server";

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

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(hook.url, { method: "POST", body: json, headers, signal: ctrl.signal });
    clearTimeout(timer);
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
    await svc
      .from("webhooks")
      .update({
        last_fired_at: new Date().toISOString(),
        last_status: r.status,
        fail_count: r.ok ? 0 : undefined,
      })
      .eq("id", h.id);
    if (!r.ok) {
      await svc.rpc("noop_increment_fail", { hook_id: h.id }).then(() => undefined, () => {
        // RPC may not exist — fallback to a direct read+write.
        svc.from("webhooks").select("fail_count").eq("id", h.id).single().then(({ data }) => {
          svc.from("webhooks").update({ fail_count: ((data?.fail_count as number) ?? 0) + 1 }).eq("id", h.id);
        });
      });
    }
  }));
}
