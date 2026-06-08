import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { hasFreshReauth } from "@/lib/auth/step-up";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";
import { ReauthGate } from "@/components/reauth-gate";
import { FaceThumb } from "@/components/face-thumb";

export const dynamic = "force-dynamic";

const PAGE_LIMIT = 120;

export default async function FacesPage() {
  const { user } = await requireAdmin();
  const { t } = await getT();

  // Step-up reauth gate — /faces is the densest privacy surface in the
  // product (every detected face thumbnail across every recording), so
  // gate it behind a fresh TOTP even for an already-logged-in admin.
  if (!(await hasFreshReauth(user.id))) {
    return (
      <>
        <PageHeader
          title={t("faces_title")}
          subtitle={t("reauth_gate_subtitle")}
          icon={<Users className="w-5 h-5" />}
        />
        <ReauthGate />
      </>
    );
  }

  const supabase = await createClient();

  const { data: faces } = await supabase
    .from("faces")
    .select("id, filename, image_path, detected_at, camera_id, recording_id, cameras:cameras(name)")
    .order("detected_at", { ascending: false })
    .limit(PAGE_LIMIT);

  const rows = (faces ?? []) as Array<{
    id: string;
    filename: string;
    image_path: string;
    detected_at: string;
    camera_id: string | null;
    recording_id: string | null;
    cameras: { name: string } | { name: string }[] | null;
  }>;

  return (
    <>
      <PageHeader title={t("faces_title")} subtitle={`${rows.length} · ${t("faces_subtitle")}`} />

      {!rows.length ? (
        <Empty message={t("empty")} />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {rows.map((f) => {
            const cam = Array.isArray(f.cameras) ? f.cameras[0] : f.cameras;
            const href = f.recording_id ? `/playback/${f.recording_id}?face=${f.id}` : null;

            const inner = (
              <>
                <FaceThumb
                  faceId={f.id}
                  alt={f.filename}
                  className="aspect-square rounded mb-1.5"
                />
                <div className="text-[10px] text-text-muted truncate">
                  {formatDate(f.detected_at)}
                </div>
                {cam?.name && (
                  <div className="text-[10px] text-text-faint truncate" title={cam.name}>
                    {cam.name}
                  </div>
                )}
              </>
            );

            if (!href) {
              return (
                <div
                  key={f.id}
                  className="card p-1.5 opacity-60"
                  title={t("faces_no_recording")}
                >
                  {inner}
                </div>
              );
            }
            return (
              <a
                key={f.id}
                href={href}
                className="card p-1.5 group block transition hover:border-accent/40 hover:shadow-glow-soft focus-visible:ring-2 focus-visible:ring-accent/40 outline-none"
                title={t("faces_open_playback")}
              >
                {inner}
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}
