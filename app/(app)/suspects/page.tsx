import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { DeleteWithTotp } from "@/components/delete-with-totp";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";
import { addSuspectAction, deleteSuspectAction } from "./actions";

export default async function SuspectsPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: suspects } = await supabase
    .from("suspects")
    .select("id, name, image_path, notes, privacy_tier, created_at")
    .order("created_at", { ascending: false });

  // Storage signed URLs
  const items = await Promise.all(
    (suspects ?? []).map(async (s) => {
      const { data } = await supabase.storage
        .from("suspects")
        .createSignedUrl(s.image_path, 60 * 60);
      return { ...s, signedUrl: data?.signedUrl ?? null };
    })
  );

  return (
    <>
      <PageHeader title={t("manage_suspects")} subtitle={t("nav_suspects")} />

      <div className="card mb-6">
        <form action={addSuspectAction} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            name="name"
            placeholder={t("suspect_name")}
            required
            className="input"
          />
          <input
            name="photo"
            type="file"
            accept="image/*"
            required
            className="input file:bg-accent/15 file:text-accent file:border-0 file:rounded file:px-2 file:py-1 file:mr-2"
          />
          <select name="privacy_tier" defaultValue="standard" className="input">
            <option value="vip">VIP · хатуу хамгаалалт</option>
            <option value="standard">Standard · ердийн</option>
            <option value="relaxed">Relaxed · хөнгөн</option>
          </select>
          <button type="submit" className="btn-primary">
            {t("add_suspect")}
          </button>
        </form>
        <p className="text-xs text-text-muted mt-2">
          ArcFace embedding · ML service · privacy tier-аар mask хүч + reveal flow тохируулна
        </p>
      </div>

      {!items.length ? (
        <Empty message={t("empty")} />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((s) => (
            <div key={s.id} className="card overflow-hidden p-0">
              <div className="aspect-square bg-bg-tertiary relative">
                {s.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.signedUrl}
                    alt={s.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-text-muted">
                    no image
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm truncate">{s.name}</div>
                  <span
                    className={
                      s.privacy_tier === "vip"
                        ? "badge badge-warning"
                        : s.privacy_tier === "relaxed"
                        ? "badge badge-muted"
                        : "badge badge-accent"
                    }
                    title={`Privacy tier: ${s.privacy_tier ?? "standard"}`}
                  >
                    {s.privacy_tier ?? "standard"}
                  </span>
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  {formatDate(s.created_at)}
                </div>
                <div className="mt-3">
                  <DeleteWithTotp
                    id={s.id}
                    action={deleteSuspectAction}
                    confirmMessage={`${s.name} — ${t("delete_confirm")}`}
                    label={t("delete")}
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
