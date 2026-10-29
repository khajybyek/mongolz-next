/**
 * Per-camera privacy schedules (ADR 0012) — the pure half, shared by the
 * schedule page, its server actions, /grid, /live and playback.
 *
 * A schedule can only make protection STRONGER. Video is face-masked in both
 * modes and un-masking stays exclusively the 4-eyes reveal job:
 *   - "standard" — today's behaviour: recognition, face rows, alerts on;
 *     footage can be revealed through the 4-eyes flow.
 *   - "private"  — no ArcFace embeddings, no face rows / crops, no suspect
 *     matching, no alerts, no edge inference, and the reveal job keeps frames
 *     captured in this mode masked.
 * The mode is evaluated by the ML service at CAPTURE time
 * (public.effective_privacy_mode() mirrors the rules in SQL).
 */

export type PrivacyMode = "standard" | "private";

export const PRIVACY_MODES: readonly PrivacyMode[] = ["standard", "private"] as const;

export function isPrivacyMode(value: unknown): value is PrivacyMode {
  return value === "standard" || value === "private";
}

/** What an admin is about to do to a camera's schedule. */
export type ScheduleChange =
  | { kind: "add"; mode: PrivacyMode }
  | { kind: "delete"; mode: PrivacyMode }
  | { kind: "default"; from: PrivacyMode; to: PrivacyMode };

/**
 * "loosen" = the change can switch recognition back on for some instant
 * (needs a fresh TOTP step-up and notifies the other admins); "tighten" = it
 * can only switch recognition off (one click, so a defender is never slowed
 * down); "noop" = nothing changes.
 *
 * Classified by kind, not by the resulting timeline: adding a standard window
 * is "loosen" even if the default is already standard. Conservative on
 * purpose — the answer never depends on reading the rest of the schedule.
 */
export function classifyScheduleChange(change: ScheduleChange): "loosen" | "tighten" | "noop" {
  switch (change.kind) {
    case "add":
      return change.mode === "standard" ? "loosen" : "tighten";
    case "delete":
      return change.mode === "private" ? "loosen" : "tighten";
    case "default":
      if (change.from === change.to) return "noop";
      return change.to === "standard" ? "loosen" : "tighten";
  }
}

/**
 * Ids of streaming cameras (ML `/camera/active`) whose capture is currently in
 * private mode, restricted to cameras the caller may see. Older ML builds do
 * not send `privacy_mode`; those cameras are simply not listed.
 */
export function privateCameraIds(
  entries: ReadonlyArray<{ camera_id: string; privacy_mode?: string | null }>,
  visibleIds: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    if (e.privacy_mode === "private" && visibleIds.has(e.camera_id)) out.add(e.camera_id);
  }
  return [...out];
}

/** Seconds of the stored video's timeline as "mm:ss" ("h:mm:ss" from one hour). */
export function formatVideoOffset(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** One row of public.recording_privacy_spans, as the playback page reads it. */
export interface PrivacySpanRow {
  start_offset_sec: number | string;
  end_offset_sec: number | string | null;
  source: string;
}

export interface PrivacySpanRange {
  start: string;
  /** null = the span was never closed (crash) → protected until the end. */
  end: string | null;
  /** The schedule could not be read; the pipeline protected the footage anyway. */
  failClosed: boolean;
  /** Capture happened while verified consent was still required. */
  consent: boolean;
}

/**
 * Spans as display ranges, in timeline order. Rows with an unusable start are
 * dropped rather than rendered as "—"; an open span (end NULL) is kept open —
 * readers treat it as "until the end of the recording" (fail-closed).
 */
export function privacySpanRanges(rows: readonly PrivacySpanRow[]): PrivacySpanRange[] {
  return rows
    .map((r) => ({
      start: Number(r.start_offset_sec),
      end: r.end_offset_sec === null || r.end_offset_sec === undefined ? null : Number(r.end_offset_sec),
      failClosed: r.source === "fail_closed",
      consent: r.source === "consent",
    }))
    .filter((r) => Number.isFinite(r.start) && r.start >= 0)
    .sort((a, b) => a.start - b.start)
    .map((r) => ({
      start: formatVideoOffset(r.start),
      end: r.end !== null && Number.isFinite(r.end) ? formatVideoOffset(r.end) : null,
      failClosed: r.failClosed,
      consent: r.consent,
    }));
}

/**
 * Streaming cameras (ML `/camera/active`) whose capture is private because
 * the ML service could NOT READ the schedule (`privacy_source` =
 * "fail_closed") — recognition and alerts are paused by an outage, not by a
 * window. A subset of `privateCameraIds`; older ML builds send no source.
 */
export function failClosedCameraIds(
  entries: ReadonlyArray<{ camera_id: string; privacy_mode?: string | null; privacy_source?: string | null }>,
  visibleIds: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    if (e.privacy_mode === "private" && e.privacy_source === "fail_closed" && visibleIds.has(e.camera_id)) {
      out.add(e.camera_id);
    }
  }
  return [...out];
}

// ── Schedule evaluation (display only) ─────────────────────────────────────
// A TypeScript copy of the rules in ml-service/privacy_schedule.py and
// public.effective_privacy_mode() — the shared test vectors live in
// __tests__/privacy-schedule.test.ts too. The ML service is the enforcement
// point; the web uses this only to TELL people which stretches of a recording
// the camera's current schedule withholds from reveal (playback notice,
// reveal modal). Asia/Seoul is a fixed UTC+9 (no daylight saving since 1988).

const KST_OFFSET_MS = 9 * 3600_000;
const DAY_MS = 86_400_000;
const HHMM_RE = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)(:00)?$/;

/**
 * Seconds the ML service widens the schedule part of a recording's protected
 * stretches by, on both sides (ml-service/privacy_protection.py
 * PRIVACY_SCHEDULE_PAD_SEC default): the pipeline knows a live frame's capture
 * instant only within a bound.
 */
export const PRIVACY_SCHEDULE_PAD_SEC = 60;

export interface ScheduleWindowRow {
  window_mode: string;
  starts_at: string;
  ends_at: string;
  weekdays: number;
}

interface ParsedWindow {
  mode: PrivacyMode;
  start: number; // seconds of the local day
  end: number; // seconds of the local day, 86400 = 24:00
  weekdays: number;
}

export interface CameraPrivacySchedule {
  default: PrivacyMode;
  windows: readonly ParsedWindow[];
  consentRequired: boolean;
}

function hhmmSeconds(value: unknown): number | null {
  if (typeof value !== "string" || !HHMM_RE.test(value)) return null;
  const [h, m] = value.split(":");
  return Number(h) * 3600 + Number(m) * 60;
}

/**
 * `cameras.privacy_default` + `masking_schedules` rows → a schedule, or null
 * when anything is outside what the DB constraints allow (the caller then
 * shows nothing rather than a guess; the ML service fails closed on its own).
 */
export function buildPrivacySchedule(
  privacyDefault: unknown,
  rows: readonly ScheduleWindowRow[],
  consentRequired = false,
): CameraPrivacySchedule | null {
  if (!isPrivacyMode(privacyDefault) || typeof consentRequired !== "boolean") return null;
  const windows: ParsedWindow[] = [];
  for (const r of rows) {
    const start = hhmmSeconds(r.starts_at);
    const end = hhmmSeconds(r.ends_at);
    if (!isPrivacyMode(r.window_mode) || start === null || end === null) return null;
    if (start === 86_400 || start === end) return null;
    if (!Number.isInteger(r.weekdays) || r.weekdays < 1 || r.weekdays > 127) return null;
    windows.push({ mode: r.window_mode, start, end, weekdays: r.weekdays });
  }
  return { default: privacyDefault, windows, consentRequired };
}

/** Local (Asia/Seoul) day number, 0 = 1970-01-01 KST (a Thursday). */
function localDay(ms: number): number {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS);
}

/** Sun=1 … Sat=64 — bit index = ISO day-of-week % 7. */
function weekdayBit(day: number): number {
  return 1 << (((day + 4) % 7 + 7) % 7);
}

function dayStartMs(day: number): number {
  return day * DAY_MS - KST_OFFSET_MS;
}

/** The camera's mode at an instant (epoch ms). null schedule = no cameras row → standard. */
export function privacyModeAt(schedule: CameraPrivacySchedule | null, ms: number): PrivacyMode {
  if (!schedule) return "standard";
  if (schedule.consentRequired) return "private";
  const day = localDay(ms);
  const t = (ms - dayStartMs(day)) / 1000;
  const active = new Set<PrivacyMode>();
  for (const w of schedule.windows) {
    const today = (w.weekdays & weekdayBit(day)) !== 0;
    const yesterday = (w.weekdays & weekdayBit(day - 1)) !== 0;
    const on = w.start < w.end
      ? today && w.start <= t && t < w.end
      : (today && t >= w.start) || (yesterday && t < w.end);
    if (on) active.add(w.mode);
  }
  if (active.has("private")) return "private";
  if (active.has("standard")) return "standard";
  return schedule.default;
}

type Ms = [number, number];

function mergeMs(intervals: Ms[]): Ms[] {
  const out: Ms[] = [];
  for (const [a, b] of intervals.filter(([a, b]) => a < b).sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function clipMs(intervals: Ms[], start: number, end: number): Ms[] {
  return intervals
    .map(([a, b]): Ms => [Math.max(a, start), Math.min(b, end)])
    .filter(([a, b]) => a < b);
}

function windowInstances(schedule: CameraPrivacySchedule, mode: PrivacyMode, start: number, end: number): Ms[] {
  const out: Ms[] = [];
  for (let day = localDay(start) - 1; day <= localDay(end) + 1; day++) {
    for (const w of schedule.windows) {
      if (w.mode !== mode || (w.weekdays & weekdayBit(day)) === 0) continue;
      const a = dayStartMs(day) + w.start * 1000;
      const b = (w.start > w.end ? dayStartMs(day + 1) : dayStartMs(day)) + w.end * 1000;
      out.push([a, b]);
    }
  }
  return out;
}

/** Merged [a, b) epoch-ms intervals within [start, end) during which the camera is private. */
export function privateIntervalsMs(schedule: CameraPrivacySchedule | null, start: number, end: number): Ms[] {
  if (!schedule || !(start < end)) return [];
  if (schedule.consentRequired) return [[start, end]];
  let priv = windowInstances(schedule, "private", start, end);
  if (schedule.default === "private") {
    const standard = mergeMs(clipMs(windowInstances(schedule, "standard", start, end), start, end));
    let cursor = start;
    for (const [a, b] of standard) {
      if (a > cursor) priv = [...priv, [cursor, a]];
      cursor = Math.max(cursor, b);
    }
    if (cursor < end) priv = [...priv, [cursor, end]];
  }
  return mergeMs(clipMs(priv, start, end));
}

/**
 * Whether going from `before` to `after` takes private time away: some
 * instant that is private under `before` is standard under `after`. Both
 * schedules repeat every week (weekday bitmask, fixed UTC+9, overnight
 * windows included via the previous day), so one week decides it exactly.
 * A schedule that cannot be parsed counts as taking time away (the caller
 * then records the loosening — the side that keeps edge frames private).
 */
export function removesPrivateTime(
  before: CameraPrivacySchedule | null,
  after: CameraPrivacySchedule | null,
): boolean {
  if (!before || !after) return true;
  const start = dayStartMs(0); // any local day: a week from it holds every weekday once
  const end = start + 7 * DAY_MS;
  const kept = privateIntervalsMs(after, start, end);
  return privateIntervalsMs(before, start, end).some(([a, b]) => {
    let cursor = a;
    for (const [c, d] of kept) {
      if (d <= cursor) continue;
      if (c > cursor) return true; // [cursor, c) was private and no longer is
      cursor = Math.max(cursor, d);
      if (cursor >= b) return false;
    }
    return cursor < b;
  });
}

/** [start, end] offsets (seconds of the video); end null = until the end. */
export type OffsetRange = [number, number | null];

/**
 * Stretches of a recording the camera's CURRENT schedule withholds from
 * reveal, as video offsets clipped to [0, duration] — the ML reveal job's
 * rule: private windows over the capture period, widened by `padSec` on both
 * sides. [] when the start time or the length is unknown.
 */
export function scheduleProtectedOffsets(
  schedule: CameraPrivacySchedule | null,
  startedAtIso: string | null | undefined,
  durationSec: number | null | undefined,
  padSec: number = PRIVACY_SCHEDULE_PAD_SEC,
): OffsetRange[] {
  const started = startedAtIso ? Date.parse(startedAtIso) : NaN;
  const duration = Number(durationSec);
  if (!schedule || !Number.isFinite(started) || !Number.isFinite(duration) || duration <= 0) return [];
  const pad = Math.max(0, padSec) * 1000;
  const windows = privateIntervalsMs(schedule, started - pad, started + duration * 1000 + pad);
  return mergeMs(windows.map(([a, b]): Ms => [a - pad, b + pad]))
    .map(([a, b]): Ms => [Math.max(0, (a - started) / 1000), Math.min(duration, (b - started) / 1000)])
    .filter(([a, b]) => a < b);
}

/** Span rows → numeric offset ranges (unusable rows dropped, open span kept open). */
export function spanOffsets(rows: readonly PrivacySpanRow[]): OffsetRange[] {
  const out: OffsetRange[] = [];
  for (const r of rows) {
    const start = Number(r.start_offset_sec);
    if (!Number.isFinite(start) || start < 0) continue;
    const endRaw = r.end_offset_sec;
    const end = endRaw === null || endRaw === undefined ? null : Number(endRaw);
    out.push([start, end !== null && Number.isFinite(end) ? end : null]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Offset ranges as "mm:ss" display pairs (end null = "until the end"). */
export function formatOffsetRanges(ranges: readonly OffsetRange[]): { start: string; end: string | null }[] {
  return ranges.map(([a, b]) => ({ start: formatVideoOffset(a), end: b === null ? null : formatVideoOffset(b) }));
}

function mergeOffsets(ranges: readonly OffsetRange[]): [number, number][] {
  return mergeMs(ranges.map(([a, b]): Ms => [a, b === null ? Number.POSITIVE_INFINITY : b]));
}

/**
 * True when every offset of [start, end) — or [start, end] with
 * `endInclusive` — lies in one of the ranges. An empty range is not covered.
 * Same rule as ProtectedTimeline.covers_range in the ML reveal job.
 */
export function rangeCovered(
  ranges: readonly OffsetRange[],
  start: number,
  end: number,
  endInclusive = false,
): boolean {
  if (end < start || (end === start && !endInclusive)) return false;
  let cursor = start;
  for (const [a, b] of mergeOffsets(ranges)) {
    if (b <= cursor) continue;
    if (a > cursor) return false;
    cursor = b;
    if (cursor > end || (cursor === end && !endInclusive)) return true;
  }
  return false;
}

/** Seconds of [start, end] that lie in the ranges. */
export function coveredSeconds(ranges: readonly OffsetRange[], start: number, end: number): number {
  let total = 0;
  for (const [a, b] of mergeOffsets(ranges)) {
    total += Math.max(0, Math.min(b, end) - Math.max(a, start));
  }
  return total;
}

export type RevealPrivacyVerdict = "none" | "partial" | "spans" | "schedule";

/**
 * What the reveal job will do with a request, judged the way it judges it
 * before decrypting anything: "spans" / "schedule" = the whole requested range
 * is protected (by capture-time spans alone, or only with the current
 * schedule) and the job will refuse it; "partial" = some of it stays masked;
 * "none" = nothing protected. Without a known duration nothing is refused.
 */
export function revealPrivacyVerdict(
  spans: readonly OffsetRange[],
  schedule: readonly OffsetRange[],
  durationSec: number | null | undefined,
  window: { start: number; end: number } | null,
): RevealPrivacyVerdict {
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration <= 0) return spans.length || schedule.length ? "partial" : "none";
  const all = [...spans, ...schedule];
  const [start, end, inclusive] = window
    ? window.end < duration
      ? [Math.max(0, window.start), window.end, true]
      : [Math.max(0, window.start), duration, false]
    : [0, duration, false];
  if (rangeCovered(spans, start, end, inclusive)) return "spans";
  if (rangeCovered(all, start, end, inclusive)) return "schedule";
  return coveredSeconds(all, start, end) > 0 ? "partial" : "none";
}

/** True when the job would refuse the request ("spans" / "schedule"). */
export function revealBlockedByPrivacy(verdict: RevealPrivacyVerdict): boolean {
  return verdict === "spans" || verdict === "schedule";
}

export type RevealMethod = "upload" | "suspect" | "detected_face";

/**
 * Whether the reveal modal may go on to the re-auth step: the job would not
 * refuse the range (for EVERY method), and the chosen method has its input.
 */
export function revealCanContinue(
  verdict: RevealPrivacyVerdict,
  method: RevealMethod,
  input: { photo: boolean; suspect: boolean; faceCount: number },
): boolean {
  if (revealBlockedByPrivacy(verdict)) return false;
  if (method === "upload") return input.photo;
  if (method === "suspect") return input.suspect;
  return input.faceCount > 0;
}
