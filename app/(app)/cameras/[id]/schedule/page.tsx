import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getServerLang, getT } from "@/lib/i18n/server";
import {
  addScheduleAction,
  deleteScheduleAction,
  setMaskDefaultAction,
} from "./actions";

export const dynamic = "force-dynamic";

interface ScheduleRow {
  id: string;
  window_mode: "masked" | "revealed";
  starts_at: string;
  ends_at: string;
  weekdays: number;
  note: string | null;
  created_at: string;
}

const WEEKDAY_NAMES: Record<string, string[]> = {
  mn: ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  kr: ["일", "월", "화", "수", "목", "금", "토"],
};

const EVERY_DAY: Record<string, string> = {
  mn: "Өдөр бүр",
  en: "Every day",
  kr: "매일",
};

function weekdaysLabel(mask: number, lang: string): string {
  const names = WEEKDAY_NAMES[lang] ?? WEEKDAY_NAMES.mn!;
  const every = EVERY_DAY[lang] ?? EVERY_DAY.mn!;
  if (mask === 127) return every;
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    if (mask & (1 << i)) parts.push(names[i]!);
  }
  return parts.join(", ");
}

export default async function CameraSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { t } = await getT();
  const lang = await getServerLang();
  const { id } = await params;

  const svc = createServiceClient();
  const { data: camera } = await svc
    .from("cameras")
    .select("id, name, cam_type, mask_default")
    .eq("id", id)
    .single();

  if (!camera) notFound();

  const { data: schedules } = await svc
    .from("masking_schedules")
    .select("id, window_mode, starts_at, ends_at, weekdays, note, created_at")
    .eq("camera_id", id)
    .order("starts_at");

  const rows = (schedules ?? []) as ScheduleRow[];

  // Evaluate current effective mode
  const { data: nowMode } = await svc.rpc("effective_mask_mode", {
    p_camera_id: id,
  });

  return (
    <>
      <Link
        href="/cameras"
        className="text-sm text-text-soft hover:text-text inline-flex items-center gap-1.5 mb-3"
      >
        <ArrowLeft className="w-4 h-4" />
        {t("nav_cameras")}
      </Link>

      <PageHeader
        title={`${t("schedule_title_prefix")} ${camera.name}`}
        subtitle={t("schedule_subtitle")}
      />
      <div className="mb-4 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-xs text-warning leading-relaxed">
        {t("schedule_preview_note")}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 mt-4">
        <div className="space-y-4">
          {/* Add new schedule */}
          <form action={addScheduleAction} className="card space-y-3">
            <h3 className="text-sm font-semibold">{t("schedule_new_window")}</h3>
            <input type="hidden" name="camera_id" value={camera.id} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <select name="window_mode" defaultValue="revealed" className="input text-sm">
                <option value="revealed">{t("schedule_mode_revealed")}</option>
                <option value="masked">{t("schedule_mode_masked")}</option>
              </select>
              <input
                name="starts_at"
                placeholder="HH:MM"
                pattern="[0-2][0-9]:[0-5][0-9]"
                defaultValue="09:00"
                required
                className="input text-sm"
              />
              <input
                name="ends_at"
                placeholder="HH:MM"
                pattern="[0-2][0-9]:[0-5][0-9]"
                defaultValue="18:00"
                required
                className="input text-sm"
              />
              <input
                name="weekdays"
                placeholder={t("schedule_weekdays_placeholder")}
                defaultValue={127}
                min={1}
                max={127}
                type="number"
                required
                className="input text-sm"
                title={t("schedule_weekdays_title")}
              />
            </div>
            <input
              name="note"
              placeholder={t("schedule_note_placeholder")}
              maxLength={200}
              className="input text-sm"
            />
            <p className="text-[10px] text-text-muted leading-relaxed">
              {t("schedule_weekdays_hint")}
            </p>
            <button type="submit" className="btn-primary w-full">
              {t("schedule_add_window")}
            </button>
          </form>

          {/* Schedule list */}
          {rows.length === 0 ? (
            <Empty message={`${t("schedule_empty")} (${camera.mask_default})`} />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t("schedule_col_mode")}</th>
                    <th>{t("schedule_col_time")}</th>
                    <th>{t("schedule_col_weekdays")}</th>
                    <th>{t("schedule_col_note")}</th>
                    <th className="num">{t("schedule_col_action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span
                          className={`badge ${
                            r.window_mode === "masked"
                              ? "bg-accent/15 text-accent"
                              : "bg-warning/15 text-warning"
                          }`}
                        >
                          {r.window_mode}
                        </span>
                      </td>
                      <td className="text-xs font-mono">
                        {r.starts_at.slice(0, 5)} – {r.ends_at.slice(0, 5)}
                      </td>
                      <td className="text-xs">
                        {weekdaysLabel(r.weekdays, lang)}
                      </td>
                      <td className="text-xs">
                        <span className="text-text-muted">{r.note ?? "—"}</span>
                      </td>
                      <td className="num">
                        <form action={deleteScheduleAction} className="inline">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="camera_id" value={camera.id} />
                          <button
                            type="submit"
                            className="p-1.5 rounded hover:bg-danger/15 text-text-soft hover:text-danger"
                            title={t("delete")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right side: default + current state */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-xs uppercase tracking-wide text-text-soft mb-2">
              {t("schedule_current_state")}
            </h3>
            <div
              className={`text-2xl font-bold ${
                nowMode === "masked" ? "text-accent" : "text-warning"
              }`}
            >
              {nowMode ?? "masked"}
            </div>
            <p className="text-[10px] text-text-muted mt-1">
              {t("schedule_current_hint")}
            </p>
          </div>

          <form action={setMaskDefaultAction} className="card space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-text-soft">
              {t("schedule_default_mode")}
            </h3>
            <input type="hidden" name="camera_id" value={camera.id} />
            <select
              name="mask_default"
              defaultValue={camera.mask_default}
              className="input text-sm"
            >
              <option value="masked">{t("schedule_default_masked")}</option>
              <option value="revealed">{t("schedule_default_revealed")}</option>
            </select>
            <button type="submit" className="btn-secondary w-full text-sm">
              {t("save")}
            </button>
            <p className="text-[10px] text-text-muted leading-relaxed">
              {t("schedule_default_warning")}
            </p>
          </form>
        </div>
      </div>
    </>
  );
}
