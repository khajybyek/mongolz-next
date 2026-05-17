import Link from "next/link";
import { Power, Clock, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { DeleteWithTotp } from "@/components/delete-with-totp";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import {
  addCameraAction,
  deleteCameraAction,
  toggleCameraAction,
  toggleConsentAction,
} from "./actions";
import { cn } from "@/lib/utils";
import { unwrapCameraUrlForRuntime } from "@/lib/camera-crypto";

function displayCameraUrl(stored: string): string {
  try {
    return unwrapCameraUrlForRuntime(stored);
  } catch {
    return "URL unavailable";
  }
}

export default async function CamerasPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: rawCameras } = await supabase
    .from("cameras")
    .select("*")
    .order("created_at", { ascending: false });

  const cameras = (rawCameras ?? []).map((c) => ({
    ...c,
    url: displayCameraUrl(c.url),
  }));

  return (
    <>
      <PageHeader title={t("manage_cameras")} subtitle={t("nav_cameras")} />

      <div className="card mb-6">
        <form action={addCameraAction} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input name="name" placeholder={t("camera_name")} required className="input" />
          <input name="url" placeholder={t("camera_url")} required className="input md:col-span-2" />
          <select name="cam_type" defaultValue="rtsp" className="input">
            <option value="rtsp">RTSP</option>
            <option value="http">HTTP</option>
            <option value="usb">USB</option>
            <option value="webcam">Webcam</option>
          </select>
          <button type="submit" className="btn-primary md:col-span-4">
            {t("add_camera")}
          </button>
        </form>
      </div>

      {!cameras.length ? (
        <Empty message={t("empty")} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cameras.map((c) => (
            <div key={c.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">{c.name}</span>
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
      )}
    </>
  );
}
