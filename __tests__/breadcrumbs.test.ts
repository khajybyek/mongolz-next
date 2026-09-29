/**
 * Header breadcrumbs (lib/breadcrumbs.ts). Sub-route segments used to be
 * shown raw — every language read "schedule" / "permissions", and on phones
 * that raw word was the page title — and the camera id crumb linked to
 * /cameras/<id>, which has no page (404).
 */
import fs from "node:fs";
import path from "node:path";
import { buildCrumbs, SEGMENT_LABELS, shortSegment } from "@/lib/breadcrumbs";
import { T, type Lang } from "@/lib/i18n/translations";

const CAMERA = "c0000000-0000-4000-8000-000000000001";
const LANGS: Lang[] = ["mn", "en", "kr"];

describe("buildCrumbs", () => {
  it.each(LANGS)("translates the schedule sub-route and does not link the camera id (%s)", (lang) => {
    const crumbs = buildCrumbs(`/cameras/${CAMERA}/schedule`, lang);
    expect(crumbs.map((c) => c.label)).toEqual([
      T.nav_group_monitoring[lang],
      T.nav_cameras[lang],
      "c0000000…",
      T.schedule[lang],
    ]);
    expect(crumbs[1]!.href).toBe("/cameras");
    // /cameras/<id> has no page: the id is plain text, never a link to a 404.
    expect(crumbs[2]!.href).toBeUndefined();
  });

  it.each(LANGS)("translates the permissions sub-route (%s)", (lang) => {
    const crumbs = buildCrumbs(`/cameras/${CAMERA}/permissions`, lang);
    expect(crumbs[crumbs.length - 1]!.label).toBe(T.permissions[lang]);
    expect(crumbs[2]!.label).toBe("c0000000…");
    expect(crumbs[2]!.href).toBeUndefined();
  });

  it("translates the account-erase sub-route under settings", () => {
    const crumbs = buildCrumbs("/settings/erase", "kr");
    expect(crumbs.map((c) => c.label)).toEqual([T.nav_group_admin.kr, T.nav_settings.kr, T.erase_title.kr]);
    expect(crumbs[2]!.href).toBe("/settings/erase");
  });

  it("shortens a record id that is the current page", () => {
    const crumbs = buildCrumbs(`/playback/${CAMERA}`, "en");
    expect(crumbs.map((c) => c.label)).toEqual([T.nav_group_workspace.en, T.nav_playback.en, "c0000000…"]);
  });

  it("keeps linking plain segments of paths outside the nav tree", () => {
    expect(buildCrumbs("/foo/bar", "en")).toEqual([
      { label: "foo", href: "/foo" },
      { label: "bar", href: "/foo/bar" },
    ]);
    // Known sub-route words are translated there too, and ids stay unlinked.
    expect(buildCrumbs(`/foo/${CAMERA}/schedule`, "mn")).toEqual([
      { label: "foo", href: "/foo" },
      { label: "c0000000…", href: undefined },
      { label: T.schedule.mn, href: `/foo/${CAMERA}/schedule` },
    ]);
  });

  it("does not treat inherited object keys as segment labels", () => {
    expect(buildCrumbs("/cameras/constructor", "en")[2]!.label).toBe("constructor");
  });

  it("shortens long and encoded segments", () => {
    expect(shortSegment("a".repeat(30))).toBe("a".repeat(20) + "…");
    expect(shortSegment("%E0%A4%A")).toBe("%E0%A4%A");
  });
});

describe("SEGMENT_LABELS", () => {
  it("every label is a translation key", () => {
    for (const key of Object.values(SEGMENT_LABELS)) expect(T).toHaveProperty(key);
  });

  it("covers every static sub-route under app/(app)", () => {
    const root = path.resolve(__dirname, "..", "app", "(app)");
    const missing: string[] = [];
    const walk = (dir: string, segments: string[]) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const next = entry.name.startsWith("(") ? segments : [...segments, entry.name];
        const full = path.join(dir, entry.name);
        if (fs.existsSync(path.join(full, "page.tsx")) && next.length >= 2) {
          const last = next[next.length - 1]!;
          if (!last.startsWith("[") && !(last in SEGMENT_LABELS)) missing.push(next.join("/"));
        }
        walk(full, next);
      }
    };
    walk(root, []);
    expect(missing).toEqual([]);
  });
});
