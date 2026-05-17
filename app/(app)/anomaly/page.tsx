import { PageHeader } from "@/components/ui/page-header";
import { TrendingUp, AlertTriangle, Check, AlertCircle, Cctv } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { Empty } from "@/components/ui/empty";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Row = {
  camera_id: string;
  camera_name: string | null;
  bucket_start: string;
  observed: number;
  baseline_median: number;
  baseline_mad: number;
  z_score: number;
};

export default async function AnomalyPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("camera_anomaly_scores", {
    p_window_hours: 24,
    p_baseline_days: 28,
  });
  const rows = ((data ?? []) as Row[]).map((r) => ({ ...r, observed: Number(r.observed) }));

  // Group by camera: pick the worst |z| in the recent window
  const byCamera = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.camera_id;
    const arr = byCamera.get(k) ?? [];
    arr.push(r);
    byCamera.set(k, arr);
  }
  const summary = Array.from(byCamera.entries()).map(([camera_id, items]) => {
    const sorted = [...items].sort((a, b) => Math.abs(b.z_score) - Math.abs(a.z_score));
    return {
      camera_id,
      camera_name: items[0].camera_name ?? "—",
      worst: sorted[0],
      latest: items.reduce((a, b) => (a.bucket_start > b.bucket_start ? a : b)),
      buckets: items.sort((a, b) => a.bucket_start.localeCompare(b.bucket_start)),
    };
  }).sort((a, b) => Math.abs(b.worst.z_score) - Math.abs(a.worst.z_score));

  return (
    <>
      <PageHeader
        title={t("anomaly_title")}
        subtitle={t("anomaly_subtitle")}
        icon={<TrendingUp className="w-5 h-5" />}
      />

      {error ? (
        <div className="card border-danger/40 bg-danger-soft p-3 text-sm text-danger-ring">
          {error.message}
        </div>
      ) : summary.length === 0 ? (
        <Empty message={t("anomaly_none")} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4 text-xs">
            <Legend status="ok" label={t("anomaly_score_legend").split(" / ")[0]} />
            <Legend status="warn" label={t("anomaly_score_legend").split(" / ")[1]} />
            <Legend status="alert" label={t("anomaly_score_legend").split(" / ")[2]} />
          </div>

          <div className="space-y-3">
            {summary.map((s) => {
              const z = s.worst.z_score;
              const sev = severity(z);
              return (
                <div key={s.camera_id} className={"card border " + ringClass(sev)}>
                  <div className="flex items-start gap-3">
                    <div className={"shrink-0 w-10 h-10 rounded-lg inline-flex items-center justify-center " + bgClass(sev)}>
                      <SeverityIcon sev={sev} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Cctv className="w-4 h-4 text-text-soft" />
                        <span className="truncate">{s.camera_name}</span>
                        <span
                          className={
                            "ml-auto inline-block px-2 py-0.5 rounded text-[10px] font-bold " +
                            pillClass(sev)
                          }
                        >
                          z={z.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-xs text-text-soft mt-1 grid grid-cols-3 gap-3 max-w-2xl">
                        <div>
                          <div className="text-text-faint text-[10px]">observed</div>
                          <div className="tabular-nums">{s.worst.observed}</div>
                        </div>
                        <div>
                          <div className="text-text-faint text-[10px]">{t("anomaly_baseline")}</div>
                          <div className="tabular-nums">{s.worst.baseline_median.toFixed(1)} ± {s.worst.baseline_mad.toFixed(1)}</div>
                        </div>
                        <div>
                          <div className="text-text-faint text-[10px]">bucket</div>
                          <div className="tabular-nums text-[11px]">{formatDate(s.worst.bucket_start)}</div>
                        </div>
                      </div>
                      <ZBars items={s.buckets} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

type Sev = "ok" | "warn" | "alert";
function severity(z: number): Sev {
  const az = Math.abs(z);
  if (az >= 3) return "alert";
  if (az >= 2) return "warn";
  return "ok";
}
function ringClass(s: Sev): string {
  return s === "alert" ? "border-danger/40" : s === "warn" ? "border-warning/40" : "border-border";
}
function bgClass(s: Sev): string {
  return s === "alert" ? "bg-danger-soft text-danger-ring" : s === "warn" ? "bg-warning-soft text-warning-ring" : "bg-success-soft text-success-ring";
}
function pillClass(s: Sev): string {
  return s === "alert" ? "bg-danger-soft text-danger-ring" : s === "warn" ? "bg-warning-soft text-warning-ring" : "bg-success-soft text-success-ring";
}
function SeverityIcon({ sev }: { sev: Sev }) {
  if (sev === "alert") return <AlertTriangle className="w-5 h-5" />;
  if (sev === "warn") return <AlertCircle className="w-5 h-5" />;
  return <Check className="w-5 h-5" />;
}

function Legend({ status, label }: { status: Sev; label: string }) {
  return (
    <div className={"card p-2 border " + ringClass(status) + " flex items-center gap-2"}>
      <span className={"w-2 h-2 rounded-full " + (status === "alert" ? "bg-danger" : status === "warn" ? "bg-warning" : "bg-success")} />
      <span className="text-text-soft">{label}</span>
    </div>
  );
}

function ZBars({ items }: { items: Row[] }) {
  if (items.length === 0) return null;
  const maxAbs = items.reduce((a, b) => Math.max(a, Math.abs(b.z_score)), 1);
  return (
    <div className="mt-3 flex items-end gap-0.5 h-10">
      {items.map((it) => {
        const h = (Math.abs(it.z_score) / maxAbs) * 100;
        const positive = it.z_score >= 0;
        const sev = severity(it.z_score);
        return (
          <div
            key={it.bucket_start}
            title={`${formatDate(it.bucket_start)} z=${it.z_score.toFixed(2)} obs=${it.observed}`}
            className="flex-1 rounded-sm relative"
            style={{
              height: `${Math.max(8, h)}%`,
              background:
                sev === "alert"
                  ? "rgb(244,63,94)"
                  : sev === "warn"
                    ? "rgb(245,158,11)"
                    : "rgb(34,197,94)",
              opacity: positive ? 0.9 : 0.5,
            }}
          />
        );
      })}
    </div>
  );
}
