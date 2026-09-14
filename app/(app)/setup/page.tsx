import { CheckCircle, Circle, ArrowRight, AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { workflowCopy } from "@/lib/workflow-copy";
import { probeDb, probeMl } from "@/lib/health-probes";
import { CAMERA_FRESH_MS, INGEST_FRESH_MS, isFreshEvidence } from "@/lib/readiness";
import { formatDate } from "@/lib/utils";
import { readMfaOk, type RpcCapableClient } from "@/lib/metrics";

export const dynamic = "force-dynamic";

type Check = { title: string; desc: string; done: boolean | null; href: Route; evidence?: string | null; optional?: boolean };

export default async function SetupPage() {
  const { profile } = await requireAdmin();
  const { t, lang } = await getT();
  const c = workflowCopy(lang);
  const supabase = await createClient();
  const now = Date.now();
  const [sessions, recordings, faces, suspects, db, ml, mfa] = await Promise.all([
    // Join/filter before the limit so uploads or disabled cameras cannot hide
    // the one working camera further down a capped client-side list.
    supabase.from("camera_sessions").select("camera_id, last_heartbeat_at, cameras!inner(enabled)").eq("cameras.enabled", true).eq("auto_resume", true).gte("last_heartbeat_at", new Date(now - CAMERA_FRESH_MS).toISOString()).lte("last_heartbeat_at", new Date(now + 5_000).toISOString()).order("last_heartbeat_at", { ascending: false }).limit(1),
    supabase.from("recordings").select("id, camera_id, ended_at, cameras!inner(enabled)").eq("cameras.enabled", true).eq("capture_status", "ready").gte("ended_at", new Date(now - INGEST_FRESH_MS).toISOString()).lte("ended_at", new Date(now + 5_000).toISOString()).order("ended_at", { ascending: false }).limit(1),
    supabase.from("faces").select("detected_at").gte("detected_at", new Date(now - INGEST_FRESH_MS).toISOString()).order("detected_at", { ascending: false }).limit(1),
    supabase.from("suspects").select("id", { count: "exact", head: true }),
    probeDb(), probeMl(), readMfaOk(supabase as unknown as RpcCapableClient),
  ]);
  const active = (sessions.data ?? []).filter((session) => isFreshEvidence(session.last_heartbeat_at, CAMERA_FRESH_MS, now));
  const recent = (recordings.data ?? []).find((rec) => isFreshEvidence(rec.ended_at, INGEST_FRESH_MS, now));
  const checks: Check[] = [
    { title: c.cameraReady, desc: c.cameraHint, done: sessions.error || !mfa ? null : active.length > 0, href: "/live", evidence: active[0]?.last_heartbeat_at },
    { title: c.ingestReady, desc: c.ingestHint, done: recordings.error || !mfa ? null : Boolean(recent), href: "/playback", evidence: recent?.ended_at },
    { title: c.depsReady, desc: c.depsHint, done: db.ok && ml.ok, href: "/health" },
    { title: t("setup_s5_title"), desc: t("setup_s5_desc"), done: Boolean(profile.totp_enabled), href: "/settings" },
    { title: c.faceReady, desc: c.faceHint, done: faces.error || !mfa ? null : isFreshEvidence(faces.data?.[0]?.detected_at, INGEST_FRESH_MS, now), href: "/faces", evidence: faces.data?.[0]?.detected_at, optional: true },
    { title: t("setup_s3_title"), desc: c.watchlistOptional, done: suspects.error || !mfa ? null : (suspects.count ?? 0) > 0, href: "/suspects", optional: true },
  ];
  const required = checks.filter((check) => !check.optional);
  return <>
    <PageHeader title={t("setup_title")} subtitle={`${required.filter((check) => check.done).length} / ${required.length} ${t("setup_completed")}`} />
    <div className="max-w-2xl space-y-3">
      <div className="card text-sm text-text-soft space-y-2"><p>{c.setupIntro}</p><p className="text-xs text-text-muted">{c.checkedAt}: {formatDate(new Date(now).toISOString())}</p></div>
      {checks.some((check) => check.done === null) && <p role="alert" className="text-warning text-xs">{c.setupError}</p>}
      {checks.map((check) => <Link key={check.title} href={check.href} className="card flex items-center gap-4 hover:bg-text-muted/[0.02] transition">
        {check.done ? <CheckCircle className="w-6 h-6 text-success shrink-0" /> : check.done === null ? <AlertTriangle className="w-6 h-6 text-warning shrink-0" /> : <Circle className="w-6 h-6 text-text-faint shrink-0" />}
        <div className="flex-1 space-y-1"><div className="text-sm font-medium">{check.title}</div><p className="text-xs text-text-muted">{check.desc}</p>{!check.optional && <p className={`text-xs ${check.done ? "text-success" : "text-warning"}`}>{check.done === null ? c.unknown : check.done ? c.healthy : c.needsAttention}</p>}{check.evidence && <p className="text-xs text-text-muted">{c.lastSeen}: {formatDate(check.evidence)}</p>}</div>
        <ArrowRight className="w-4 h-4 text-accent shrink-0" />
      </Link>)}
      <div className="card text-xs text-text-soft space-y-3"><p>{c.playbackUnverified}</p>{recent && <a className="btn-primary btn-sm" href={`/playback/${recent.id}`}>{c.openRecent}</a>}<a href="/setup" className="btn-secondary btn-sm ml-2">{c.refresh}</a></div>
    </div>
  </>;
}
