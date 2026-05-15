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

  it("formats a valid ISO string", () => {
    const result = formatDate("2025-01-15T10:30:00Z");
    expect(result).toBeTruthy();
    expect(result).not.toBe("—");
  });

  it("formats a Date object", () => {
    const result = formatDate(new Date("2025-06-01T12:00:00Z"));
    expect(result).not.toBe("—");
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
