import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getServerLang, getT } from "@/lib/i18n/server";
import { AIChat } from "./ai-chat";

export default async function AIPage() {
  await requireAdmin();
  const { t } = await getT();
  const lang = await getServerLang();

  return (
    <>
      <PageHeader title={t("nav_ai")} subtitle={t("ai_subtitle")} />
      <AIChat
        labels={{
          summary: t("ai_mode_summary"),
          anomaly: t("ai_mode_anomaly"),
          chat: t("ai_mode_chat"),
          placeholder: t("ai_placeholder"),
          running: t("ai_running"),
          run: t("ai_run"),
          chatPlaceholder: t("ai_chat_placeholder"),
          send: t("ai_send"),
          errorGeneric: t("ai_error_generic"),
          emptyChatHint: t("ai_empty_chat_hint"),
          emptyRunHint: t("ai_empty_run_hint"),
        }}
        lang={lang}
      />
    </>
  );
}
