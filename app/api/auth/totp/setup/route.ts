import { NextResponse } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { generateSecret, buildOtpauthUri, buildQrDataUri } from "@/lib/totp";

export async function POST() {
  const auth = await requireUserApi({ allowAuditor: true });
  if (isAuthErr(auth)) return auth.error;
  const ctx = auth;
  const svc = createServiceClient();

  // Хэрэв аль хэдийн enable хийсэн бол дахин үүсгэхээс өмнө disable шаардана
  const { data: profile } = await svc
    .from("profiles")
    .select("totp_enabled")
    .eq("id", ctx.user.id)
    .single();

  if (profile?.totp_enabled) {
    return NextResponse.json(
      { error: "TOTP аль хэдийн идэвхтэй. Эхлээд disable хий." },
      { status: 400 }
    );
  }

  const secret = generateSecret();
  const otpauthUri = buildOtpauthUri(secret, ctx.user.email);
  const qrDataUri = await buildQrDataUri(otpauthUri);

  // Secret-ийг хадгална (enabled=false хэвээр — verify хийсний дараа тохируулна)
  const { error } = await svc
    .from("profiles")
    .update({ totp_secret: secret, totp_enabled: false })
    .eq("id", ctx.user.id);

  if (error) {
    console.error("[totp/setup] update failed", error.message);
    return NextResponse.json({ error: "setup_failed" }, { status: 500 });
  }

  // Audit
  await svc.from("audit_log").insert({
    action: "TOTP_SETUP_BEGIN",
    user_id: ctx.user.id,
    user_email: ctx.user.email,
  });

  return NextResponse.json({
    ok: true,
    secret,
    otpauth_uri: otpauthUri,
    qr_data_uri: qrDataUri,
  });
}
