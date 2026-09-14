import type { IncidentPriority, IncidentStatus } from "@/lib/database.types";

export const INCIDENT_STATUSES = ["open", "investigating", "resolved"] as const;
export const INCIDENT_PRIORITIES = ["low", "medium", "high", "critical"] as const;

export function isIncidentStatus(value: unknown): value is IncidentStatus {
  return typeof value === "string" && INCIDENT_STATUSES.includes(value as IncidentStatus);
}

export function isIncidentPriority(value: unknown): value is IncidentPriority {
  return typeof value === "string" && INCIDENT_PRIORITIES.includes(value as IncidentPriority);
}

export function incidentStatusVariant(status: IncidentStatus): "accent" | "warning" | "success" {
  if (status === "resolved") return "success";
  if (status === "investigating") return "warning";
  return "accent";
}

export function incidentPriorityVariant(priority: IncidentPriority): "muted" | "info" | "warning" | "danger" {
  if (priority === "critical") return "danger";
  if (priority === "high") return "warning";
  if (priority === "medium") return "info";
  return "muted";
}
