import Link from "next/link";
import { Power, Clock, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { DeleteWithTotp } from "@/components/delete-with-totp";
import { CameraDialog } from "@/components/camera-edit-dialog";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import {
  deleteCameraAction,
  toggleCameraAction,
  toggleConsentAction,
} from "./actions";
import { cn, formatDate } from "@/lib/utils";
import { unwrapCameraUrlForRuntime } from "@/lib/camera-crypto";

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
  status: HealthStatus;
  last_seen: string | null;
  faces_24h: number;
  faces_1h: number;
};

export default async function CamerasPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const [{ data: rawCameras }, { data: healthRows }] = await Promise.all([
    supabase.from("cameras").select("*").order("created_at", { ascending: false }),
    supabase.rpc("camera_health"),
  ]);

  const healthById = new Map<string, HealthRow>();
  for (const r of (healthRows ?? []) as HealthRow[]) {
    healthById.set(r.camera_id, { ...r, faces_24h: Number(r.faces_24h), faces_1h: Number(r.faces_1h) });
  }

  const cameras = (rawCameras ?? []).map((c) => ({
    ...c,
    url: displayCameraUrl(c.url),
    health: healthById.get(c.id) ?? null,
  }));

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
          <div className="grid grid-cols-4 gap-2 mb-4 text-xs">
            <HealthPill status="healthy" count={healthSummary.healthy} label={t("cam_status_healthy")} />
            <HealthPill status="stale" count={healthSummary.stale} label={t("cam_status_stale")} />
            <HealthPill status="offline" count={healthSummary.offline} label={t("cam_status_offline")} />
            <HealthPill status="unknown" count={healthSummary.unknown} label={t("cam_status_unknown")} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cameras.map((c) => (
            <div key={c.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold">{c.name}</span>
                    {/* Health status pill — shows freshness of last face detection */}
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
                        title={
                          c.health.last_seen
                            ? `Last face: ${formatDate(c.health.last_seen)}`
                            : t("cam_status_unknown")
                        }
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
                        {c.health.status}
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
                      {c.enabled ? "ON" : "OFF"}
                    </span>
                    <span className="badge bg-bg-tertiary text-text-soft">
                      {c.cam_type.toUpperCase()}
                    </span>
                    {c.consent_required && (
                      <span
                        className="badge bg-warning/15 text-warning"
                        title={t("consent_badge")}
                      >
                        {t("consent_badge")}
                      </span>
                    )}
                  </div>
                  {c.health && c.health.last_seen && (
                    <div className="text-[10px] text-text-faint mb-1">
                      {t("cam_last_seen")}: {formatDate(c.health.last_seen)} ·
                      {" "}{c.health.faces_24h} / 24h · {c.health.faces_1h} / 1h
                    </div>
                  )}
                  <code className="text-xs text-text-muted break-all">{c.url}</code>
                  <form action={toggleConsentAction} className="mt-2">
                    <input type="hidden" name="id" value={c.id} />
                    <input
                      type="hidden"
                      name="required"
                      value={String(!c.consent_required)}
                    />
                    <button
                      type="submit"
                      className="text-[10px] uppercase tracking-wide text-text-muted hover:text-warning transition"
                    >
                      {c.consent_required ? t("consent_on") : t("consent_off")}
                    </button>
                  </form>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Link
                    href={`/cameras/${c.id}/schedule` as never}
                    className="btn-ghost text-xs p-2"
                    title={t("schedule")}
                  >
                    <Clock className="w-3.5 h-3.5" />
                  </Link>
                  <Link
                    href={`/cameras/${c.id}/permissions` as never}
                    className="btn-ghost text-xs p-2"
                    title={t("permissions")}
                  >
                    <Users className="w-3.5 h-3.5" />
                  </Link>
                  <CameraDialog
                    mode="edit"
                    camera={{ id: c.id, name: c.name, url: c.url, cam_type: c.cam_type }}
                  />
                  <form action={toggleCameraAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="enabled" value={String(!c.enabled)} />
                    <button type="submit" className="btn-ghost text-xs p-2" title="Toggle">
                      <Power className="w-3.5 h-3.5" />
                    </button>
                  </form>
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
