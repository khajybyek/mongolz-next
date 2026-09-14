import { archiveFilters, pageHref, pageNumber, recordingFaceHref } from "@/lib/workflow-query";
import { CAMERA_FRESH_MS, INGEST_FRESH_MS, isFreshEvidence } from "@/lib/readiness";

const REC = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FACE = "11111111-2222-4333-8444-555555555555";

describe("archive and investigation navigation", () => {
  test("calendar boundaries match the displayed inclusive KST days", () => {
    expect(archiveFilters({ from: "2026-09-11", to: "2026-09-11", camera: REC, page: "7" })).toEqual({
      from: "2026-09-11", to: "2026-09-11", camera: REC, page: 7,
      since: "2026-09-10T15:00:00.000Z", until: "2026-09-11T15:00:00.000Z",
    });
    expect(archiveFilters({ from: "2024-02-29", to: "2024-03-01" })).not.toBeNull();
  });
  test.each([
    { from: "2026-02-29" }, { from: "2026-09-31" }, { from: "2026-09-12", to: "2026-09-11" },
    { camera: "bad,id" }, { camera: [REC] }, { from: ["2026-09-11"] }, { page: "0" }, { page: "-1" }, { page: "1e2" },
  ])("rejects malformed filters instead of querying a different range: %o", (params) => expect(archiveFilters(params)).toBeNull());
  test("pagination retains evidence filters and has no fixed 100-row ceiling", () => {
    expect(pageNumber("101")).toBe(101);
    expect(pageHref("/playback", { from: "2026-09-11", camera: REC, page: "2" }, 3)).toBe(`/playback?from=2026-09-11&camera=${REC}&page=3`);
    expect(pageHref("/jobs", { kind: "all", upload_page: 2, reveal_page: 3 }, 1, "reveal_page")).toBe("/jobs?kind=all&upload_page=2");
  });
  test("a search candidate opens its exact face; absent/unsafe recordings are not links", () => {
    expect(recordingFaceHref(REC, FACE)).toBe(`/playback/${REC}?face=${FACE}`);
    expect(recordingFaceHref(null, FACE)).toBeNull();
    expect(recordingFaceHref("../../users", FACE)).toBeNull();
    expect(recordingFaceHref(REC, "?redirect=elsewhere")).toBeNull();
  });
});

describe("readiness needs current evidence", () => {
  const now = Date.parse("2026-09-11T12:00:00Z");
  test("historical June footage and old camera heartbeat never mark September ready", () => {
    expect(isFreshEvidence("2026-06-08T01:13:26Z", INGEST_FRESH_MS, now)).toBe(false);
    expect(isFreshEvidence(new Date(now - CAMERA_FRESH_MS - 1).toISOString(), CAMERA_FRESH_MS, now)).toBe(false);
    expect(isFreshEvidence(new Date(now - CAMERA_FRESH_MS).toISOString(), CAMERA_FRESH_MS, now)).toBe(true);
    expect(isFreshEvidence(new Date(now - INGEST_FRESH_MS).toISOString(), INGEST_FRESH_MS, now)).toBe(true);
  });
  test.each([null, undefined, "invalid", "2027-09-11T12:00:00Z"])("missing, invalid or future evidence is not ready: %s", (at) => {
    expect(isFreshEvidence(at, INGEST_FRESH_MS, now)).toBe(false);
  });
});
