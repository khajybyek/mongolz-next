import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { FaceThumb } from "@/components/face-thumb";
import {
  ArrowLeft,
  UserSearch,
  Crown,
  ShieldAlert,
  ShieldCheck,
  Cctv,
  Clock,
  Activity,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALERT_LIMIT = 100;

export default async function SuspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const { t } = await getT();
  const supabase = await createClient();

  const { data: suspect } = await supabase
    .from("suspects")
    .select("id, name, image_path, notes, privacy_tier, created_at")
    .eq("id", id)
    .single<{
      id: string;
      name: string;
      image_path: string;
      notes: string | null;
      privacy_tier: "vip" | "standard" | "relaxed" | null;
      created_at: string;
    }>();

  if (!suspect) notFound();

  // Photo
  const { data: photo } = await supabase.storage
    .from("suspects")
    .createSignedUrl(suspect.image_path, 60 * 60);
  const photoUrl = photo?.signedUrl ?? null;

  // Alerts table — the newest ALERT_LIMIT rows. The headline total and the
  // first sighting come from their own queries: deriving them from this
  // capped list reported "100 alerts" and a first-seen date inside the last
  // 100 for any frequent suspect. All three use the user-token client, so
  // RLS and the second-factor gate still decide what is visible.
  const [{ data: alertsData }, totalRes, firstRes] = await Promise.all([
    supabase
      .from("alerts")
      .select(
        "id, similarity, camera_id, camera_name, face_id, created_at, label, match_count",
      )
      .eq("suspect_id", id)
      .order("created_at", { ascending: false })
      .limit(ALERT_LIMIT),
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("suspect_id", id),
    supabase
      .from("alerts")
      .select("created_at")
      .eq("suspect_id", id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  type AlertRow = {
    id: string;
    similarity: number | null;
    camera_id: string | null;
    camera_name: string | null;
    face_id: string | null;
    created_at: string;
    label: string | null;
    match_count: number | null;
  };
  const alerts = (alertsData ?? []) as AlertRow[];

  // Lookup recording_id (deep link) + crop_sealed (badge) for the alerts'
  // face rows. The face row IS the alert's evidence — see below.
  const faceIds = alerts.map((a) => a.face_id).filter((x): x is string => !!x);
  const recordingByFace = new Map<string, string>();
  const sealedByFace = new Map<string, boolean>();
  if (faceIds.length > 0) {
    const { data: faceRows } = await supabase
      .from("faces")
      .select("id, recording_id, crop_sealed")
      .in("id", faceIds);
    for (const f of (faceRows ?? []) as Array<{
      id: string;
      recording_id: string | null;
      crop_sealed: boolean | null;
    }>) {
      if (f.recording_id) recordingByFace.set(f.id, f.recording_id);
      sealedByFace.set(f.id, !!f.crop_sealed);
    }
  }

  // ── Latest match preview ────────────────────────────────────────────────
  // This used to sign `alerts.screenshot_path` against the `alert-screenshots`
  // bucket and always got nothing back: the recording pipeline writes only the
  // sealed crop `<faces.image_path>.enc` in the `faces` bucket, so the path on
  // the alert row referenced an object that does not exist (measured: 13
  // alerts, 1 path, 0 objects in that bucket — it has never received a write).
  // The evidence is the face row, so the crop is rendered through
  // /api/faces/[id]/secure-crop, which decrypts the sealed crop under this
  // admin's reveal_level and streams legacy plaintext crops.
  //
  // An alert that genuinely carries an `alert-screenshots` object (uploaded by
  // something other than the pipeline) still renders from it; that path is
  // only taken when the alert has no face row to point at.
  const latest = alerts[0] ?? null;
  let latestScreenshotUrl: string | null = null;
  if (latest && !latest.face_id) {
    const { data: latestAlertRow } = await supabase
      .from("alerts")
      .select("screenshot_path")
      .eq("id", latest.id)
      .single<{ screenshot_path: string | null }>();
    if (latestAlertRow?.screenshot_path) {
      const { data: sig } = await supabase.storage
        .from("alert-screenshots")
        .createSignedUrl(latestAlertRow.screenshot_path, 60 * 30);
      latestScreenshotUrl = sig?.signedUrl ?? null;
    }
  }

  // Aggregate stats. An unreadable count is "—", never 0 (lib/metrics.ts).
  const totalAlerts: number | null = totalRes.error ? null : (totalRes.count ?? null);
  // Camera / TP / FP / per-camera figures are computed from the capped list;
  // when more alerts exist than it holds, the UI says so.
  const sampled = totalAlerts == null ? alerts.length >= ALERT_LIMIT : totalAlerts > alerts.length;
  const sampleNote = sampled ? t("susp_latest_sample").replace("{n}", String(alerts.length)) : null;
  const uniqueCameras = new Set(alerts.map((a) => a.camera_id).filter(Boolean)).size;
  const firstSeen = firstRes.error
    ? null
    : ((firstRes.data as { created_at: string } | null)?.created_at ?? null);
  const lastSeen = alerts.length ? alerts[0].created_at : null;
  const tpCount = alerts.filter((a) => a.label === "true_positive").length;
  const fpCount = alerts.filter((a) => a.label === "false_positive").length;

  // Per-camera bucket counts for the trail strip
  const perCamera = new Map<string, { name: string; count: number; lastSeen: string }>();
  for (const a of alerts) {
    if (!a.camera_id) continue;
    const cur = perCamera.get(a.camera_id);
    if (cur) {
      cur.count += 1;
      if (a.created_at > cur.lastSeen) cur.lastSeen = a.created_at;
    } else {
      perCamera.set(a.camera_id, { name: a.camera_name ?? "—", count: 1, lastSeen: a.created_at });
    }
  }
  const cameraBuckets = Array.from(perCamera.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count);

  const tier = suspect.privacy_tier ?? "standard";

  return (
    <>
      <Link
        href="/suspects"
        className="btn-ghost btn-sm mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        {t("nav_suspects")}
      </Link>

      <PageHeader title={suspect.name} icon={<UserSearch className="w-5 h-5" />} />

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Left column: photo + tier + meta */}
        <aside className="space-y-4">
          <div className="card p-0 overflow-hidden">
            <div className="aspect-square bg-bg-tertiary">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt={suspect.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-text-muted">
                  {t("suspect_no_image")}
                </div>
              )}
            </div>
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                {tier === "vip" ? (
                  <Crown className="w-4 h-4 text-warning" />
                ) : tier === "relaxed" ? (
                  <ShieldCheck className="w-4 h-4 text-text-faint" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-accent" />
                )}
                <span
                  className={
                    "badge " +
                    (tier === "vip" ? "badge-warning" : tier === "relaxed" ? "badge-muted" : "badge-accent")
                  }
                >
                  {tier}
                </span>
              </div>
              <div className="text-xs text-text-muted">
                {t("rec_started")}: {formatDate(suspect.created_at)}
              </div>
              {suspect.notes && (
                <p className="text-xs text-text-soft leading-relaxed pt-2 border-t border-border">
                  {suspect.notes}
                </p>
              )}
            </div>
          </div>
        </aside>

        <div className="space-y-4 min-w-0">
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat icon={<Activity className="w-4 h-4 text-accent" />} label={t("susp_total_alerts")} value={totalAlerts ?? "—"} />
            <Stat icon={<Cctv className="w-4 h-4 text-accent" />} label={t("susp_cameras")} value={uniqueCameras} note={sampleNote} />
            <Stat icon={<Clock className="w-4 h-4 text-accent" />} label={t("susp_first_seen")} value={firstSeen ? formatDate(firstSeen) : "—"} small />
            <Stat icon={<Clock className="w-4 h-4 text-accent" />} label={t("susp_last_seen")} value={lastSeen ? formatDate(lastSeen) : "—"} small />
          </div>

          {/* Latest match preview */}
          {latest && (
            <div className="card flex gap-3">
              <div className="w-32 h-24 shrink-0 bg-bg-tertiary rounded overflow-hidden">
                {latest.face_id ? (
                  // The alert's own evidence, decrypted on demand by
                  // /api/faces/[id]/secure-crop (sealed or legacy plaintext).
                  <FaceThumb
                    faceId={latest.face_id}
                    sealed={sealedByFace.get(latest.face_id) ?? false}
                    className="w-full h-full"
                  />
                ) : latestScreenshotUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={latestScreenshotUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-text-faint">
                    {t("alert_no_screenshot")}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="section-title mb-1">
                  {t("susp_latest_match")}
                </h3>
                <div className="text-sm font-semibold truncate">{latest.camera_name ?? "—"}</div>
                <div className="text-xs text-text-muted">{formatDate(latest.created_at)}</div>
                <div className="text-xs mt-1">
                  <span className="font-mono">
                    {latest.similarity != null ? `${(latest.similarity * 100).toFixed(0)}%` : "—"}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  {latest.face_id && recordingByFace.has(latest.face_id) ? (
                    <Link
                      href={`/playback/${recordingByFace.get(latest.face_id)}?face=${latest.face_id}`}
                      className="text-accent hover:underline"
                    >
                      → {t("susp_open_playback")}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* Per-camera bucket trail */}
          {cameraBuckets.length > 0 && (
            <div className="card">
              <h3 className="section-title mb-2 flex items-center gap-1">
                <Cctv className="w-3.5 h-3.5" /> {t("susp_trail")}
              </h3>
              {sampleNote && <p className="text-2xs text-text-faint mb-2">{sampleNote}</p>}
              <div className="space-y-2">
                {cameraBuckets.map((c) => {
                  const max = cameraBuckets[0].count;
                  return (
                    <div key={c.id} className="flex items-center gap-2 text-xs">
                      <span className="w-32 truncate text-text-soft">{c.name}</span>
                      <div className="flex-1 h-2 rounded bg-bg-tertiary relative overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-accent/60 rounded"
                          style={{ width: `${(c.count / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-8 text-right tabular-nums text-text">{c.count}</span>
                      <span className="text-text-faint text-[10px] w-20 text-right">
                        {formatDate(c.lastSeen)}
                      </span>
                    </div>
                  );
                })}
              </div>
              {(tpCount > 0 || fpCount > 0) && (
                <div className="mt-3 pt-3 border-t border-border flex items-center gap-3 text-xs">
                  <span className="text-success-ring">TP {tpCount}</span>
                  <span className="text-danger-ring">FP {fpCount}</span>
                  <span className="text-text-muted">
                    precision {tpCount + fpCount > 0 ? `${((tpCount / (tpCount + fpCount)) * 100).toFixed(0)}%` : "—"}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Alert table */}
          {alerts.length === 0 ? (
            <Empty message={t("susp_no_alerts")} />
          ) : (
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bg-tertiary border-b border-border">
                  <tr className="text-left text-xs text-text-soft">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">{t("susp_when")}</th>
                    <th className="px-3 py-2">{t("susp_camera")}</th>
                    <th className="px-3 py-2 text-right">{t("susp_score")}</th>
                    <th className="px-3 py-2">{t("susp_label")}</th>
                    <th className="px-3 py-2 text-right">{t("susp_action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a, i) => {
                    const rid = a.face_id ? recordingByFace.get(a.face_id) : null;
                    return (
                      <tr key={a.id} className="border-b border-border last:border-0 hover:bg-text-muted/[0.02]">
                        <td className="px-3 py-2 text-text-faint tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2 text-text-soft text-xs">{formatDate(a.created_at)}</td>
                        <td className="px-3 py-2 truncate max-w-[200px]">{a.camera_name ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-mono text-xs">
                          {a.similarity != null ? `${(a.similarity * 100).toFixed(0)}%` : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {a.label === "true_positive" ? (
                            <span className="badge badge-accent">TP</span>
                          ) : a.label === "false_positive" ? (
                            <span className="badge badge-danger">FP</span>
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-xs">
                          {rid ? (
                            <Link
                              href={`/playback/${rid}?face=${a.face_id}`}
                              className="text-accent hover:underline"
                            >
                              {t("susp_view")}
                            </Link>
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  small,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  small?: boolean;
  note?: string | null;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-2xs uppercase tracking-wider text-text-soft">{label}</span>
      </div>
      <div className={small ? "text-sm font-medium text-text" : "text-2xl font-semibold text-text tabular-nums"}>
        {value}
      </div>
      {note && <div className="text-2xs text-text-faint mt-0.5">{note}</div>}
    </div>
  );
}
