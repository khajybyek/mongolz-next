import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Public SLO status probe. External uptime monitors can poll this to
 * see real-time health against the targets defined in docs/SLO.md.
 *
 * Each section returns:
 *   ok        — boolean, did we meet the SLO?
 *   target    — the SLO target as documented.
 *   observed  — the value we measured right now.
 *
 * Cheap queries only — this endpoint must stay sub-second so external
 * monitors don't hammer Supabase. Heavier SLOs (e.g. encryption
 * decrypt-success rate) are computed by their dedicated crons; this
 * route just reads the latest result.
 */
export const dynamic = "force-dynamic";

const ONE_HOUR_MS = 3600_000;

type Slo = {
  id: string;
  name: string;
  target: string;
  observed: string | number | null;
  ok: boolean;
};

export async function GET() {
  const svc = createServiceClient();
  const slos: Slo[] = [];

  // SLO #7 — Audit chain integrity (zero tolerance).
  try {
    const { data, error } = await svc.rpc("verify_audit_chain");
    const breaks = Array.isArray(data) ? data.length : null;
    slos.push({
      id: "audit_chain",
      name: "Audit chain integrity",
      target: "0 broken rows",
      observed: error ? null : breaks,
      ok: !error && (breaks ?? -1) === 0,
    });
  } catch {
    slos.push({
      id: "audit_chain",
      name: "Audit chain integrity",
      target: "0 broken rows",
      observed: null,
      ok: false,
    });
  }

  // SLO #5 — Reveal turnaround.
  try {
    const { data } = await svc
      .from("reveal_jobs")
      .select("approved_at, completed_at, status")
      .eq("status", "completed")
      .gte("approved_at", new Date(Date.now() - 28 * 24 * ONE_HOUR_MS).toISOString())
      .not("approved_at", "is", null);
    const durations = (data ?? [])
      .map((r) => {
        const a = r.approved_at ? new Date(r.approved_at).getTime() : null;
        const c = r.completed_at ? new Date(r.completed_at).getTime() : null;
        return a && c && c > a ? c - a : null;
      })
      .filter((v): v is number => v !== null);
    const within = durations.filter((d) => d <= 5 * 60 * 1000).length;
    const ratio = durations.length === 0 ? 1 : within / durations.length;
    slos.push({
      id: "reveal_turnaround",
      name: "Reveal turnaround < 5 min",
      target: "≥ 90% of completed reveals",
      observed: `${(ratio * 100).toFixed(1)}% (${durations.length} samples)`,
      ok: ratio >= 0.9,
    });
  } catch {
    slos.push({
      id: "reveal_turnaround",
      name: "Reveal turnaround < 5 min",
      target: "≥ 90% of completed reveals",
      observed: null,
      ok: false,
    });
  }

  // SLO #6 — Alert pipeline freshness: how many alerts trail their
  // referenced face by > 60 s?
  try {
    const since = new Date(Date.now() - 7 * 24 * ONE_HOUR_MS).toISOString();
    const { data } = await svc
      .from("alerts")
      .select("created_at, face_id, faces!alerts_face_id_fkey(detected_at)")
      .gte("created_at", since)
      .not("face_id", "is", null)
      .limit(500);
    type Row = { created_at: string; faces: { detected_at: string } | { detected_at: string }[] | null };
    const lags = ((data ?? []) as Row[])
      .map((r) => {
        const f = Array.isArray(r.faces) ? r.faces[0] : r.faces;
        if (!f) return null;
        return new Date(r.created_at).getTime() - new Date(f.detected_at).getTime();
      })
      .filter((v): v is number => v !== null && v >= 0);
    const fresh = lags.filter((l) => l <= 60_000).length;
    const ratio = lags.length === 0 ? 1 : fresh / lags.length;
    slos.push({
      id: "alert_freshness",
      name: "Alert pipeline freshness ≤ 60 s",
      target: "≥ 95% of alerts",
      observed: `${(ratio * 100).toFixed(1)}% (${lags.length} samples)`,
      ok: ratio >= 0.95,
    });
  } catch {
    slos.push({
      id: "alert_freshness",
      name: "Alert pipeline freshness ≤ 60 s",
      target: "≥ 95% of alerts",
      observed: null,
      ok: false,
    });
  }

  // SLO #3 — Playback LCP p75 < 4000 ms (last 24h).
  try {
    const { data } = await svc
      .from("web_vitals_p75")
      .select("metric, page, p75")
      .eq("metric", "LCP")
      .eq("page", "/playback")
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle();
    const p75 = (data?.p75 as number | undefined) ?? null;
    slos.push({
      id: "playback_lcp",
      name: "Playback LCP p75 < 4000 ms",
      target: "p75 ≤ 4000 ms",
      observed: p75 == null ? "no data" : `${Math.round(p75)} ms`,
      ok: p75 == null ? true : p75 <= 4000,
    });
  } catch {
    slos.push({
      id: "playback_lcp",
      name: "Playback LCP p75 < 4000 ms",
      target: "p75 ≤ 4000 ms",
      observed: null,
      ok: false,
    });
  }

  const allOk = slos.every((s) => s.ok);
  const body = {
    status: allOk ? "ok" : "degraded",
    ts: new Date().toISOString(),
    slos,
    docs: "/docs/SLO.md",
  };
  return NextResponse.json(body, {
    status: allOk ? 200 : 503,
    headers: {
      "cache-control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
