import { Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
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
    .select("id, name, image_path, notes, created_at")
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
        <form action={addSuspectAction} className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
          <button type="submit" className="btn-primary">
            {t("add_suspect")}
          </button>
        </form>
        <p className="text-xs text-neutral-500 mt-2">
          Зураг upload-ийн дараа Python ML service ArcFace embedding тооцоолж DB-д хадгална.
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
                  <div className="w-full h-full flex items-center justify-center text-xs text-neutral-500">
                    no image
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="font-medium text-sm truncate">{s.name}</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {formatDate(s.created_at)}
                </div>
                <form action={deleteSuspectAction} className="mt-3">
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className="btn-danger w-full text-xs">
                    <Trash2 className="w-3.5 h-3.5" />
                    {t("delete")}
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
