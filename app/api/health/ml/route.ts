import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "";
  const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";
  if (!ML_URL) {
    return NextResponse.json({ status: "error", detail: "ML service URL is not configured" }, { status: 503 });
  }

  try {
    const headers: Record<string, string> = {};
    if (ML_TOKEN) headers.Authorization = `Bearer ${ML_TOKEN}`;
    const res = await fetch(ML_URL, { headers, signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { service?: unknown; active_cameras?: unknown };
    const activeCameras = data.active_cameras;
    if (!res.ok || typeof data.service !== "string" || typeof activeCameras !== "number" || !Number.isFinite(activeCameras) || activeCameras < 0) {
      return NextResponse.json({ status: "error", detail: "ML service reported an unhealthy response" }, { status: 503 });
    }
    return NextResponse.json({
      status: "ok",
      detail: `${data.service} — ${activeCameras} cameras active`,
    });
  } catch {
    return NextResponse.json({ status: "error", detail: "ML service unreachable" }, { status: 503 });
  }
}
