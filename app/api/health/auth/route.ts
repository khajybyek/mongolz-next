import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  return NextResponse.json({ status: "ok", detail: "Auth session valid" });
}
