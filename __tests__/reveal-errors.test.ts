/** @jest-environment node */
/**
 * lib/reveal-errors.ts — which reveal-job failures the UI shows as a final
 * privacy "withheld" answer (ADR 0012) rather than a failure to retry, and
 * the copy on the playback / reveal / jobs screens that carries it.
 */
import { revealErrorText, revealWithheldByPrivacy } from "@/lib/reveal-errors";
import { T, type TranslationKey } from "@/lib/i18n/translations";

describe("revealWithheldByPrivacy", () => {
  it("is true for the four privacy-policy refusals", () => {
    for (const code of [
      "privacy_whole_recording",
      "privacy_whole_range",
      "privacy_schedule_whole_recording",
      "privacy_schedule_whole_range",
    ]) {
      expect(revealWithheldByPrivacy(`[${code}] Бичлэг … / captured entirely in privacy mode`)).toBe(true);
    }
  });

  it("is false for transient privacy failures — a retry may succeed", () => {
    expect(revealWithheldByPrivacy("[privacy_unavailable] schedule unreadable")).toBe(false);
    expect(revealWithheldByPrivacy("[privacy_rules_unavailable] zones unreadable")).toBe(false);
  });

  it("is false for unknown codes, plain failures and no message", () => {
    expect(revealWithheldByPrivacy("[privacy_something_new] x")).toBe(false);
    expect(revealWithheldByPrivacy("ffmpeg exited with code 1")).toBe(false);
    expect(revealWithheldByPrivacy("privacy_whole_recording")).toBe(false); // no brackets
    expect(revealWithheldByPrivacy("")).toBe(false);
    expect(revealWithheldByPrivacy(null)).toBe(false);
    expect(revealWithheldByPrivacy(undefined)).toBe(false);
  });

  it("every withheld message still has translated text", () => {
    const t = (key: TranslationKey) => T[key].en;
    const text = revealErrorText("[privacy_schedule_whole_range] x", t);
    expect(text).toBe(T.reveal_err_privacy_schedule_whole_range.en);
  });
});

describe("reveal privacy copy", () => {
  // The same screens call it 공개 (modal title, 공개 실패, /jobs 얼굴 공개).
  const KR_REVEAL_KEYS: TranslationKey[] = [
    "pb_privacy_spans_desc",
    "pb_privacy_schedule_desc",
    "pb_reveal_privacy_blocked_spans",
    "pb_reveal_privacy_blocked_schedule",
    "pb_reveal_privacy_partial",
    "pb_reveal_privacy_blocked_spans_recording",
    "pb_reveal_privacy_blocked_schedule_recording",
    "pb_reveal_privacy_partial_recording",
    "pb_reveal_withheld_hint",
    "pb_reveal_privacy_hint",
    "reveal_err_privacy_unavailable",
    "reveal_err_privacy_rules_unavailable",
    "reveal_err_privacy_whole_recording",
    "reveal_err_privacy_whole_range",
    "reveal_err_privacy_schedule_whole_recording",
    "reveal_err_privacy_schedule_whole_range",
    "rec_original_kept_withheld",
    "rec_original_kept_admin_only",
    "reveal_withheld_privacy",
    "pb_authority_director",
  ];

  it("Korean never falls back to the English word 'reveal'", () => {
    for (const key of KR_REVEAL_KEYS) {
      expect({ key, kr: T[key].kr }).toEqual({ key, kr: expect.not.stringMatching(/reveal/i) });
    }
  });

  // The privacy-mode badge / legend (/live, /grid, /wall) and the schedule
  // page's mode copy sit next to 공개 / «ил болгох» elsewhere on screen.
  const PRIVACY_MODE_KEYS: TranslationKey[] = [
    "privacy_mode_legend",
    "privacy_mode_badge_title",
    "privacy_mode_badge_fail_closed_title",
    "schedule_default_private",
    "schedule_explain_masking",
    "schedule_explain_private",
    "schedule_explain_retroactive",
  ];

  it("privacy-mode copy never falls back to the English word 'reveal' in mn or kr", () => {
    for (const key of PRIVACY_MODE_KEYS) {
      for (const lang of ["mn", "kr"] as const) {
        expect({ key, lang, text: T[key][lang] }).toEqual({ key, lang, text: expect.not.stringMatching(/reveal/i) });
      }
    }
  });

  it("the schedule page's mode card uses no English terms in mn or kr", () => {
    for (const lang of ["mn", "kr"] as const) {
      expect(T.schedule_explain_private[lang]).not.toMatch(/edge|inference/i);
      expect(T.schedule_explain_masking[lang]).not.toMatch(/eyes/i);
    }
  });

  it("the whole-recording verdicts do not talk about a selected range", () => {
    for (const key of [
      "pb_reveal_privacy_blocked_spans_recording",
      "pb_reveal_privacy_blocked_schedule_recording",
      "pb_reveal_privacy_partial_recording",
    ] as const) {
      expect(T[key].en).toMatch(/recording/);
      expect(T[key].en).not.toMatch(/selected range/);
    }
  });

  it("the back link carries no arrow of its own (the icon draws one)", () => {
    for (const lang of ["mn", "en", "kr"] as const) {
      expect(T.playback_back[lang]).not.toMatch(/^[←<]/);
    }
  });

  it("the director badge is translated", () => {
    expect(T.pb_authority_director.mn).not.toBe("Director");
    expect(T.pb_authority_director.kr).not.toBe("Director");
  });
});
