import { PageHeader } from "@/components/ui/page-header";
import { LiveCameraView } from "./live-view";
import { LiveMatchFlash } from "./live-match-flash";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { unwrapCameraUrlForRuntime } from "@/lib/camera-crypto";
import { liveAllowedForCamera, loadLiveAllowed } from "@/lib/live-access";

function safeCameraUrl(stored: string): string | null {
  try {
    return unwrapCameraUrlForRuntime(stored);
  } catch {
    return null;
  }
}

export default async function LivePage() {
  const { user, profile } = await requireUser();
  const { t } = await getT();
  const supabase = await createClient();

  const isAdmin = profile.role === "admin";

  const { data: rawCameras } = await supabase
    .from("cameras")
    .select("id, name, url, cam_type, enabled")
    .order("name");

  // Live video needs an enabled camera and admin or a camera_permissions row
  // (the stream gateway's rule); lists stay default-allow. Same read as the
  // gateway, so the list can lock a camera up front instead of letting the
  // player hit a 403. This page lists disabled cameras too, so the verdict
  // includes `enabled` (liveAllowedForCamera) — otherwise a grant on a
  // disabled camera would count as watchable.
  const liveAllowed = await loadLiveAllowed(
    supabase,
    { userId: user.id, role: profile.role },
    (rawCameras ?? []).map((c) => c.id),
  );

  const cameras = (rawCameras ?? []).map((c) => ({
    ...c,
    url: isAdmin ? safeCameraUrl(c.url) : null,
    liveAllowed: liveAllowedForCamera(c, liveAllowed),
  }));

  return (
    <>
      <PageHeader title={t("nav_live")} subtitle={t("select_camera")} />
      {/* Only admins start / stop a capture (startCameraAction is admin-only);
          viewers attach to streams that are already running. */}
      <LiveCameraView cameras={cameras} canControl={isAdmin} />
      {isAdmin && <LiveMatchFlash />}
    </>
  );
}
