import {
  incidentPriorityVariant,
  incidentStatusVariant,
  isIncidentPriority,
  isIncidentStatus,
} from "@/lib/incidents";

describe("incident workflow values", () => {
  it("accepts only database-supported states and priorities", () => {
    expect(isIncidentStatus("investigating")).toBe(true);
    expect(isIncidentStatus("closed")).toBe(false);
    expect(isIncidentPriority("critical")).toBe(true);
    expect(isIncidentPriority("urgent")).toBe(false);
  });

  it("maps urgent and completed work to visible badges", () => {
    expect(incidentPriorityVariant("critical")).toBe("danger");
    expect(incidentStatusVariant("resolved")).toBe("success");
  });
});
