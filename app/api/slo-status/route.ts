import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { erroredSlo, ratioSlo, summarise, thresholdSlo, zeroToleranceSlo, type Slo } from "./slo";

/**
 * Public SLO status probe. External uptime monitors poll this to see live
 * health against the targets in docs/SLO.md.
 *
 * Each entry returns:
 *   state     — met | breached | no_data | error (see ./slo.ts).
 *   ok        — state === "met". Zero samples is NOT compliance.
 *   evidence  — sufficient | insufficient | none.
 *   target    — the documented SLO target.
 *   observed  — the aggregate we measured: a ratio or a latency, never the
 *               underlying counts. This endpoint is unauthenticated, so it
 *               publishes SLO state and nothing else about the deployment.
 *
 * HTTP: 503 only when something is breached or unmeasurable. "Not enough data
 * yet" answers 200 with `status: "partial"` — honest, but not a page.
 *
 * Cheap queries only — this must stay sub-second so external monitors don't
 * hammer Supabase.
 */
export const dynamic = "force-dynamic";

const ONE_HOUR_MS = 3600_000;

/**
 * The probe walks the whole audit hash chain and scans reveal/alert history —
 * too heavy to run for every anonymous hit. Compute at most once per minute
 * (shared Next data cache, keyed without the query string so `?bust=…` cannot
 * force recomputation).
 */
const computeSlos = unstable_cache(async () => probeSlos(), ["slo-status"], { revalidate: 60 });

export async function GET() {
  const { slos, ts } = await computeSlos();
  const { status, httpStatus, counts } = summarise(slos);

  return NextResponse.json(
    { status, ts, counts, slos },
    {
      status: httpStatus,
      headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" },
    },
  );
}

async function probeSlos(): Promise<{ slos: Slo[]; ts: string }> {
  const svc = createServiceClient();
  const slos: Slo[] = [];

  // SLO #7 — Audit chain integrity (zero tolerance).
  const AUDIT = { id: "audit_chain", name: "Audit chain integrity", target: "0 broken rows" };
  try {
    const { data, error } = await svc.rpc("verify_audit_chain");
    slos.push(
      zeroToleranceSlo({ ...AUDIT, count: error || !Array.isArray(data) ? null : data.length }),
    );
  } catch {
    slos.push(erroredSlo(AUDIT.id, AUDIT.name, AUDIT.target));
  }

  // SLO #5 — Reveal turnaround.
  const REVEAL = {
    id: "reveal_turnaround",
    name: "Reveal turnaround < 5 min",
    target: "≥ 90% of completed reveals",
  };
  try {
    const { data, error } = await svc
      .from("reveal_jobs")
      .select("approved_at, completed_at, status")
      .eq("status", "completed")
      .gte("approved_at", new Date(Date.now() - 28 * 24 * ONE_HOUR_MS).toISOString())
      .not("approved_at", "is", null);
    if (error) throw error;

    const durations = (data ?? [])
      .map((r) => {
        const a = r.approved_at ? new Date(r.approved_at).getTime() : null;
        const c = r.completed_at ? new Date(r.completed_at).getTime() : null;
        return a && c && c > a ? c - a : null;
      })
      .filter((v): v is number => v !== null);

    slos.push(
      ratioSlo({
        ...REVEAL,
        samples: durations.length,
        passing: durations.filter((d) => d <= 5 * 60 * 1000).length,
        minRatio: 0.9,
      }),
    );
  } catch {
    slos.push(erroredSlo(REVEAL.id, REVEAL.name, REVEAL.target));
  }

  // SLO #6 — Alert pipeline freshness: how many alerts trail their referenced
  // face by more than 60 s?
  const FRESHNESS = {
    id: "alert_freshness",
    name: "Alert pipeline freshness ≤ 60 s",
    target: "≥ 95% of alerts",
  };
  try {
    const since = new Date(Date.now() - 7 * 24 * ONE_HOUR_MS).toISOString();
    const { data, error } = await svc
      .from("alerts")
      .select("created_at, face_id, faces!alerts_face_id_fkey(detected_at)")
      .gte("created_at", since)
      .not("face_id", "is", null)
      .limit(500);
    if (error) throw error;

    type Row = { created_at: string; faces: { detected_at: string } | { detected_at: string }[] | null };
    const lags = ((data ?? []) as Row[])
      .map((r) => {
        const f = Array.isArray(r.faces) ? r.faces[0] : r.faces;
        if (!f) return null;
        return new Date(r.created_at).getTime() - new Date(f.detected_at).getTime();
      })
      .filter((v): v is number => v !== null && v >= 0);

    slos.push(
      ratioSlo({
        ...FRESHNESS,
        samples: lags.length,
        passing: lags.filter((l) => l <= 60_000).length,
        minRatio: 0.95,
      }),
    );
  } catch {
    slos.push(erroredSlo(FRESHNESS.id, FRESHNESS.name, FRESHNESS.target));
  }

  // SLO #3 — Playback LCP p75 < 4000 ms (latest daily rollup).
  const LCP = { id: "playback_lcp", name: "Playback LCP p75 < 4000 ms", target: "p75 ≤ 4000 ms" };
  try {
    const { data, error } = await svc
      .from("web_vitals_p75")
      .select("metric, page, p75")
      .eq("metric", "LCP")
      .eq("page", "/playback")
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    const p75 = typeof data?.p75 === "number" ? data.p75 : null;
    slos.push(thresholdSlo({ ...LCP, value: p75, max: 4000, unit: "ms" }));
  } catch {
    slos.push(erroredSlo(LCP.id, LCP.name, LCP.target));
  }

  return { slos, ts: new Date().toISOString() };
}
