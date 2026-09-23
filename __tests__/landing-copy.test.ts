/**
 * @jest-environment node
 *
 * The public landing page (app/page.tsx) renders in Mongolian by default, so
 * every string it shows must actually be Mongolian, and it must not make
 * claims that go stale or were never measured.
 */
import fs from "node:fs";
import path from "node:path";
import { T, type TranslationKey } from "@/lib/i18n/translations";

const PAGE = fs.readFileSync(path.resolve(__dirname, "..", "app", "page.tsx"), "utf8");
const PAGE_KEYS = Array.from(new Set(Array.from(PAGE.matchAll(/\bt\("([a-z0-9_]+)"\)/g), (m) => m[1])));

// Proper nouns and pure technical labels that read the same in every language.
const LATIN_OK = new Set<string>([
  "home_stat_locales_value", // "MN · EN · KR"
  "demo_problem_tile_b_title", // product name
  "home_stat_embed", // "ArcFace embedding" — model name
]);

const CYRILLIC = /[Ѐ-ӿ]/;

describe("landing page copy", () => {
  it("finds the keys the page renders", () => {
    expect(PAGE_KEYS.length).toBeGreaterThan(20);
    for (const key of PAGE_KEYS) expect(T).toHaveProperty(key);
  });

  it("shows Mongolian (not English) copy for the default locale", () => {
    const english = PAGE_KEYS.filter(
      (key) => !LATIN_OK.has(key) && !CYRILLIC.test(T[key as TranslationKey].mn),
    );
    expect(english).toEqual([]);
  });

  it("does not hard-code a policy count or an unmeasured latency figure", () => {
    for (const lang of ["mn", "en", "kr"] as const) {
      expect(T.demo_sec_rls[lang]).not.toMatch(/\d/);
      expect(T.demo_arch_body[lang]).not.toMatch(/\d+\s*ms/i);
    }
  });
});
