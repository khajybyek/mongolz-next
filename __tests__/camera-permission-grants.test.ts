/**
 * /cameras/<id>/permissions lists PEOPLE, not rows (2026-09-30 visual QA):
 *  - one table row per user, whatever kinds they hold (both grant the same)
 *  - only viewers are offered a grant — admins watch everything anyway and
 *    auditors never get live video (requireUserApi is admin | viewer only)
 *  - a legacy auditor row is labelled as giving no live video
 *  - roles and levels render translated, never as raw database values
 */
import fs from "node:fs";
import path from "node:path";
import { t, type Lang } from "@/lib/i18n/translations";
import {
  grantHasNoLiveEffect,
  groupGrantsByUser,
  isGrantableRole,
  permissionLabelKey,
  roleLabelKey,
  type GrantProfile,
  type PermissionRow,
} from "@/app/(app)/cameras/[id]/permissions/grants";

const ROOT = path.resolve(__dirname, "..");
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";

const row = (id: string, user_id: string, permission: "view" | "operate", created_at: string): PermissionRow => ({
  id,
  user_id,
  permission,
  created_at,
});

describe("groupGrantsByUser", () => {
  const profiles = new Map<string, GrantProfile>([
    [U1, { email: "parking.ops@qa.test", role: "viewer" }],
    [U2, { email: "auditor@qa.test", role: "auditor" }],
  ]);

  it("lists a user holding view + operate once, with both levels in display order", () => {
    const grants = groupGrantsByUser(
      [
        row("a", U1, "operate", "2026-09-29T10:00:00Z"),
        row("b", U1, "view", "2026-09-28T10:00:00Z"),
        row("c", U2, "view", "2026-09-20T10:00:00Z"),
      ],
      profiles,
    );
    expect(grants.map((g) => g.user_id)).toEqual([U1, U2]);
    expect(grants[0]).toEqual({
      user_id: U1,
      email: "parking.ops@qa.test",
      role: "viewer",
      permissions: ["view", "operate"],
      created_at: "2026-09-29T10:00:00Z",
    });
  });

  it("orders people by their newest grant and survives a missing profile", () => {
    const grants = groupGrantsByUser(
      [row("a", U2, "view", "2026-09-01T00:00:00Z"), row("b", U3, "view", "2026-09-05T00:00:00Z")],
      profiles,
    );
    expect(grants.map((g) => g.user_id)).toEqual([U3, U2]);
    expect(grants[0]).toMatchObject({ email: null, role: null });
  });

  it("de-duplicates repeated rows of the same kind", () => {
    const grants = groupGrantsByUser(
      [row("a", U1, "view", "2026-09-01T00:00:00Z"), row("b", U1, "view", "2026-09-02T00:00:00Z")],
      profiles,
    );
    expect(grants).toHaveLength(1);
    expect(grants[0]!.permissions).toEqual(["view"]);
  });

  it("returns nothing for no rows", () => {
    expect(groupGrantsByUser([], profiles)).toEqual([]);
  });
});

describe("who can be offered a grant", () => {
  it("viewers only — never auditors, admins or unknown roles", () => {
    expect(isGrantableRole("viewer")).toBe(true);
    for (const role of ["auditor", "admin", null, undefined, ""]) expect(isGrantableRole(role)).toBe(false);
  });

  it("an auditor row is flagged as giving no live video; a viewer row is not", () => {
    expect(grantHasNoLiveEffect("auditor")).toBe(true);
    expect(grantHasNoLiveEffect("viewer")).toBe(false);
  });

  it("the page's picker asks for viewers and filters through isGrantableRole", () => {
    const page = fs.readFileSync(path.join(ROOT, "app/(app)/cameras/[id]/permissions/page.tsx"), "utf8");
    expect(page).toContain('.eq("role", "viewer")');
    expect(page).toContain("isGrantableRole(u.role)");
    expect(page).not.toContain('.neq("role", "admin")');
    // One table row per person, revoke per person.
    expect(page).toContain("groupGrantsByUser(");
    expect(page).toContain("revokeCameraPermissionAction.bind(null, camera.id)");
  });
});

describe("translated labels", () => {
  const LANGS: Lang[] = ["mn", "en", "kr"];

  it("maps every role to its translated key and leaves unknown roles alone", () => {
    expect(roleLabelKey("viewer")).toBe("role_viewer");
    expect(roleLabelKey("auditor")).toBe("role_auditor");
    expect(roleLabelKey("admin")).toBe("role_admin");
    expect(roleLabelKey("root")).toBeNull();
    expect(t("role_viewer", "mn")).not.toBe("viewer");
  });

  it("maps permission kinds to level names in every language", () => {
    for (const lang of LANGS) {
      expect(t(permissionLabelKey("view"), lang)).toBe(t("perm_view", lang));
      expect(t(permissionLabelKey("operate"), lang)).toBe(t("perm_operate", lang));
    }
    expect(t(permissionLabelKey("view"), "mn")).not.toBe("view");
    expect(t(permissionLabelKey("operate"), "kr")).not.toBe("operate");
  });

  it("the auditor note and the last-grant warning exist in every language", () => {
    for (const lang of LANGS) {
      expect(t("perm_auditor_no_live", lang).length).toBeGreaterThan(0);
      expect(t("perm_revoke_last_confirm", lang).length).toBeGreaterThan(0);
    }
    expect(t("perm_auditor_no_live", "en")).toMatch(/no live video/i);
    expect(t("perm_revoke_last_confirm", "en")).toMatch(/every operator/);
  });

  it("the mn / kr role copy uses the role names, not English words", () => {
    for (const lang of ["mn", "kr"] as const) {
      for (const key of [
        "perm_auditor_no_live",
        "perm_auditor_no_live_tip",
        "perm_levels_live",
        "cam_live_admins_only_restricted_tip",
        "users_role",
      ] as const) {
        expect({ key, lang, text: t(key, lang) }).toEqual({
          key,
          lang,
          text: expect.not.stringMatching(/auditor|stream|role/i),
        });
      }
    }
    // The tooltip and the note on the same row name live video the same way.
    expect(t("perm_auditor_no_live_tip", "kr")).toContain("실시간 영상");
    expect(t("perm_auditor_no_live_tip", "kr")).not.toContain("스트림");
    expect(t("perm_auditor_no_live_tip", "mn")).toContain("шууд дүрс");
    // The note sits next to the role badge: both name the role the same way.
    expect(t("perm_auditor_no_live", "mn").toLowerCase()).toContain(t("role_auditor", "mn").toLowerCase());
  });
});
