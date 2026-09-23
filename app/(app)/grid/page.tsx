import Link from "next/link";
import { redirect } from "next/navigation";
import { LayoutGrid, MonitorPlay } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { mlActiveCameras } from "@/lib/ml-client";
import { restartInfoFor } from "@/lib/camera-restarts";
import { MultiCameraGrid, type GridCamera } from "./multi-camera-grid";

export const dynamic = "force-dynamic";

/**
 * camera_health() row. `status` answers "is this camera sending frames"
 * (derived from camera_sessions.last_heartbeat_at, stamped by the ML capture
 * loop); `last_seen` / `faces_1h` / `detection_status` answer "has it seen
 * anyone". The tile shows both, so a live camera watching an empty corridor
 * reads as healthy with 0 faces instead of "offline" — which is what the dot
 * used to claim after 30 quiet minutes.
 *
 * The extra columns are typed here rather than taken from the generated
 * Database types so this page keeps compiling until `npm run gen:types` is
 * re-run after the migration.
 */
type HealthRow = {
  camera_id: string;
  status: string;
  last_seen: string | null;
  faces_1h: number | string;
  capturing?: boolean | null;
  last_heartbeat?: string | null;
  detection_status?: string | null;
};

const STATUSES = new Set(["healthy", "stale", "offline", "unknown"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * NVR grid for every operator. Admins start / stop cameras; viewers watch
 * whatever is running (the camera list + camera_health + the HLS proxy are
 * all filtered per user_can_see_camera, so a viewer only ever sees cameras
 * they are permitted to see). Auditors are confined to /audit.
 */
export default async function GridPage({
  searchParams,
}: {
  searchParams?: Promise<{ focus?: string | string[] }>;
}) {
  const { profile } = await requireUser();
  // The middleware already confines auditors to /audit*; belt and braces.
  if (profile.role === "auditor") redirect("/audit");
  const canControl = profile.role === "admin";

  const { t } = await getT();
  const supabase = await createClient();

  // `?focus=<camera uuid>` deep-links from /cameras (LIVE badge). Anything
  // that is not a UUID is ignored rather than passed to the client.
  const sp = (await searchParams) ?? {};
  const rawFocus = Array.isArray(sp.focus) ? sp.focus[0] : sp.focus;
  const initialFocus = rawFocus && UUID_RE.test(rawFocus) ? rawFocus.toLowerCase() : null;

  const [{ data: rows }, health, active] = await Promise.all([
    supabase
      .from("cameras")
      .select("id, name, cam_type, enabled")
      .eq("enabled", true)
      .order("name"),
    supabase.rpc("camera_health"),
    mlActiveCameras(),
  ]);

  // camera_health is operator-aware (admin + viewer, rows filtered per
  // user_can_see_camera). If the RPC errors the tiles simply show
  // status=unknown instead of failing the whole page.
  const healthById = new Map<string, HealthRow>();
  if (!health.error) {
    for (const r of (health.data ?? []) as HealthRow[]) healthById.set(r.camera_id, r);
  }

  const cameras: GridCamera[] = (rows ?? []).map((c) => {
    const h = healthById.get(c.id);
    // Dot = liveness (frames arriving), from the capture loop's heartbeat.
    // The "last seen · N/1h" line under it is the detection side, so the two
    // states the dot used to blur together are now both visible on the tile:
    //   healthy + 0/1h → the camera is up, it has just seen nobody
    //   stale/offline  → it is not sending frames (a real fault)
    //   unknown        → nobody is capturing it, so nothing is known
    const status = h && STATUSES.has(h.status) ? (h.status as GridCamera["status"]) : "unknown";
    return {
      id: c.id,
      name: c.name,
      cam_type: c.cam_type,
      status,
      last_seen: h?.last_seen ?? null,
      faces_1h: Number(h?.faces_1h ?? 0),
    };
  });

  const enabledIds = new Set(cameras.map((c) => c.id));
  const initialActive = (active ?? []).map((a) => a.camera_id).filter((id) => enabledIds.has(id));

  return (
    <>
      <PageHeader
        title={t("grid_title")}
        subtitle={`${cameras.length} ${t("grid_active_cameras")} · ${initialActive.length} ${t("grid_streaming")}`}
        icon={<LayoutGrid className="w-5 h-5" />}
        actions={
          <Link href={"/wall" as never} className="btn-secondary btn-sm">
            <MonitorPlay className="w-3.5 h-3.5" />
            {t("grid_open_wall")}
          </Link>
        }
      />
      {cameras.length === 0 ? (
        <Empty
          message={canControl ? t("grid_no_cameras") : t("grid_no_cameras_viewer")}
          action={
            canControl ? (
              <Link href={"/cameras" as never} className="btn-primary btn-sm">
                {t("nav_cameras")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <MultiCameraGrid
          cameras={cameras}
          initialActive={initialActive}
          mlReachable={active !== null}
          initialRestarts={restartInfoFor(active ?? [], new Set(initialActive))}
          initialFocus={initialFocus}
          canControl={canControl}
        />
      )}
    </>
  );
}
