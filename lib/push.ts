import webpush from "web-push";
import { createServiceClient } from "@/lib/supabase/server";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
};

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@mongolz.local";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export function isPushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function sendPushToSubscription(
  sub: SubscriptionRow,
  payload: PushPayload,
): Promise<{ ok: boolean; gone?: boolean; statusCode?: number; error?: string }> {
  if (!ensureConfigured()) return { ok: false, error: "vapid-not-configured" };
  const subscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 60 });
    return { ok: true };
  } catch (err) {
    const e = err as { statusCode?: number; body?: string; message?: string };
    const gone = e.statusCode === 404 || e.statusCode === 410;
    return { ok: false, gone, statusCode: e.statusCode, error: e.message ?? String(err) };
  }
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ delivered: number; failed: number; gone: number }> {
  const supabase = createServiceClient();
  const { data: rows } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, enabled")
    .eq("user_id", userId)
    .eq("enabled", true);
  const subs = (rows ?? []) as Array<SubscriptionRow & { enabled: boolean }>;
  let delivered = 0;
  let failed = 0;
  let gone = 0;
  for (const s of subs) {
    const res = await sendPushToSubscription(s, payload);
    if (res.ok) {
      delivered++;
      await supabase
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", s.id);
    } else if (res.gone) {
      gone++;
      await supabase
        .from("push_subscriptions")
        .update({ enabled: false })
        .eq("id", s.id);
    } else {
      failed++;
    }
  }
  return { delivered, failed, gone };
}

export async function sendPushToAllAdmins(payload: PushPayload): Promise<{ delivered: number; failed: number; gone: number }> {
  const supabase = createServiceClient();
  const { data: admins } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin");
  const totals = { delivered: 0, failed: 0, gone: 0 };
  for (const a of (admins ?? []) as Array<{ id: string }>) {
    const r = await sendPushToUser(a.id, payload);
    totals.delivered += r.delivered;
    totals.failed += r.failed;
    totals.gone += r.gone;
  }
  return totals;
}
