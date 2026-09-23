import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

type TunnelInfo = { requested?: unknown; state?: unknown; reason?: unknown };

/** Short, credential-free tunnel reason (the ML service already trims it). */
function safeReason(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1***@").slice(0, 120);
}

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
    const data = (await res.json()) as { service?: unknown; active_cameras?: unknown; tunnel?: TunnelInfo | null };
    const activeCameras = data.active_cameras;
    if (!res.ok || typeof data.service !== "string" || typeof activeCameras !== "number" || !Number.isFinite(activeCameras) || activeCameras < 0) {
      return NextResponse.json({ status: "error", detail: "ML service reported an unhealthy response" }, { status: 503 });
    }
    const base = `${data.service} — ${activeCameras} cameras active`;
    // `ok` on the ML side only means "the API is up". A degraded / down
    // Tailscale forward means no camera routed through CAMERA_TAILNET_FWD can
    // deliver a frame, which /health used to report as a green "ok". It says
    // nothing about cameras reached another way — per-camera state lives in
    // camera_sessions (last_error / last_heartbeat_at).
    const tunnel = data.tunnel;
    if (tunnel && tunnel.requested === true && typeof tunnel.state === "string" && tunnel.state !== "ok" && tunnel.state !== "unknown") {
      const reason = safeReason(tunnel.reason);
      return NextResponse.json({
        status: "degraded",
        detail: `${base} · tunnel ${tunnel.state}${reason ? `: ${reason}` : ""}`,
        tunnel: tunnel.state,
      });
    }
    return NextResponse.json({ status: "ok", detail: base });
  } catch {
    return NextResponse.json({ status: "error", detail: "ML service unreachable" }, { status: 503 });
  }
}
