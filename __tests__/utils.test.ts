import { cn, formatDate, pct } from "@/lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("handles conditional classes", () => {
    const cond: boolean = false;
    expect(cn("base", cond && "hidden", "visible")).toBe("base visible");
  });

  it("resolves tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("formatDate", () => {
  it("returns dash for null", () => {
    expect(formatDate(null)).toBe("—");
  });

  it("returns dash for undefined", () => {
    expect(formatDate(undefined)).toBe("—");
  });

  it("returns dash for invalid date string", () => {
    expect(formatDate("not-a-date")).toBe("—");
  });

  // formatDate pins Asia/Seoul (UTC+9, no DST), so these hold on any machine TZ.
  it("formats a valid ISO string as YYYY.MM.DD HH:mm in KST", () => {
    expect(formatDate("2025-01-15T10:30:00Z")).toBe("2025.01.15 19:30");
  });

  it("formats a Date object in KST", () => {
    expect(formatDate(new Date("2025-06-01T12:00:00Z"))).toBe("2025.06.01 21:00");
  });

  it("rolls the day and year over at KST midnight (hour 00, never 24)", () => {
    expect(formatDate("2025-12-31T15:00:00Z")).toBe("2026.01.01 00:00");
    expect(formatDate("2025-01-15T14:59:00Z")).toBe("2025.01.15 23:59");
  });
});

describe("pct", () => {
  it("converts 0.95 to 95%", () => {
    expect(pct(0.95)).toBe("95%");
  });

  it("converts 1 to 100%", () => {
    expect(pct(1)).toBe("100%");
  });

  it("converts 0 to 0%", () => {
    expect(pct(0)).toBe("0%");
  });

  it("rounds to nearest integer", () => {
    expect(pct(0.333)).toBe("33%");
  });
});
