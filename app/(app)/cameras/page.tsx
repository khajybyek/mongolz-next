import Link from "next/link";
import { Power, PowerOff, Clock, Users, Lock, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { DeleteWithTotp } from "@/components/delete-with-totp";
import { CameraDialog } from "@/components/camera-edit-dialog";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { mlActiveCameras } from "@/lib/ml-client";
import {
  deleteCameraAction,
  toggleCameraAction,
  toggleConsentAction,
} from "./actions";
import { cn, formatDate } from "@/lib/utils";
import { unwrapCameraUrlForRuntime } from "@/lib/camera-crypto";
import { StepUpForm } from "@/components/step-up-form";
import {
  liveAccessSummary,
  restrictedCameraIds,
  summarizeLiveGrants,
  type LiveAccessState,
} from "@/lib/live-access";

/** Live-access badge tone + icon: a read failure or a disabled camera must not look routine. */
const LIVE_BADGE: Record<LiveAccessState, { variant: "warning" | "muted"; Icon: typeof Users }> = {
  disabled: { variant: "muted", Icon: PowerOff },
  unknown: { variant: "warning", Icon: AlertTriangle },
  admins_only: { variant: "warning", Icon: Lock },
  users: { variant: "muted", Icon: Users },
};

function displayCameraUrl(stored: string): string {
  try {
    return unwrapCameraUrlForRuntime(stored);
  } catch {
    return "URL unavailable";
  }
}

type HealthStatus = "healthy" | "stale" | "offline" | "unknown";
type HealthRow = {
  camera_id: string;
  /** Liveness since 20260909111000: are frames arriving, not "was a face seen". */
  status: HealthStatus;
  last_seen: string | null;
  faces_24h: number;
  faces_1h: number;
  /** Newest heartbeat from the capture loop; null when nothing is capturing. */
  last_heartbeat?: string | null;
  capturing?: boolean | null;
  detection_status?: string | null;
};

/** Liveness status → translation key (the pill and its tooltip share one map). */
function cameraStatusKey(status: string | null | undefined) {
  switch (status) {
    case "healthy":
      return "cam_status_healthy" as const;
    case "stale":
      return "cam_status_stale" as const;
    case "offline":
      return "cam_status_offline" as const;
    default:
      return "cam_status_unknown" as const;
  }
}

/**
 * Live grants per camera, counted the way the stream gateway honours them
 * (distinct viewers; lib/live-access.ts), plus which cameras have any
 * camera_permissions row at all — that, not the live count, decides whether
 * lists / health / playback are still open to every operator. Read with the
 * service client after requireAdmin(), exactly as /cameras/<id>/permissions
 * reads them, so the summary here and the list behind the link always agree.
 * `null` = the grants could not be read — the badge then says "unknown",
 * never "admins only".
 */
async function loadLiveGrantCounts(): Promise<{ counts: Map<string, number>; restricted: Set<string> } | null> {
  try {
    const svc = createServiceClient();
    const { data: grants, error } = await svc.from("camera_permissions").select("camera_id, user_id");
    if (error) return null;
    const rows = grants ?? [];
    const restricted = restrictedCameraIds(rows);
    const userIds = [...new Set(rows.map((g) => g.user_id))];
    if (userIds.length === 0) return { counts: new Map(), restricted };
    const { data: profiles, error: profErr } = await svc.from("profiles").select("id, role").in("id", userIds);
    const roleByUser = profErr ? null : new Map((profiles ?? []).map((p) => [p.id, p.role as string]));
    return { counts: summarizeLiveGrants(rows, roleByUser), restricted };
  } catch {
    return null;
  }
}

export default async function CamerasPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const [{ data: rawCameras }, { data: healthRows }, active, liveGrants] = await Promise.all([
    supabase.from("cameras").select("*").order("created_at", { ascending: false }),
    supabase.rpc("camera_health"),
    mlActiveCameras(),
    loadLiveGrantCounts(),
  ]);

  const healthById = new Map<string, HealthRow>();
  for (const r of (healthRows ?? []) as HealthRow[]) {
    healthById.set(r.camera_id, { ...r, faces_24h: Number(r.faces_24h), faces_1h: Number(r.faces_1h) });
  }

  // `null` = ML unreachable → no camera is marked LIVE (nothing else changes;
  // the page must not surface ML outages, /grid already does).
  const streamingIds = new Set((active ?? []).map((a) => a.camera_id));

  const cameras = (rawCameras ?? []).map((c) => {
    // A disabled camera is refused to every role at the gateway, so it says
    // "camera disabled" rather than "admins only".
    const live = liveAccessSummary(
      liveGrants === null ? null : (liveGrants.counts.get(c.id) ?? 0),
      liveGrants?.restricted.has(c.id) ?? false,
      t,
      c.enabled,
    );
    return {
      ...c,
      url: displayCameraUrl(c.url),
      health: healthById.get(c.id) ?? null,
      streaming: c.enabled && streamingIds.has(c.id),
      live,
      liveBadge: LIVE_BADGE[live.state],
    };
  });

  const healthSummary = {
    healthy: cameras.filter((c) => c.health?.status === "healthy").length,
    stale: cameras.filter((c) => c.health?.status === "stale").length,
    offline: cameras.filter((c) => c.health?.status === "offline").length,
    unknown: cameras.filter((c) => !c.health || c.health.status === "unknown").length,
  };

  return (
    <>
      <PageHeader
        title={t("manage_cameras")}
        subtitle={t("nav_cameras")}
        actions={<CameraDialog mode="add" />}
      />

      {!cameras.length ? (
        <Empty message={t("empty")} />
      ) : (
        <>
          {/* Fleet health summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-xs">
            <HealthPill status="healthy" count={healthSummary.healthy} label={t("cam_status_healthy")} />
            <HealthPill status="stale" count={healthSummary.stale} label={t("cam_status_stale")} />
            <HealthPill status="offline" count={healthSummary.offline} label={t("cam_status_offline")} />
            <HealthPill status="unknown" count={healthSummary.unknown} label={t("cam_status_unknown")} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cameras.map((c) => (
            <div key={c.id} className="card">
              {/* Phones: the five action buttons get their own row above the
                  content, which then uses the full card width (beside it the
                  content column shrank to ~105px). Side by side from sm up. */}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold">{c.name}</span>
                    {c.streaming && (
                      <Link
                        href={`/grid?focus=${c.id}` as never}
                        title={t("cam_live_open_grid")}
                        className="inline-flex hover:opacity-80 transition-opacity"
                      >
                        <Badge variant="danger" dot>
                          {t("grid_live")}
                        </Badge>
                      </Link>
                    )}
                    {/* Liveness pill: since migration 20260909111000 `status`
                        means "frames are arriving" (heartbeat), not "a face was
                        detected recently". Detection age is a separate fact and
                        is shown as its own line in the tooltip. */}
                    {c.health && (
                      <span
                        className={cn(
                          "badge inline-flex items-center gap-1",
                          c.health.status === "healthy"
                            ? "bg-success/15 text-success"
                            : c.health.status === "stale"
                              ? "bg-warning/15 text-warning"
                              : c.health.status === "offline"
                                ? "bg-danger/15 text-danger"
                                : "bg-text-muted/10 text-text-muted",
                        )}
                        title={[
                          `${t("cam_health_liveness")}: ${t(cameraStatusKey(c.health.status))}`,
                          c.health.last_heartbeat
                            ? `${t("cam_health_last_frame")}: ${formatDate(c.health.last_heartbeat)}`
                            : c.health.capturing
                              ? t("cam_health_no_frame_yet")
                              : t("cam_health_not_capturing"),
                          c.health.last_seen
                            ? `${t("cam_health_last_face")}: ${formatDate(c.health.last_seen)}`
                            : `${t("cam_health_last_face")}: —`,
                        ].join(" · ")}
                      >
                        <span
                          className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            c.health.status === "healthy"
                              ? "bg-success animate-pulse"
                              : c.health.status === "stale"
                                ? "bg-warning"
                                : c.health.status === "offline"
                                  ? "bg-danger"
                                  : "bg-text-muted",
                          )}
                        />
                        {t(cameraStatusKey(c.health.status))}
                      </span>
                    )}
                    <span
                      className={cn(
                        "badge",
                        c.enabled
                          ? "bg-success/15 text-success"
                          : "bg-text-muted/5 text-text-muted"
                      )}
                    >
                      {c.enabled ? t("enabled") : t("disabled")}
                    </span>
                    {c.cam_type === "demo" ? (
                      <Badge variant="muted" title={t("cam_badge_demo_title")}>
                        {t("cam_badge_demo")}
                      </Badge>
                    ) : (
                      <span className="badge bg-bg-tertiary text-text-soft">
                        {c.cam_type.toUpperCase()}
                      </span>
                    )}
                    {c.consent_required && (
                      <span
                        className="badge bg-warning/15 text-warning"
                        title={t("consent_badge")}
                      >
                        {t("consent_badge")}
                      </span>
                    )}
                    {/* Who may watch live: lists / health / playback are
                        default-allow, live video needs a grant — without one
                        it is admin-only, which nobody could tell before. */}
                    <Link
                      href={`/cameras/${c.id}/permissions` as never}
                      title={c.live.title}
                      aria-label={`${c.live.label} — ${t("permissions")}`}
                      className="inline-flex hover:opacity-80 transition-opacity"
                    >
                      <Badge variant={c.liveBadge.variant}>
                        <c.liveBadge.Icon className="w-3 h-3" aria-hidden />
                        {c.live.label}
                      </Badge>
                    </Link>
                  </div>
                  {c.health && c.health.last_seen && (
                    <div className="text-[10px] text-text-faint mb-1">
                      {t("cam_last_seen")}: {formatDate(c.health.last_seen)} ·
                      {" "}{c.health.faces_24h} / 24h · {c.health.faces_1h} / 1h
                    </div>
                  )}
                  <code className="text-xs text-text-muted break-all">{c.url}</code>
                  <StepUpForm action={toggleConsentAction} className="mt-2">
                    <input type="hidden" name="id" value={c.id} />
                    <input
                      type="hidden"
                      name="required"
                      value={String(!c.consent_required)}
                    />
                    <button
                      type="submit"
                      className="btn-ghost btn-sm"
                    >
                      {c.consent_required ? t("consent_on") : t("consent_off")}
                    </button>
                  </StepUpForm>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                  <Link
                    href={`/cameras/${c.id}/schedule` as never}
                    className="btn-icon"
                    title={t("schedule")}
                  >
                    <Clock className="w-3.5 h-3.5" />
                  </Link>
                  <Link
                    href={`/cameras/${c.id}/permissions` as never}
                    className="btn-icon"
                    title={t("permissions")}
                  >
                    <Users className="w-3.5 h-3.5" />
                  </Link>
                  <CameraDialog
                    mode="edit"
                    camera={{ id: c.id, name: c.name, url: c.url, cam_type: c.cam_type }}
                  />
                  <StepUpForm action={toggleCameraAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="enabled" value={String(!c.enabled)} />
                    <button type="submit" className="btn-icon" title={t("cam_toggle_tip")}>
                      <Power className="w-3.5 h-3.5" />
                    </button>
                  </StepUpForm>
                  <DeleteWithTotp
                    id={c.id}
                    action={deleteCameraAction}
                    confirmMessage={`${c.name} — ${t("delete_confirm")}`}
                    iconOnly
                  />
                </div>
              </div>
            </div>
          ))}
          </div>
        </>
      )}
    </>
  );
}

function HealthPill({
  status,
  count,
  label,
}: {
  status: HealthStatus;
  count: number;
  label: string;
}) {
  const tone =
    status === "healthy"
      ? "border-success/30 bg-success/5"
      : status === "stale"
        ? "border-warning/30 bg-warning/5"
        : status === "offline"
          ? "border-danger/30 bg-danger/5"
          : "border-border";
  const dot =
    status === "healthy"
      ? "bg-success"
      : status === "stale"
        ? "bg-warning"
        : status === "offline"
          ? "bg-danger"
          : "bg-text-muted";
  return (
    <div className={cn("card border p-2 flex items-center gap-2", tone)}>
      <span className={cn("w-2 h-2 rounded-full shrink-0", dot)} />
      <span className="flex-1 truncate text-text-soft">{label}</span>
      <span className="font-semibold tabular-nums">{count}</span>
    </div>
  );
}
