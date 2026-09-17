import {
  NAV_GROUPS,
  findNavItem,
  isActivePath,
  mobileTabs,
  visibleNavGroups,
} from "@/lib/nav";
import { T } from "@/lib/i18n/translations";

describe("lib/nav", () => {
  const allItems = NAV_GROUPS.flatMap((g) => g.items);

  it("every nav label (and short label) resolves to a translation key", () => {
    for (const item of allItems) {
      expect(T).toHaveProperty(item.labelKey);
      if (item.shortLabelKey) expect(T).toHaveProperty(item.shortLabelKey);
    }
    for (const group of NAV_GROUPS) expect(T).toHaveProperty(group.labelKey);
  });

  it("hrefs are unique and absolute", () => {
    const hrefs = allItems.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href.startsWith("/")).toBe(true);
  });

  it("viewer sees only non-admin items; auditor sees only the audit log", () => {
    const viewer = visibleNavGroups("viewer").flatMap((g) => g.items.map((i) => i.href));
    expect(viewer).toEqual(
      expect.arrayContaining(["/dashboard", "/live", "/grid", "/wall", "/playback", "/analytics", "/my-data"]),
    );
    // /privacy is the admin-only differential-privacy demo, not a GDPR page:
    // the self-service surface every role reaches is /my-data.
    expect(viewer).not.toContain("/privacy");
    expect(allItems.find((i) => i.href === "/privacy")?.adminOnly).toBe(true);
    expect(allItems.find((i) => i.href === "/my-data")?.adminOnly).toBeUndefined();
    expect(viewer).not.toContain("/users");
    expect(viewer).not.toContain("/settings");
    // The WebRTC demo stays admin-only even though the NVR grid / wall opened up.
    expect(viewer).not.toContain("/live-rtc");
    expect(allItems.find((i) => i.href === "/live-rtc")?.adminOnly).toBe(true);

    const auditor = visibleNavGroups("auditor").flatMap((g) => g.items.map((i) => i.href));
    expect(auditor).toEqual(["/audit"]);

    // The tournament organiser sees only the SCH console.
    const organiser = visibleNavGroups("organiser").flatMap((g) => g.items.map((i) => i.href));
    expect(organiser).toEqual(["/sch/admin"]);

    const admin = visibleNavGroups("admin").flatMap((g) => g.items);
    expect(admin.length).toBe(allItems.length);
  });

  it("keeps daily destinations first and all tools in six distinct groups", () => {
    expect(NAV_GROUPS.map((group) => group.id)).toEqual([
      "workspace", "monitoring", "investigation", "admin", "ml", "resources",
    ]);
    expect(NAV_GROUPS[0].items.map((item) => item.href)).toEqual([
      "/dashboard", "/live", "/playback", "/alerts", "/incidents", "/search", "/analytics",
    ]);
    expect(allItems).toHaveLength(46);
  });

  it("keeps the operator surfaces together and viewer-accessible", () => {
    const monitoring = NAV_GROUPS.find((group) => group.id === "monitoring");
    expect(monitoring?.items.map((item) => item.href)).toEqual([
      "/grid", "/wall", "/cameras", "/edge-agents", "/alerts-live", "/review", "/jobs",
    ]);
    for (const href of ["/grid", "/wall"]) {
      const item = monitoring?.items.find((i) => i.href === href);
      expect(item?.adminOnly).toBeUndefined();
      expect(item?.auditorAllowed).toBeUndefined();
    }
  });

  it("findNavItem prefers the longest matching prefix and ignores unrelated paths", () => {
    expect(findNavItem("/playback/1234")?.item.href).toBe("/playback");
    expect(findNavItem("/alerts-live")?.item.href).toBe("/alerts-live");
    expect(findNavItem("/alerts")?.item.href).toBe("/alerts");
    expect(findNavItem("/privacy-zones")?.item.href).toBe("/privacy-zones");
    expect(findNavItem("/privacy")?.item.href).toBe("/privacy");
    expect(findNavItem("/does-not-exist")).toBeNull();
  });

  it("isActivePath matches exact and nested routes only", () => {
    expect(isActivePath("/alerts", "/alerts")).toBe(true);
    expect(isActivePath("/alerts/1", "/alerts")).toBe(true);
    expect(isActivePath("/alerts-live", "/alerts")).toBe(false);
  });

  it("mobile tabs are role-aware and capped at four", () => {
    const admin = mobileTabs("admin").map((i) => i.href);
    expect(admin).toEqual(["/dashboard", "/live", "/playback", "/alerts"]);
    const viewer = mobileTabs("viewer").map((i) => i.href);
    expect(viewer).toEqual(["/dashboard", "/live", "/playback", "/analytics"]);
    const auditor = mobileTabs("auditor").map((i) => i.href);
    expect(auditor).toEqual(["/audit"]);
  });
});
