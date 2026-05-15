import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "";
  const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";

  try {
    const headers: Record<string, string> = {};
    if (ML_TOKEN) headers.Authorization = `Bearer ${ML_TOKEN}`;
    const res = await fetch(ML_URL, { headers, signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return NextResponse.json({
      status: "ok",
      detail: `${data.service} — ${data.active_cameras} cameras active`,
    });
  } catch {
    return NextResponse.json({ status: "error", detail: "ML service unreachable" }, { status: 503 });
  }
}
