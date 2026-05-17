/** @jest-environment node */
import { t, T, LANGUAGES, type Lang, type TranslationKey } from "@/lib/i18n/translations";

describe("t()", () => {
  it("returns the Mongolian string by default", () => {
    expect(t("nav_dashboard")).toBe(T.nav_dashboard.mn);
  });

  it("returns the English string when lang=en", () => {
    expect(t("nav_dashboard", "en")).toBe(T.nav_dashboard.en);
  });

  it("returns the Korean string when lang=kr", () => {
    expect(t("nav_dashboard", "kr")).toBe(T.nav_dashboard.kr);
  });

  it("falls back to the key when the entry is missing", () => {
    // Force a non-existent key for the negative case.
    const key = "definitely_not_a_real_key" as TranslationKey;
    expect(t(key)).toBe(key);
  });

  it("LANGUAGES enumerates all 3 supported locales", () => {
    expect(Object.keys(LANGUAGES).sort()).toEqual(["en", "kr", "mn"]);
  });

  it("every translation key has all 3 locales filled in", () => {
    const langs: Lang[] = ["mn", "en", "kr"];
    const missing: Array<{ key: string; lang: Lang }> = [];
    for (const [key, entry] of Object.entries(T)) {
      for (const lang of langs) {
        const v = (entry as Record<Lang, string>)[lang];
        if (typeof v !== "string" || v.length === 0) {
          missing.push({ key, lang });
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
