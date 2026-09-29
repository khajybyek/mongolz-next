/**
 * The camera permissions page offers "view" and "operate". Any
 * camera_permissions row — whatever its permission value — grants the same
 * thing (lists, playback, live video); starting / stopping a capture is
 * admin-only (startCameraAction / stopCameraAction call requireAdmin). The
 * "operate" label used to promise start/stop recording.
 *
 * Since the 2026-09-30 visual QA the option labels are the level names only
 * (a closed <select> cut the long labels off and lost the admin-only half);
 * the hint rendered under the picker carries the explanation.
 */
import fs from "node:fs";
import path from "node:path";
import { t, type Lang } from "@/lib/i18n/translations";

const LANGS: Lang[] = ["mn", "en", "kr"];
const ROOT = path.resolve(__dirname, "..");

describe("camera permission labels", () => {
  it("does not promise start/stop to operate grants", () => {
    expect(t("perm_operate", "en")).not.toMatch(/start|stop/i);
    expect(t("perm_operate", "mn")).not.toMatch(/эхлүүлэх|зогсоох/);
    expect(t("perm_operate", "kr")).not.toMatch(/시작|중지/);
  });

  it("labels are short level names that fit a closed select, in every language", () => {
    for (const lang of LANGS) {
      for (const key of ["perm_view", "perm_operate"] as const) {
        expect(t(key, lang).length).toBeLessThanOrEqual(12);
        expect(t(key, lang)).not.toContain("—");
      }
    }
    // mn / kr no longer show the raw English level names.
    expect(t("perm_view", "mn")).not.toMatch(/[A-Za-z]/);
    expect(t("perm_operate", "kr")).not.toMatch(/[A-Za-z]/);
  });

  it("the hint says the same access and admin-only start/stop in every language, naming both levels", () => {
    const adminOnly: Record<Lang, RegExp> = { mn: /зөвхөн админ/, en: /admin-only/, kr: /관리자 전용/ };
    const liveVideo: Record<Lang, RegExp> = { mn: /шууд дүрс/, en: /live video/, kr: /실시간 영상/ };
    for (const lang of LANGS) {
      const hint = t("perm_kinds_hint", lang);
      expect(hint).toMatch(adminOnly[lang]);
      expect(hint).toMatch(liveVideo[lang]);
      expect(hint).toContain(t("perm_view", lang));
      expect(hint).toContain(t("perm_operate", lang));
    }
  });

  it("start / stop really are admin-only (the hint's claim)", () => {
    const src = fs.readFileSync(path.join(ROOT, "app/(app)/live/actions.ts"), "utf8");
    for (const fn of ["startCameraAction", "stopCameraAction"]) {
      const body = src.slice(src.indexOf(`export async function ${fn}`));
      expect(body.slice(0, body.indexOf("\n}\n"))).toMatch(/await requireAdmin\(\)/);
    }
  });

  it("the grant form shows the hint next to the permission picker", () => {
    const page = fs.readFileSync(path.join(ROOT, "app/(app)/cameras/[id]/permissions/page.tsx"), "utf8");
    expect(page).toContain('t("perm_kinds_hint")');
    expect(page).toContain('aria-describedby="perm-kinds-hint"');
  });

  it("mn column headers are Mongolian", () => {
    expect(t("perm_col_role", "mn")).not.toMatch(/[A-Za-z]/);
    expect(t("perm_col_permission", "mn")).not.toMatch(/[A-Za-z]/);
  });
});
