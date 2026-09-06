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
    expect(viewer).toEqual(expect.arrayContaining(["/dashboard", "/live", "/playback", "/analytics", "/privacy"]));
    expect(viewer).not.toContain("/users");
    expect(viewer).not.toContain("/settings");

    const auditor = visibleNavGroups("auditor").flatMap((g) => g.items.map((i) => i.href));
    expect(auditor).toEqual(["/audit"]);

    const admin = visibleNavGroups("admin").flatMap((g) => g.items);
    expect(admin.length).toBe(allItems.length);
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
