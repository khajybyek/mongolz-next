import { kstLocalToIso, paginateSearchResults, parseSearchFilters } from "@/lib/search-filters";

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
      offset: "50",
      recordingStatus: "ready",
      minConfidence: "0.82",
      suspectId: "223e4567-e89b-12d3-a456-426614174000",
      incidentId: "323e4567-e89b-12d3-a456-426614174000",
    })).toEqual({
      cameraId: "123e4567-e89b-12d3-a456-426614174000",
      from: "2026-09-14T00:00:00.000Z",
      to: "2026-09-14T01:00:00.000Z",
      threshold: 0.63,
      limit: 25,
      offset: 50,
      recordingStatus: "ready",
      minConfidence: 0.82,
      suspectId: "223e4567-e89b-12d3-a456-426614174000",
      incidentId: "323e4567-e89b-12d3-a456-426614174000",
    });
  });

  it("uses safe defaults when optional fields are empty", () => {
    expect(parseSearchFilters({})).toEqual({
      cameraId: null, from: null, to: null, threshold: 0.5, limit: 50, offset: 0,
      recordingStatus: null, minConfidence: null, suspectId: null, incidentId: null,
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
    { offset: "-1" },
    { offset: "10001" },
    { recordingStatus: "deleted" },
    { minConfidence: "1.1" },
    { minConfidence: "NaN" },
    { suspectId: "not-a-uuid" },
    { incidentId: "not-a-uuid" },
  ])("rejects invalid scope %#", (input) => {
    expect(parseSearchFilters(input)).toBeNull();
  });

  it("returns one extra row as a continuation signal", () => {
    expect(paginateSearchResults(["a", "b", "c"], 2, 4)).toEqual({
      matches: ["a", "b"], hasMore: true, nextOffset: 6,
    });
    expect(paginateSearchResults(["a"], 2, 4)).toEqual({
      matches: ["a"], hasMore: false, nextOffset: null,
    });
  });
});
