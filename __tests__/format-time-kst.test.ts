import { formatTimeKst } from "@/lib/format-time-kst";

describe("formatTimeKst", () => {
  it("renders 24-hour KST regardless of the runtime's locale data", () => {
    // 05:07:09Z = 14:07:09 KST — the case where mn-MN differed between Node
    // ("14:07:09") and Chromium ("2:07:09 PM").
    expect(formatTimeKst("2026-09-23T05:07:09Z")).toBe("14:07:09");
    expect(formatTimeKst(new Date("2026-09-22T15:00:00Z"))).toBe("00:00:00");
    expect(formatTimeKst("2026-09-23T14:59:59.900Z")).toBe("23:59:59");
  });

  it("never emits an AM/PM marker", () => {
    expect(formatTimeKst("2026-09-23T05:07:09Z")).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("falls back to a dash for missing or invalid input", () => {
    expect(formatTimeKst(null)).toBe("—");
    expect(formatTimeKst(undefined)).toBe("—");
    expect(formatTimeKst("not a date")).toBe("—");
  });
});
