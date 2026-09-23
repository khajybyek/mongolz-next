import { evidenceExportErrorKey } from "@/lib/incident-export-error";
import { T } from "@/lib/i18n/translations";

describe("evidenceExportErrorKey", () => {
  it("maps every failure the evidence-package route emits to translated copy", () => {
    expect(evidenceExportErrorKey(409, "no recording evidence attached")).toBe("incident_export_err_no_evidence");
    expect(evidenceExportErrorKey(413, "package supports at most 20 clips")).toBe("incident_export_err_too_large");
    expect(evidenceExportErrorKey(413, "evidence media could not be packaged")).toBe("incident_export_err_too_large");
    expect(evidenceExportErrorKey(502, "evidence media could not be packaged")).toBe("incident_export_err_packaging");
    expect(evidenceExportErrorKey(503, "evidence renderer unavailable")).toBe("incident_export_err_renderer");
    expect(evidenceExportErrorKey(503, "evidence export audit failed")).toBe("incident_export_err_audit");
  });

  it("falls back (null) for anything else, including a missing body", () => {
    expect(evidenceExportErrorKey(503, "evidence metadata unavailable")).toBeNull();
    expect(evidenceExportErrorKey(500, undefined)).toBeNull();
    expect(evidenceExportErrorKey(404, "incident not found")).toBeNull();
  });

  it("every key it can return exists in mn/en/kr", () => {
    const keys = [
      "incident_export_err_no_evidence",
      "incident_export_err_too_large",
      "incident_export_err_packaging",
      "incident_export_err_renderer",
      "incident_export_err_audit",
      "cam_health_no_frame_yet",
    ] as const;
    for (const k of keys) {
      for (const lang of ["mn", "en", "kr"] as const) expect(T[k][lang].length).toBeGreaterThan(0);
    }
  });
});
