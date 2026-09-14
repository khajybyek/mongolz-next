"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isIncidentPriority, isIncidentStatus } from "@/lib/incidents";
import { UUID_RE } from "@/lib/workflow-query";

export type IncidentActionResult =
  | { ok: true; id: string }
  | { error: "invalid" | "conflict" | "unavailable" };

function nullableUuid(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && UUID_RE.test(value) ? value : undefined;
}

function failed(error: { code?: string } | null): IncidentActionResult {
  if (error?.code === "40001") return { error: "conflict" };
  if (error?.code === "22023" || error?.code === "P0002") return { error: "invalid" };
  return { error: "unavailable" };
}

function refresh(id?: string) {
  revalidatePath("/incidents");
  if (id) revalidatePath(`/incidents/${id}`);
  revalidatePath("/alerts");
  revalidatePath("/search");
}

export async function createIncidentAction(input: {
  title: string;
  description?: string;
  priority: string;
  assigneeId?: string | null;
  alertId?: string | null;
}): Promise<IncidentActionResult> {
  await requireAdmin();
  const title = input.title?.trim();
  const description = input.description?.trim() || null;
  const assigneeId = nullableUuid(input.assigneeId);
  const alertId = nullableUuid(input.alertId);
  if (!title || title.length < 3 || title.length > 160 || (description?.length ?? 0) > 2000 ||
      !isIncidentPriority(input.priority) || assigneeId === undefined || alertId === undefined) {
    return { error: "invalid" };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_incident", {
      p_title: title,
      p_description: description,
      p_priority: input.priority,
      p_assignee_id: assigneeId,
      p_alert_id: alertId,
    });
    if (error || !data || !UUID_RE.test(data)) return failed(error);
    refresh(data);
    return { ok: true, id: data };
  } catch {
    return { error: "unavailable" };
  }
}

export async function updateIncidentAction(input: {
  id: string;
  expectedUpdatedAt: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  assigneeId?: string | null;
  note?: string;
}): Promise<IncidentActionResult> {
  await requireAdmin();
  const title = input.title?.trim();
  const description = input.description?.trim() || null;
  const note = input.note?.trim() || null;
  const assigneeId = nullableUuid(input.assigneeId);
  if (!UUID_RE.test(input.id) || !title || title.length < 3 || title.length > 160 ||
      !Number.isFinite(Date.parse(input.expectedUpdatedAt)) || (description?.length ?? 0) > 2000 ||
      (note?.length ?? 0) > 2000 || !isIncidentStatus(input.status) ||
      !isIncidentPriority(input.priority) || assigneeId === undefined) {
    return { error: "invalid" };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_incident", {
      p_incident_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_title: title,
      p_description: description,
      p_status: input.status,
      p_priority: input.priority,
      p_assignee_id: assigneeId,
      p_note: note,
    });
    if (error || data !== input.id) return failed(error);
    refresh(input.id);
    return { ok: true, id: input.id };
  } catch {
    return { error: "unavailable" };
  }
}

async function attach(
  kind: "alert" | "face",
  incidentId: string,
  evidenceId: string,
): Promise<IncidentActionResult> {
  await requireAdmin();
  if (!UUID_RE.test(incidentId) || !UUID_RE.test(evidenceId)) return { error: "invalid" };
  try {
    const supabase = await createClient();
    const response = kind === "alert"
      ? await supabase.rpc("attach_incident_alert", { p_incident_id: incidentId, p_alert_id: evidenceId })
      : await supabase.rpc("attach_incident_face", { p_incident_id: incidentId, p_face_id: evidenceId });
    if (response.error || response.data !== incidentId) return failed(response.error);
    refresh(incidentId);
    return { ok: true, id: incidentId };
  } catch {
    return { error: "unavailable" };
  }
}

export async function attachAlertToIncidentAction(incidentId: string, alertId: string) {
  return attach("alert", incidentId, alertId);
}

export async function attachFaceToIncidentAction(incidentId: string, faceId: string) {
  return attach("face", incidentId, faceId);
}
