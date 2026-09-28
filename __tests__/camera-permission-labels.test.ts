/**
 * The camera permissions page offers "view" and "operate". Any
 * camera_permissions row — whatever its permission value — grants the same
 * thing (lists, playback, live video); starting / stopping a capture is
 * admin-only (startCameraAction / stopCameraAction call requireAdmin). The
 * "operate" label used to promise start/stop recording.
 */
import fs from "node:fs";
import path from "node:path";
import { t, type Lang } from "@/lib/i18n/translations";

const LANGS: Lang[] = ["mn", "en", "kr"];
const ROOT = path.resolve(__dirname, "..");

describe("camera permission labels", () => {
  it("does not promise start/stop to operate grants", () => {
    expect(t("perm_operate", "en")).not.toMatch(/^Operate — start\/stop recording$/);
    expect(t("perm_operate", "en")).toBe(
      "Operate — same as View (lists, playback, live video); start/stop stays admin-only",
    );
    expect(t("perm_operate", "mn")).not.toBe("Удирдах — бичлэг эхлүүлэх/зогсоох");
    expect(t("perm_operate", "kr")).not.toBe("Operate — 녹화 시작/중지");
  });

  it("says the same access and admin-only start/stop in every language", () => {
    const adminOnly: Record<Lang, RegExp> = { mn: /зөвхөн админ/, en: /admin-only/, kr: /관리자 전용/ };
    const liveVideo: Record<Lang, RegExp> = { mn: /шууд дүрс/, en: /live video/, kr: /실시간 영상/ };
    for (const lang of LANGS) {
      for (const key of ["perm_operate", "perm_kinds_hint"] as const) {
        expect(t(key, lang)).toMatch(adminOnly[lang]);
        expect(t(key, lang)).toMatch(liveVideo[lang]);
      }
      expect(t("perm_view", lang)).toMatch(liveVideo[lang]);
    }
  });

  it("start / stop really are admin-only (the label's claim)", () => {
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
});
