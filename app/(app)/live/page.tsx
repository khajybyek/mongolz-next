import { PageHeader } from "@/components/ui/page-header";
import { LiveCameraView } from "./live-view";
import { LiveMatchFlash } from "./live-match-flash";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { unwrapCameraUrlForRuntime } from "@/lib/camera-crypto";

function safeCameraUrl(stored: string): string | null {
  try {
    return unwrapCameraUrlForRuntime(stored);
  } catch {
    return null;
  }
}

export default async function LivePage() {
  const { profile } = await requireUser();
  const { t } = await getT();
  const supabase = await createClient();

  const isAdmin = profile.role === "admin";

  const { data: rawCameras } = await supabase
    .from("cameras")
    .select("id, name, url, cam_type, enabled")
    .order("name");

  const cameras = (rawCameras ?? []).map((c) => ({
    ...c,
    url: isAdmin ? safeCameraUrl(c.url) : null,
  }));

  return (
    <>
      <PageHeader title={t("nav_live")} subtitle={t("select_camera")} />
      <LiveCameraView cameras={cameras} />
      {isAdmin && <LiveMatchFlash />}
    </>
  );
}
