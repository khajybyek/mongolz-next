import { ORGANISER_HOME, organiserPathAllowed, schOrganiserVerdict } from "@/lib/sch/access";

describe("SCH organiser access", () => {
  it("lets the organiser role in without a second factor, holds admins to TOTP, refuses the rest", () => {
    expect(schOrganiserVerdict({ role: "organiser", totp_enabled: false })).toBe("ok");
    expect(schOrganiserVerdict({ role: "organiser", totp_enabled: true })).toBe("ok");
    expect(schOrganiserVerdict({ role: "admin", totp_enabled: true })).toBe("ok");
    expect(schOrganiserVerdict({ role: "admin", totp_enabled: false })).toBe("totp_required");
    expect(schOrganiserVerdict({ role: "viewer", totp_enabled: true })).toBe("forbidden");
    expect(schOrganiserVerdict({ role: "auditor", totp_enabled: true })).toBe("forbidden");
  });

  it("confines the organiser to the console and its own data page", () => {
    expect(ORGANISER_HOME).toBe("/sch/admin");
    for (const ok of ["/sch/admin", "/sch/admin/", "/my-data", "/my-data/export"]) expect(organiserPathAllowed(ok)).toBe(true);
    for (const no of ["/dashboard", "/cameras", "/faces", "/sch", "/sch/teams", "/sch/administrator", "/settings", "/users"]) {
      expect(organiserPathAllowed(no)).toBe(false);
    }
  });
});
