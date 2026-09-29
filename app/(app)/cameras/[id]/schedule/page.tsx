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
import { WEEKDAY_BITS, WEEKDAY_FIELD, weekdayNames, weekdaysLabel } from "./weekdays";

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
  const enforced = enforcement === "enforced";
  const dayNames = weekdayNames(lang);
  // Shown in the TOTP prompt: every step-up on this page is a loosening.
  const stepUpReason = t("schedule_stepup_reason");

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

      {!enforced && (
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
          <StepUpForm
            action={addScheduleAction}
            className="card space-y-3"
            resetOnSuccess
            stepUpDescription={stepUpReason}
          >
            <h3 className="text-sm font-semibold">{t("schedule_new_window")}</h3>
            <input type="hidden" name="camera_id" value={camera.id} />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="col-span-2 sm:col-span-1">
                <label className="label" htmlFor="sched-mode">{t("schedule_col_mode")}</label>
                <select id="sched-mode" name="window_mode" defaultValue="private" className="select text-sm">
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
                  aria-describedby="sched-time-hint"
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
                  aria-describedby="sched-time-hint"
                />
              </div>
            </div>
            {/* One checkbox per day; the action ORs the ticked bits into the
                weekday mask (Sun = 1, Sat = 64). */}
            <fieldset className="min-w-0">
              <legend className="label">{t("schedule_col_weekdays")}</legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_BITS.map((bit, i) => (
                  <label
                    key={bit}
                    className="inline-flex items-center gap-1.5 min-h-[40px] rounded-lg border border-border-strong bg-surface-elevated px-2.5 text-xs cursor-pointer has-[:checked]:border-accent/50 has-[:checked]:bg-accent/10"
                  >
                    <input type="checkbox" name={WEEKDAY_FIELD} value={bit} defaultChecked className="accent-accent" />
                    {dayNames[i]}
                  </label>
                ))}
              </div>
            </fieldset>
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
            <p id="sched-time-hint" className="text-[10px] text-text-muted leading-relaxed">
              {t("schedule_time_hint")}
            </p>
            <button type="submit" className="btn-primary w-full">
              {t("schedule_add_window")}
            </button>
          </StepUpForm>

          {/* Schedule list */}
          {rows.length === 0 ? (
            <Empty message={t("schedule_empty").replace("{mode}", modeLabel(cameraDefault))} />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl tbl-tight">
                <thead>
                  <tr>
                    <th>{t("schedule_col_mode")}</th>
                    <th>{t("schedule_col_time")}</th>
                    <th>{t("schedule_col_weekdays")}</th>
                    <th className="hidden sm:table-cell">{t("schedule_col_note")}</th>
                    <th className="num">{t("schedule_col_action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const time = `${r.starts_at.slice(0, 5)}–${r.ends_at.slice(0, 5)}`;
                    // Visible: "Mon–Fri" (one line on a phone); read aloud: every day named.
                    const days = weekdaysLabel(r.weekdays, lang, { ranges: true });
                    const deleteLabel = `${t("delete")}: ${modeLabel(r.window_mode)} ${time}, ${weekdaysLabel(r.weekdays, lang)}`;
                    return (
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
                        <td className="text-xs font-mono whitespace-nowrap">{time}</td>
                        <td className="text-xs">{days}</td>
                        <td className="text-xs hidden sm:table-cell">
                          <span className="text-text-muted">{r.note ?? "—"}</span>
                        </td>
                        <td className="num">
                          {/* Deleting a private window is loosening: the action
                              reads the row's mode from the database and asks
                              for TOTP when it has to. */}
                          <StepUpForm action={deleteScheduleAction} className="inline" stepUpDescription={stepUpReason}>
                            <input type="hidden" name="id" value={r.id} />
                            <button
                              type="submit"
                              className="p-1.5 rounded hover:bg-danger/15 text-text-soft hover:text-danger disabled:opacity-50 disabled:cursor-not-allowed"
                              title={deleteLabel}
                              aria-label={deleteLabel}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </StepUpForm>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right side: current state + default. First on phones, so the
            question "is this camera private now?" is answered on arrival. */}
        <div className="space-y-4 order-first lg:order-none">
          <div className="card">
            <h3 className="text-xs uppercase tracking-wide text-text-soft mb-2">
              {t("schedule_current_state")}
            </h3>
            {nowModeError || !nowMode ? (
              <div className="text-sm font-semibold text-danger">{t("schedule_state_unknown")}</div>
            ) : (
              <>
                {/* While the running ML build does not confirm enforcement
                    the saved schedule is not proof of what happens to frames,
                    so the mode is muted and qualified. */}
                <div
                  className={`text-2xl font-bold ${
                    !enforced ? "text-text-muted" : nowMode === "private" ? "text-accent" : "text-text"
                  }`}
                >
                  {modeLabel(nowMode)}
                </div>
                {!enforced && (
                  <p className="text-xs font-medium text-warning mt-1">{t("schedule_state_not_enforced")}</p>
                )}
              </>
            )}
            <p className="text-[10px] text-text-muted mt-1">
              {t("schedule_current_hint")}
            </p>
          </div>

          {/* The radios show the SAVED default: revertUnsaved puts them back
              when a loosening is not saved (TOTP cancelled or refused). */}
          <StepUpForm
            action={setPrivacyDefaultAction}
            className="card space-y-3"
            revertUnsaved
            stepUpDescription={stepUpReason}
          >
            <fieldset className="min-w-0 space-y-2">
              <legend className="text-xs uppercase tracking-wide text-text-soft">
                {t("schedule_default_mode")}
              </legend>
              {(["standard", "private"] as const).map((mode) => (
                <label
                  key={mode}
                  className="flex items-start gap-2.5 rounded-lg border border-border-strong bg-surface-elevated px-3 py-2.5 text-sm leading-snug cursor-pointer has-[:checked]:border-accent/50 has-[:checked]:bg-accent/10"
                >
                  <input
                    type="radio"
                    name="privacy_default"
                    value={mode}
                    defaultChecked={cameraDefault === mode}
                    className="mt-0.5 shrink-0 accent-accent"
                  />
                  <span className="min-w-0">
                    {t(mode === "standard" ? "schedule_default_standard" : "schedule_default_private")}
                  </span>
                </label>
              ))}
            </fieldset>
            <button type="submit" className="btn-secondary w-full text-sm">
              {t("save")}
            </button>
            <p className="text-[10px] text-text-muted leading-relaxed">
              {t("schedule_default_hint")}
            </p>
            {/* Last: before the legend, space-y-3 would give the first
                visible row a 12 px margin under the card's own padding. */}
            <input type="hidden" name="camera_id" value={camera.id} />
          </StepUpForm>
        </div>
      </div>
    </>
  );
}
