import { NextResponse } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { isPushConfigured, sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireUserApi();
  if (isAuthErr(auth)) return auth.error;
  if (!isPushConfigured()) {
    return NextResponse.json({ error: "push-not-configured" }, { status: 501 });
  }
  const result = await sendPushToUser(auth.user.id, {
    title: "MONGOLZ Security",
    body: "Туршилт push мэдэгдэл — энэ нь зөв ажиллаж байна.",
    url: "/alerts",
    tag: "mongolz-test",
  });
  return NextResponse.json({ ok: true, ...result });
}
