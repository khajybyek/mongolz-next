import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient, createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const auth = await requireUserApi();
  if (isAuthErr(auth)) return auth.error;
  const ctx = auth;
  const { password } = await request.json().catch(() => ({}));

  if (!password || typeof password !== "string") {
    return NextResponse.json({ error: "missing password" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: ctx.user.email,
    password,
  });
  if (error) {
    return NextResponse.json({ error: "Нууц үг буруу" }, { status: 401 });
  }

  const svc = createServiceClient();
  await svc
    .from("profiles")
    .update({ totp_secret: null, totp_enabled: false })
    .eq("id", ctx.user.id);

  await svc.from("audit_log").insert({
    action: "TOTP_DISABLED",
    user_id: ctx.user.id,
    user_email: ctx.user.email,
  });

  return NextResponse.json({ ok: true });
}
