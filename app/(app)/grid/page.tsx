import Link from "next/link";
import { LayoutGrid, MonitorPlay } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { mlActiveCameras } from "@/lib/ml-client";
import { MultiCameraGrid, type GridCamera } from "./multi-camera-grid";

export const dynamic = "force-dynamic";

type HealthRow = {
  camera_id: string;
  status: string;
  last_seen: string | null;
  faces_1h: number | string;
};

const STATUSES = new Set(["healthy", "stale", "offline", "unknown"]);

export default async function GridPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const [{ data: rows }, { data: healthRows }, active] = await Promise.all([
    supabase
      .from("cameras")
      .select("id, name, cam_type, enabled")
      .eq("enabled", true)
      .order("name"),
    supabase.rpc("camera_health"),
    mlActiveCameras(),
  ]);

  const healthById = new Map<string, HealthRow>();
  for (const r of (healthRows ?? []) as HealthRow[]) healthById.set(r.camera_id, r);

  const cameras: GridCamera[] = (rows ?? []).map((c) => {
    const h = healthById.get(c.id);
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
          message={t("grid_no_cameras")}
          action={
            <Link href={"/cameras" as never} className="btn-primary btn-sm">
              {t("nav_cameras")}
            </Link>
          }
        />
      ) : (
        <MultiCameraGrid cameras={cameras} initialActive={initialActive} mlReachable={active !== null} />
      )}
    </>
  );
}
