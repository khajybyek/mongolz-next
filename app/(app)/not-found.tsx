import Link from "next/link";
import { SearchX } from "lucide-react";
import { getT } from "@/lib/i18n/server";

export default async function AppNotFound() {
  const { t } = await getT();
  return (
    <div className="max-w-lg mx-auto mt-16 card space-y-4 text-center">
      <div className="w-12 h-12 rounded-2xl bg-text-muted/10 text-text-soft inline-flex items-center justify-center mx-auto">
        <SearchX className="w-6 h-6" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-text">{t("ui_not_found_title")}</h2>
        <p className="text-sm text-text-soft mt-1">{t("ui_not_found_desc")}</p>
      </div>
      <Link href="/dashboard" className="btn-primary inline-flex mx-auto">
        {t("ui_back_dashboard")}
      </Link>
    </div>
  );
}
