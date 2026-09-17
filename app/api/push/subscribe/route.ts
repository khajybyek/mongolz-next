import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { hasFreshReauth } from "@/lib/auth/step-up";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SubSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(10).max(512),
    auth: z.string().min(10).max(256),
  }),
  ua: z.string().max(512).optional(),
});

/** A browser per device is plenty; a cap bounds what a planted channel can hide among. */
const MAX_SUBSCRIPTIONS_PER_USER = 10;

async function auditPush(action: string, userId: string, email: string, detail: string) {
  try {
    await createServiceClient().from("audit_log").insert({ action, detail, user_id: userId, user_email: email });
  } catch {
    /* audit is best-effort; the write below already happened or was refused */
  }
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid";
  }
}

/**
 * A push subscription is a durable outbound channel: lib/push.ts fans suspect
 * matches, anomaly summaries and reveal requests to every row of the user
 * with the service role, and the row outlives sign-out and password change.
 * So the table is written ONLY here (migration 20260917150000 revokes direct
 * DML from `authenticated`), admins — who receive the sensitive fan-out —
 * must present the second factor first, and every change leaves an audit row.
 */
export async function POST(req: Request) {
  const auth = await requireUserApi();
  if (isAuthErr(auth)) return auth.error;

  if (auth.profile.role === "admin" && !(await hasFreshReauth(auth.user.id))) {
    return NextResponse.json({ error: "REAUTH_REQUIRED" }, { status: 403 });
  }

  const parsed = SubSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const { endpoint, keys, ua } = parsed.data;
  if (!endpoint.startsWith("https://")) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: existing, error: readErr } = await svc
    .from("push_subscriptions")
    .select("id, user_id")
    .eq("endpoint", endpoint)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: "subscription unavailable" }, { status: 503 });
  // The service role bypasses RLS, so ownership is checked here: an endpoint
  // registered to someone else is never re-pointed (same outcome RLS gave).
  if (existing && existing.user_id !== auth.user.id) {
    return NextResponse.json({ error: "endpoint already registered" }, { status: 409 });
  }
  if (!existing) {
    const { count, error: countErr } = await svc
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", auth.user.id);
    if (countErr) return NextResponse.json({ error: "subscription unavailable" }, { status: 503 });
    if ((count ?? 0) >= MAX_SUBSCRIPTIONS_PER_USER) {
      return NextResponse.json({ error: "too many subscriptions — remove one first" }, { status: 409 });
    }
  }

  const { data, error } = await svc
    .from("push_subscriptions")
    .upsert(
      {
        user_id: auth.user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        ua: ua ?? null,
        enabled: true,
      },
      { onConflict: "endpoint" },
    )
    .select("id, endpoint, enabled, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "subscription failed" }, { status: 500 });
  }
  await auditPush("PUSH_SUBSCRIBED", auth.user.id, auth.user.email, `subscription ${data.id} host=${endpointHost(endpoint)}`);
  return NextResponse.json({ ok: true, subscription: data });
}

export async function DELETE(req: Request) {
  const auth = await requireUserApi();
  if (isAuthErr(auth)) return auth.error;

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint");
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }

  // Removing a channel only ever narrows where data goes — no step-up, so a
  // user can always shut a subscription they do not recognise.
  const svc = createServiceClient();
  const { data: removed, error } = await svc
    .from("push_subscriptions")
    .delete()
    .eq("user_id", auth.user.id)
    .eq("endpoint", endpoint)
    .select("id");

  if (error) {
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
  for (const row of removed ?? []) {
    await auditPush("PUSH_UNSUBSCRIBED", auth.user.id, auth.user.email, `subscription ${row.id} host=${endpointHost(endpoint)}`);
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const auth = await requireUserApi();
  if (isAuthErr(auth)) return auth.error;

  const supabase = await createClient();
  const { data } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, ua, enabled, created_at, last_used_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ subscriptions: data ?? [] });
}
