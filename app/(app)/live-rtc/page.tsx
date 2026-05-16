import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { LiveRtcView } from "./live-rtc-view";

export default async function LiveRtcPage() {
  await requireAdmin();
  const { t } = await getT();

  return (
    <>
      <PageHeader
        title={t("live_rtc_title")}
        subtitle={t("live_rtc_subtitle")}
      />
      <LiveRtcView
        labels={{
          start: t("start"),
          stop: t("stop"),
          status: t("live_rtc_status"),
          latency: t("live_rtc_latency"),
          jitter: t("live_rtc_jitter"),
          fps: t("live_rtc_fps"),
          bitrate: t("live_rtc_bitrate"),
          packetsLost: t("live_rtc_packets_lost"),
        }}
      />
    </>
  );
}
