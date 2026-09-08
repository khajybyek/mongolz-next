/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";
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

/**
 * Usage coverage. The block above proves every key that exists is filled in
 * for all three locales; this one proves every key the app actually renders
 * exists at all. TypeScript catches a literal `t("typo")`, but not a key
 * reached through an `as TranslationKey` cast, a nav table or a labels map —
 * and those are exactly how the operator pages hand keys around.
 */
describe("translation keys used by the app", () => {
  const ROOT = path.resolve(__dirname, "..");
  const SCAN_DIRS = ["app", "components", "lib"];
  const LANGS: Lang[] = ["mn", "en", "kr"];

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
      }
    };
    walk(dir);
    return out;
  }

  const files = SCAN_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)))
    // The translation table itself defines keys; it does not consume them.
    .filter((f) => !f.endsWith(path.join("lib", "i18n", "translations.ts")));

  // t("key") / t('key') / labelKey: "key" / shortLabelKey / nameKey / titleKey
  // / descKey / detailKey / "key" as TranslationKey.
  const PATTERNS = [
    /\bt\(\s*["']([a-z0-9_]+)["']\s*[,)]/g,
    /\b(?:labelKey|shortLabelKey|nameKey|titleKey|descKey|detailKey|key)\s*:\s*["']([a-z0-9_]+)["']/g,
    /["']([a-z0-9_]+)["']\s+as\s+TranslationKey/g,
  ];

  const used = new Map<string, string>(); // key -> first file that uses it
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    for (const pattern of PATTERNS) {
      for (const m of src.matchAll(pattern)) {
        const key = m[1]!;
        if (!used.has(key)) used.set(key, path.relative(ROOT, file));
      }
    }
  }

  it("finds the keys the app renders", () => {
    // A scanner that silently matches nothing would make the checks below
    // pass for the wrong reason.
    expect(files.length).toBeGreaterThan(100);
    expect(used.size).toBeGreaterThan(300);
    expect(used.has("nav_dashboard")).toBe(true);
  });

  it("every key used in the app exists with mn, en and kr filled in", () => {
    const table = T as Record<string, Partial<Record<Lang, string>> | undefined>;
    const broken: string[] = [];
    for (const [key, file] of used) {
      const entry = table[key];
      if (!entry) {
        // `key:` also matches unrelated object literals, so only flag an
        // unknown key when it is passed to t() or cast to TranslationKey.
        const viaT = files.some((f) => {
          const src = fs.readFileSync(f, "utf8");
          return (
            new RegExp(`\\bt\\(\\s*["']${key}["']\\s*[,)]`).test(src) ||
            new RegExp(`["']${key}["']\\s+as\\s+TranslationKey`).test(src)
          );
        });
        if (viaT) broken.push(`${key} — missing entirely (used in ${file})`);
        continue;
      }
      for (const lang of LANGS) {
        const value = entry[lang];
        if (typeof value !== "string" || value.length === 0) {
          broken.push(`${key}.${lang} — empty (used in ${file})`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
