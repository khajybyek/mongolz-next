import { kstLocalToIso, parseSearchFilters } from "@/lib/search-filters";

describe("face search filters", () => {
  it("converts datetime-local values from KST to UTC", () => {
    expect(kstLocalToIso("2026-09-14T10:30")).toBe("2026-09-14T01:30:00.000Z");
  });

  it("accepts a bounded camera and time search", () => {
    expect(parseSearchFilters({
      cameraId: "123e4567-e89b-12d3-a456-426614174000",
      from: "2026-09-14T09:00",
      to: "2026-09-14T10:00",
      threshold: "0.63",
      limit: "25",
    })).toEqual({
      cameraId: "123e4567-e89b-12d3-a456-426614174000",
      from: "2026-09-14T00:00:00.000Z",
      to: "2026-09-14T01:00:00.000Z",
      threshold: 0.63,
      limit: 25,
    });
  });

  it("uses safe defaults when optional fields are empty", () => {
    expect(parseSearchFilters({})).toEqual({
      cameraId: null, from: null, to: null, threshold: 0.5, limit: 50,
    });
  });

  it.each([
    { from: "2026-02-30T10:00" },
    { from: "2026-09-14T11:00", to: "2026-09-14T10:00" },
    { cameraId: "not-a-uuid" },
    { threshold: "0.29" },
    { threshold: "NaN" },
    { limit: "101" },
    { limit: "1.5" },
  ])("rejects invalid scope %#", (input) => {
    expect(parseSearchFilters(input)).toBeNull();
  });
});
