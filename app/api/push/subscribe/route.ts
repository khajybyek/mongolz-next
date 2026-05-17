import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

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

export async function POST(req: Request) {
  const auth = await requireUserApi();
  if (isAuthErr(auth)) return auth.error;

  const parsed = SubSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const { endpoint, keys, ua } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
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

  const supabase = await createClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", auth.user.id)
    .eq("endpoint", endpoint);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
