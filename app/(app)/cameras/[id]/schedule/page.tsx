import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { StepUpForm } from "@/components/step-up-form";
import { PrivacyEnforcementNotice } from "@/components/privacy-enforcement-notice";
import { probeMlPrivacyEnforcement } from "@/lib/health-probes";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getServerLang, getT } from "@/lib/i18n/server";
import { isPrivacyMode, type PrivacyMode } from "@/lib/privacy-schedule";
import {
  addScheduleAction,
  deleteScheduleAction,
  setPrivacyDefaultAction,
} from "./actions";

export const dynamic = "force-dynamic";

interface ScheduleRow {
  id: string;
  window_mode: PrivacyMode;
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

/**
 * Per-camera privacy schedule (ADR 0012). Enforced by the ML service at
 * capture time: "private" windows switch off face recognition, face rows,
 * alerts and edge inference, and block reveal of the footage captured then.
 * Masking is on in both modes. Every form that can loosen the schedule is a
 * StepUpForm — the action answers REAUTH_REQUIRED when a TOTP step-up is due.
 *
 * "Enforced" is only true while the RUNNING ML build says so: the page probes
 * the ML service's `privacy_schedules` capability and warns when it is
 * missing (an older build ignores schedules) or the service is unreachable.
 */
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
  const enforcementPromise = probeMlPrivacyEnforcement();
  const { data: camera } = await svc
    .from("cameras")
    .select("id, name, cam_type, privacy_default")
    .eq("id", id)
    .single();

  if (!camera) notFound();

  const { data: schedules } = await svc
    .from("masking_schedules")
    .select("id, window_mode, starts_at, ends_at, weekdays, note, created_at")
    .eq("camera_id", id)
    .order("starts_at");

  const rows = (schedules ?? []) as ScheduleRow[];

  // The mode the ML service applies to frames captured right now (the SQL
  // evaluator mirrors ml-service/privacy_schedule.py). An evaluation error
  // must not render as either mode — it says "could not evaluate" instead.
  const { data: nowMode, error: nowModeError } = await svc.rpc("effective_privacy_mode", {
    p_camera_id: id,
  });
  const modeLabel = (mode: string | null | undefined) =>
    mode === "private" ? t("schedule_mode_private") : mode === "standard" ? t("schedule_mode_standard") : mode ?? "—";
  const cameraDefault: PrivacyMode = isPrivacyMode(camera.privacy_default) ? camera.privacy_default : "standard";
  const enforcement = await enforcementPromise;

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

      {enforcement !== "enforced" && (
        <div className="mb-4">
          <PrivacyEnforcementNotice state={enforcement} t={t} />
        </div>
      )}

      <div className="card mb-4 space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-accent" aria-hidden />
          {t("schedule_explain_title")}
        </h3>
        <ul className="list-disc pl-5 space-y-1 text-xs text-text-soft leading-relaxed">
          <li>{t("schedule_explain_masking")}</li>
          <li>{t("schedule_explain_private")}</li>
          <li>{t("schedule_explain_capture")}</li>
          <li>{t("schedule_explain_retroactive")}</li>
          <li>{t("schedule_explain_stepup")}</li>
        </ul>
        <p className="text-[10px] text-text-muted leading-relaxed">{t("schedule_explain_example")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 mt-4">
        <div className="space-y-4">
          {/* Add new window — a standard window is loosening (TOTP step-up) */}
          <StepUpForm action={addScheduleAction} className="card space-y-3">
            <h3 className="text-sm font-semibold">{t("schedule_new_window")}</h3>
            <input type="hidden" name="camera_id" value={camera.id} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <label className="label" htmlFor="sched-mode">{t("schedule_col_mode")}</label>
                <select id="sched-mode" name="window_mode" defaultValue="private" className="input text-sm">
                  <option value="private">{t("schedule_mode_private")}</option>
                  <option value="standard">{t("schedule_mode_standard")}</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="sched-starts">{t("schedule_starts_label")}</label>
                <input
                  id="sched-starts"
                  name="starts_at"
                  placeholder="HH:MM"
                  pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                  defaultValue="09:00"
                  required
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="label" htmlFor="sched-ends">{t("schedule_ends_label")}</label>
                <input
                  id="sched-ends"
                  name="ends_at"
                  placeholder="HH:MM"
                  pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00"
                  defaultValue="18:00"
                  required
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="label" htmlFor="sched-weekdays">{t("schedule_col_weekdays")}</label>
                <input
                  id="sched-weekdays"
                  name="weekdays"
                  placeholder={t("schedule_weekdays_placeholder")}
                  defaultValue={127}
                  min={1}
                  max={127}
                  type="number"
                  required
                  className="input text-sm"
                  title={t("schedule_weekdays_title")}
                  aria-describedby="sched-weekdays-hint"
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="sched-note">{t("schedule_col_note")}</label>
              <input
                id="sched-note"
                name="note"
                placeholder={t("schedule_note_placeholder")}
                maxLength={200}
                className="input text-sm"
              />
            </div>
            <p id="sched-weekdays-hint" className="text-[10px] text-text-muted leading-relaxed">
              {t("schedule_weekdays_hint")} {t("schedule_time_hint")}
            </p>
            <button type="submit" className="btn-primary w-full">
              {t("schedule_add_window")}
            </button>
          </StepUpForm>

          {/* Schedule list */}
          {rows.length === 0 ? (
            <Empty message={`${t("schedule_empty")} (${modeLabel(cameraDefault)})`} />
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
                            r.window_mode === "private"
                              ? "bg-accent/15 text-accent"
                              : "bg-text-muted/15 text-text-soft"
                          }`}
                        >
                          {modeLabel(r.window_mode)}
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
                        {/* Deleting a private window is loosening: the action
                            reads the row's mode from the database and asks
                            for TOTP when it has to. */}
                        <StepUpForm action={deleteScheduleAction} className="inline">
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            className="p-1.5 rounded hover:bg-danger/15 text-text-soft hover:text-danger"
                            title={t("delete")}
                            aria-label={t("delete")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </StepUpForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right side: current state + default */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-xs uppercase tracking-wide text-text-soft mb-2">
              {t("schedule_current_state")}
            </h3>
            {nowModeError || !nowMode ? (
              <div className="text-sm font-semibold text-danger">{t("schedule_state_unknown")}</div>
            ) : (
              <div
                className={`text-2xl font-bold ${
                  nowMode === "private" ? "text-accent" : "text-text"
                }`}
              >
                {modeLabel(nowMode)}
              </div>
            )}
            <p className="text-[10px] text-text-muted mt-1">
              {t("schedule_current_hint")}
            </p>
          </div>

          <StepUpForm action={setPrivacyDefaultAction} className="card space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-text-soft">
              {t("schedule_default_mode")}
            </h3>
            <input type="hidden" name="camera_id" value={camera.id} />
            <select
              name="privacy_default"
              defaultValue={cameraDefault}
              aria-label={t("schedule_default_mode")}
              className="input text-sm"
            >
              <option value="standard">{t("schedule_default_standard")}</option>
              <option value="private">{t("schedule_default_private")}</option>
            </select>
            <button type="submit" className="btn-secondary w-full text-sm">
              {t("save")}
            </button>
            <p className="text-[10px] text-text-muted leading-relaxed">
              {t("schedule_default_hint")}
            </p>
          </StepUpForm>
        </div>
      </div>
    </>
  );
}
