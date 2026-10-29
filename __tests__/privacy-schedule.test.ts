/** @jest-environment node */
/**
 * lib/privacy-schedule.ts — the direction of a schedule change decides
 * whether it needs a TOTP step-up (ADR 0012: schedules can only make
 * protection stronger; loosening is gated, tightening is one click).
 */
import {
  buildPrivacySchedule,
  classifyScheduleChange,
  coveredSeconds,
  failClosedCameraIds,
  formatVideoOffset,
  isPrivacyMode,
  privacyModeAt,
  privacySpanRanges,
  privateCameraIds,
  privateIntervalsMs,
  rangeCovered,
  removesPrivateTime,
  revealCanContinue,
  revealPrivacyVerdict,
  scheduleProtectedOffsets,
  spanOffsets,
  type ScheduleWindowRow,
} from "@/lib/privacy-schedule";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { revealErrorCode, revealErrorText } from "@/lib/reveal-errors";
import { privacyEnforcementFromHealth } from "@/lib/health-probes";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrivacyModeBadge, PrivacyModeLegend } from "@/components/privacy-mode-badge";
import { LangProvider } from "@/lib/i18n/client";
import { T } from "@/lib/i18n/translations";

describe("classifyScheduleChange", () => {
  it.each([
    [{ kind: "add", mode: "standard" }, "loosen"],
    [{ kind: "add", mode: "private" }, "tighten"],
    [{ kind: "delete", mode: "private" }, "loosen"],
    [{ kind: "delete", mode: "standard" }, "tighten"],
    [{ kind: "default", from: "private", to: "standard" }, "loosen"],
    [{ kind: "default", from: "standard", to: "private" }, "tighten"],
    [{ kind: "default", from: "standard", to: "standard" }, "noop"],
    [{ kind: "default", from: "private", to: "private" }, "noop"],
  ] as const)("%j → %s", (change, expected) => {
    expect(classifyScheduleChange(change)).toBe(expected);
  });
});

describe("isPrivacyMode", () => {
  it("accepts only the two modes — the old masked / revealed values are gone", () => {
    expect(isPrivacyMode("standard")).toBe(true);
    expect(isPrivacyMode("private")).toBe(true);
    for (const v of ["masked", "revealed", "", null, undefined, 1, "PRIVATE"]) {
      expect(isPrivacyMode(v)).toBe(false);
    }
  });
});

describe("privateCameraIds", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const C = "33333333-3333-4333-8333-333333333333";

  it("keeps private cameras the caller may see, once each", () => {
    const entries = [
      { camera_id: A, privacy_mode: "private" },
      { camera_id: A, privacy_mode: "private" },
      { camera_id: B, privacy_mode: "standard" },
      { camera_id: C, privacy_mode: "private" },
      { camera_id: B, privacy_mode: null },
      { camera_id: B },
    ];
    expect(privateCameraIds(entries, new Set([A, B]))).toEqual([A]);
  });
});

describe("formatVideoOffset", () => {
  it.each([
    [0, "00:00"],
    [9.9, "00:09"],
    [65, "01:05"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3725.4, "1:02:05"],
  ])("%s s → %s", (sec, out) => {
    expect(formatVideoOffset(sec)).toBe(out);
  });

  it("renders a dash for an unusable offset", () => {
    expect(formatVideoOffset(Number.NaN)).toBe("—");
    expect(formatVideoOffset(-1)).toBe("—");
  });
});

describe("PrivacyModeBadge", () => {
  it("renders the translated label with the explanation as tooltip and screen-reader text", () => {
    const html = renderToStaticMarkup(
      createElement(LangProvider, { initial: "en", children: createElement(PrivacyModeBadge) }),
    );
    expect(html).toContain(T.privacy_mode_badge.en);
    expect(html).toContain(`title="${T.privacy_mode_badge_title.en}"`);
    expect(html).toContain("sr-only");
    // Reachable without hover: focusable, and it opts back into pointer
    // events inside the pointer-events-none tile overlays.
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("pointer-events-auto");
  });

  it("names a fail-closed capture as an outage, not a schedule window", () => {
    const html = renderToStaticMarkup(
      createElement(LangProvider, {
        initial: "en",
        children: createElement(PrivacyModeBadge, { failClosed: true }),
      }),
    );
    expect(html).toContain(T.privacy_mode_badge_fail_closed.en);
    expect(html).toContain("This is an outage, not a schedule window");
    expect(html).not.toContain(T.privacy_mode_badge_title.en);
    expect(T.privacy_mode_badge_fail_closed_title.en).not.toMatch(/by schedule/);
  });

  it("the legend explains the badge without hover", () => {
    const html = renderToStaticMarkup(
      createElement(LangProvider, { initial: "en", children: createElement(PrivacyModeLegend, { failClosed: true }) }),
    );
    expect(html).toContain(T.privacy_mode_legend.en);
    expect(html).toContain(T.privacy_mode_legend_fail_closed.en);
  });
});

describe("failClosedCameraIds", () => {
  it("lists only private captures whose schedule was unreadable, among visible cameras", () => {
    const visible = new Set(["a", "b", "c"]);
    expect(
      failClosedCameraIds(
        [
          { camera_id: "a", privacy_mode: "private", privacy_source: "fail_closed" },
          { camera_id: "b", privacy_mode: "private", privacy_source: "schedule" },
          { camera_id: "c", privacy_mode: "standard", privacy_source: "fail_closed" },
          { camera_id: "z", privacy_mode: "private", privacy_source: "fail_closed" },
        ],
        visible,
      ),
    ).toEqual(["a"]);
  });
});

// ── Schedule evaluation — the SAME shared vectors as
// ml-service/tests/test_privacy_schedule.py and
// supabase/tests/privacy_schedule.test.sql (change all three together).
const W = (window_mode: string, starts_at: string, ends_at: string, weekdays: number): ScheduleWindowRow => ({
  window_mode,
  starts_at,
  ends_at,
  weekdays,
});
const SHARED_VECTORS: Array<[number, string | null, ScheduleWindowRow[], string, string]> = [
  [1, "standard", [], "2026-09-28T00:00:00Z", "standard"],
  [1, "standard", [], "2026-09-28T03:00:00Z", "standard"],
  [1, "standard", [], "2026-09-25T13:00:00Z", "standard"],
  [1, "standard", [], "2026-09-26T15:30:00Z", "standard"],
  [2, "private", [], "2026-09-28T00:00:00Z", "private"],
  [2, "private", [], "2026-09-28T03:00:00Z", "private"],
  [2, "private", [], "2026-09-25T17:00:00Z", "private"],
  [2, "private", [], "2026-09-26T15:30:00Z", "private"],
  [3, "standard", [W("private", "09:00", "18:00", 127)], "2026-09-28T00:00:00Z", "private"],
  [3, "standard", [W("private", "09:00", "18:00", 127)], "2026-09-28T08:59:00Z", "private"],
  [3, "standard", [W("private", "09:00", "18:00", 127)], "2026-09-28T09:00:00Z", "standard"],
  [3, "standard", [W("private", "09:00", "18:00", 127)], "2026-09-27T23:59:00Z", "standard"],
  [4, "standard", [W("private", "22:00", "06:00", 32)], "2026-09-25T13:00:00Z", "private"],
  [4, "standard", [W("private", "22:00", "06:00", 32)], "2026-09-25T17:00:00Z", "private"],
  [4, "standard", [W("private", "22:00", "06:00", 32)], "2026-09-24T17:00:00Z", "standard"],
  [4, "standard", [W("private", "22:00", "06:00", 32)], "2026-09-25T21:00:00Z", "standard"],
  [5, "standard", [W("private", "00:00", "24:00", 64)], "2026-09-26T14:59:00Z", "private"],
  [5, "standard", [W("private", "00:00", "24:00", 64)], "2026-09-26T15:00:00Z", "standard"],
  [6, "private", [W("standard", "08:00", "20:00", 127), W("private", "12:00", "13:00", 127)], "2026-09-28T03:30:00Z", "private"],
  [6, "private", [W("standard", "08:00", "20:00", 127), W("private", "12:00", "13:00", 127)], "2026-09-28T02:00:00Z", "standard"],
  [6, "private", [W("standard", "08:00", "20:00", 127), W("private", "12:00", "13:00", 127)], "2026-09-28T12:00:00Z", "private"],
  [7, null, [], "2026-09-28T03:30:00Z", "standard"],
];

describe("schedule evaluation (display copy of the ML rules)", () => {
  it.each(SHARED_VECTORS)("vector %i (%s) at %s", (_v, def, windows, instant, expected) => {
    const schedule = def === null ? null : buildPrivacySchedule(def, windows);
    const at = Date.parse(instant);
    expect(privacyModeAt(schedule, at)).toBe(expected);
    // private_intervals agrees with the instant rule.
    const spans = privateIntervalsMs(schedule, at - 30 * 3600_000, at + 30 * 3600_000);
    expect(spans.some(([a, b]) => a <= at && at < b)).toBe(expected === "private");
  });

  it("accepts Postgres `time` strings and rejects what the DB would reject", () => {
    expect(buildPrivacySchedule("standard", [W("private", "09:00:00", "24:00:00", 1)])).not.toBeNull();
    for (const bad of [
      W("masked", "09:00", "18:00", 1),
      W("private", "24:00", "06:00", 1),
      W("private", "09:00", "09:00", 1),
      W("private", "29:00", "06:00", 1),
      W("private", "09:00", "18:00", 0),
    ]) {
      expect(buildPrivacySchedule("standard", [bad])).toBeNull();
    }
    expect(buildPrivacySchedule("revealed", [])).toBeNull();
  });

  it("places the schedule on a recording with the ML reveal job's 60 s margin", () => {
    // 17:59:50 KST Monday, 300 s long; private 09:00–18:00 ends 10 s in.
    const schedule = buildPrivacySchedule("standard", [W("private", "09:00", "18:00", 127)]);
    expect(scheduleProtectedOffsets(schedule, "2026-09-28T08:59:50Z", 300)).toEqual([[0, 70]]);
    expect(scheduleProtectedOffsets(schedule, "2026-09-28T08:59:50Z", 300, 0)).toEqual([[0, 10]]);
    // A window opening after the recording ends still reaches 60 s back.
    expect(scheduleProtectedOffsets(schedule, "2026-09-27T23:58:30Z", 60)).toEqual([[30, 60]]);
    expect(scheduleProtectedOffsets(schedule, null, 60)).toEqual([]);
    expect(scheduleProtectedOffsets(schedule, "2026-09-28T08:59:50Z", null)).toEqual([]);
    expect(scheduleProtectedOffsets(null, "2026-09-28T08:59:50Z", 60)).toEqual([]);
  });

  it("shows a pending consent gate as private even across standard windows", () => {
    const schedule = buildPrivacySchedule("standard", [W("standard", "00:00", "24:00", 127)], true);
    expect(privacyModeAt(schedule, Date.parse("2026-09-28T00:00:00Z"))).toBe("private");
    expect(scheduleProtectedOffsets(schedule, "2026-09-28T00:00:00Z", 30, 0)).toEqual([[0, 30]]);
  });

  it("range arithmetic matches the reveal job's covers_range", () => {
    const ranges: Array<[number, number | null]> = [[0, 4], [4, 10], [12, 20]];
    expect(rangeCovered(ranges, 0, 10)).toBe(true);
    expect(rangeCovered(ranges, 0, 10, true)).toBe(false);
    expect(rangeCovered(ranges, 0, 11)).toBe(false);
    expect(rangeCovered(ranges, 12, 15, true)).toBe(true);
    expect(rangeCovered(ranges, 5, 5)).toBe(false);
    expect(rangeCovered([[1, null]], 0, 5)).toBe(false);
    expect(rangeCovered([[0, null]], 0, 5)).toBe(true);
    expect(coveredSeconds(ranges, 2, 14)).toBe(10);
    expect(spanOffsets([{ start_offset_sec: "3", end_offset_sec: null, source: "schedule" }])).toEqual([[3, null]]);
  });

  it("predicts the job's verdict: captured in privacy mode, withheld by the schedule, partial, none", () => {
    const spans: Array<[number, number | null]> = [[0, 12]];
    const schedule: Array<[number, number | null]> = [[10, 30]];
    expect(revealPrivacyVerdict(spans, schedule, 30, null)).toBe("schedule");
    expect(revealPrivacyVerdict(spans, [], 30, null)).toBe("partial");
    expect(revealPrivacyVerdict(spans, schedule, 30, { start: 2, end: 9 })).toBe("spans");
    expect(revealPrivacyVerdict(spans, schedule, 60, { start: 25, end: 40 })).toBe("partial");
    expect(revealPrivacyVerdict([], [], 60, null)).toBe("none");
    // The job keeps t <= end in scope: [0, 12) does not cover [2, 12].
    expect(revealPrivacyVerdict(spans, [], 30, { start: 2, end: 12 })).toBe("partial");
    // A window running past the end only needs coverage up to the end.
    expect(revealPrivacyVerdict([[20, null]], [], 30, { start: 25, end: 99 })).toBe("spans");
    // Unknown length: the job refuses nothing up front.
    expect(revealPrivacyVerdict([[0, null]], [], null, null)).toBe("partial");
  });

  it("the modal's Continue is off for a refused range whatever the method", () => {
    // Regression: `!privacyBlocked && (upload && photo) || (suspect && id) ||
    // (detected_face && faces)` gated only the upload method, so Continue
    // stayed enabled (and did nothing) for the other two — detected_face is
    // the default when the modal opens from a face or "Reveal range".
    const ready = { photo: true, suspect: true, faceCount: 2 };
    for (const method of ["upload", "suspect", "detected_face"] as const) {
      expect(revealCanContinue("spans", method, ready)).toBe(false);
      expect(revealCanContinue("schedule", method, ready)).toBe(false);
      expect(revealCanContinue("partial", method, ready)).toBe(true);
      expect(revealCanContinue("none", method, ready)).toBe(true);
    }
    const none = { photo: false, suspect: false, faceCount: 0 };
    expect(revealCanContinue("none", "upload", { ...none, suspect: true, faceCount: 1 })).toBe(false);
    expect(revealCanContinue("none", "suspect", { ...none, photo: true, faceCount: 1 })).toBe(false);
    expect(revealCanContinue("none", "detected_face", { ...none, photo: true, suspect: true })).toBe(false);
  });

  it("the reveal modal takes Continue from revealCanContinue", () => {
    const src = readFileSync(join(__dirname, "..", "app", "(app)", "playback", "[id]", "reveal-modal.tsx"), "utf8");
    expect(src).toMatch(/const canContinue = revealCanContinue\(privacyVerdict, method,/);
    expect(src).toContain("disabled={!canContinue");
  });
});

describe("removesPrivateTime (when a loosening is stamped)", () => {
  const w = (window_mode: string, starts_at: string, ends_at: string, weekdays = 127): ScheduleWindowRow => ({
    window_mode, starts_at, ends_at, weekdays,
  });
  const sch = (d: string, rows: ScheduleWindowRow[]) => buildPrivacySchedule(d, rows);

  it("a standard window on a standard-default camera removes nothing", () => {
    expect(removesPrivateTime(sch("standard", []), sch("standard", [w("standard", "08:00", "20:00")]))).toBe(false);
  });

  it("a standard window over a private default removes private time", () => {
    expect(removesPrivateTime(sch("private", []), sch("private", [w("standard", "08:00", "20:00", 2)]))).toBe(true);
  });

  it("a standard window under a private window removes nothing (private wins)", () => {
    const before = sch("private", [w("private", "09:00", "18:00")]);
    expect(removesPrivateTime(before, sch("private", [w("private", "09:00", "18:00"), w("standard", "10:00", "17:00")]))).toBe(false);
  });

  it("deleting a private window: removes time unless the default or another private window still covers it", () => {
    const biz = w("private", "09:00", "18:00");
    expect(removesPrivateTime(sch("standard", [biz]), sch("standard", []))).toBe(true);
    expect(removesPrivateTime(sch("private", [biz]), sch("private", []))).toBe(false);
    expect(removesPrivateTime(sch("standard", [biz, w("private", "00:00", "24:00")]), sch("standard", [w("private", "00:00", "24:00")]))).toBe(false);
    // With a standard window over it, the default no longer covers that time.
    const std = w("standard", "12:00", "13:00");
    expect(removesPrivateTime(sch("private", [biz, std]), sch("private", [std]))).toBe(true);
  });

  it("overnight windows count on the day after they start (Fri 22:00–06:00 covers Sat 02:00)", () => {
    const night = w("private", "22:00", "06:00", 32);
    expect(removesPrivateTime(sch("standard", [night]), sch("standard", [w("private", "22:00", "24:00", 32)]))).toBe(true);
    expect(removesPrivateTime(sch("standard", [night]), sch("standard", [w("private", "22:00", "24:00", 32), w("private", "00:00", "06:00", 64)]))).toBe(false);
  });

  it("default private → standard; unparseable schedules count as removing", () => {
    expect(removesPrivateTime(sch("private", []), sch("standard", []))).toBe(true);
    expect(removesPrivateTime(sch("private", [w("standard", "00:00", "24:00")]), sch("standard", [w("standard", "00:00", "24:00")]))).toBe(false);
    expect(removesPrivateTime(null, sch("standard", []))).toBe(true);
    expect(removesPrivateTime(sch("standard", []), sch("masked", []))).toBe(true);
  });
});

describe("reveal job error messages", () => {
  const t = (key: keyof typeof T) => T[key].kr;

  it("maps the ML privacy codes to translated copy (Korean included)", () => {
    const raw = "[privacy_whole_recording] Бичлэг бүхэлдээ нууцлалын горимд бичигдсэн — reveal хийх боломжгүй / captured entirely in privacy mode";
    expect(revealErrorCode(raw)).toBe("privacy_whole_recording");
    expect(revealErrorText(raw, t)).toBe(T.reveal_err_privacy_whole_recording.kr);
    for (const [code, key] of [
      ["privacy_unavailable", "reveal_err_privacy_unavailable"],
      ["privacy_rules_unavailable", "reveal_err_privacy_rules_unavailable"],
      ["privacy_whole_range", "reveal_err_privacy_whole_range"],
      ["privacy_schedule_whole_recording", "reveal_err_privacy_schedule_whole_recording"],
      ["privacy_schedule_whole_range", "reveal_err_privacy_schedule_whole_range"],
    ] as const) {
      expect(revealErrorText(`[${code}] x`, t)).toBe(T[key].kr);
    }
  });

  it("falls back to the raw text for unknown codes and plain messages", () => {
    expect(revealErrorText("Upload алдаа", t)).toBe("Upload алдаа");
    expect(revealErrorText("[something_else] boom", t)).toBe("[something_else] boom");
    expect(revealErrorText(null, t)).toBeNull();
    expect(revealErrorText("", t)).toBeNull();
  });
});

describe("ML privacy enforcement capability", () => {
  it("requires privacy_schedules >= 1 on GET /", () => {
    expect(privacyEnforcementFromHealth({ ok: true, privacy_schedules: 1 })).toBe("enforced");
    expect(privacyEnforcementFromHealth({ ok: true, privacy_schedules: 2 })).toBe("enforced");
    expect(privacyEnforcementFromHealth({ ok: true })).toBe("not_enforced"); // older build
    expect(privacyEnforcementFromHealth({ ok: true, privacy_schedules: "1" })).toBe("not_enforced");
    expect(privacyEnforcementFromHealth({ ok: true, privacy_schedules: 0 })).toBe("not_enforced");
    expect(privacyEnforcementFromHealth(null)).toBe("not_enforced");
  });
});

describe("privacySpanRanges", () => {
  it("orders spans on the timeline, keeps open spans open and flags fail-closed ones", () => {
    const ranges = privacySpanRanges([
      { start_offset_sec: 125, end_offset_sec: null, source: "schedule" },
      { start_offset_sec: "0", end_offset_sec: "61.5", source: "fail_closed" },
      { start_offset_sec: 70, end_offset_sec: 90, source: "consent" },
    ]);
    expect(ranges).toEqual([
      { start: "00:00", end: "01:01", failClosed: true, consent: false },
      { start: "01:10", end: "01:30", failClosed: false, consent: true },
      { start: "02:05", end: null, failClosed: false, consent: false },
    ]);
  });

  it("drops rows without a usable start", () => {
    expect(privacySpanRanges([{ start_offset_sec: "x", end_offset_sec: 3, source: "schedule" }])).toEqual([]);
  });
});
