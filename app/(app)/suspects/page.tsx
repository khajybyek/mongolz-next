import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { DeleteWithTotp } from "@/components/delete-with-totp";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";
import { deleteSuspectAction } from "./actions";
import { AddSuspectForm } from "./add-suspect-form";

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

      <AddSuspectForm />

      {!items.length ? (
        <Empty message={t("empty")} />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((s) => (
            <div key={s.id} className="card overflow-hidden p-0 hover:border-accent/40 hover:shadow-glow-soft transition">
              <Link href={`/suspects/${s.id}` as never} className="block group">
                <div className="aspect-square bg-bg-tertiary relative">
                  {s.signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.signedUrl}
                      alt={s.name}
                      className="w-full h-full object-cover transition-transform group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-text-muted">
                      no image
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm truncate group-hover:text-accent transition">{s.name}</div>
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
                </div>
              </Link>
              <div className="px-3 pb-3">
                <DeleteWithTotp
                  id={s.id}
                  action={deleteSuspectAction}
                  confirmMessage={`${s.name} — ${t("delete_confirm")}`}
                  label={t("delete")}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
