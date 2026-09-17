"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isIncidentPriority, isIncidentStatus } from "@/lib/incidents";
import { UUID_RE } from "@/lib/workflow-query";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { scheduleSecurityEvent } from "@/lib/notify";

export type IncidentActionResult =
  | { ok: true; id: string }
  | { error: "invalid" | "conflict" | "unavailable" | "REAUTH_REQUIRED" };

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
  revalidatePath("/playback");
  revalidatePath("/retention");
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
      p_description: description ?? undefined,
      p_priority: input.priority,
      p_assignee_id: assigneeId ?? undefined,
      p_alert_id: alertId ?? undefined,
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
      p_description: description ?? "",
      p_status: input.status,
      p_priority: input.priority,
      p_assignee_id: assigneeId ?? undefined,
      p_note: note ?? undefined,
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

export async function attachRecordingToIncidentAction(input: {
  incidentId: string;
  recordingId: string;
  startSec: number;
  endSec: number;
  note?: string;
  legalHold: boolean;
}): Promise<IncidentActionResult> {
  await requireAdmin();
  const note = input.note?.trim() || null;
  if (!UUID_RE.test(input.incidentId) || !UUID_RE.test(input.recordingId) ||
      !Number.isFinite(input.startSec) || !Number.isFinite(input.endSec) ||
      input.startSec < 0 || input.endSec <= input.startSec ||
      input.endSec - input.startSec > 300 || (note?.length ?? 0) > 1000) {
    return { error: "invalid" };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("attach_incident_recording", {
      p_incident_id: input.incidentId,
      p_recording_id: input.recordingId,
      p_clip_start_sec: input.startSec,
      p_clip_end_sec: input.endSec,
      p_note: note ?? undefined,
      p_legal_hold: input.legalHold,
    });
    if (error || !data || !UUID_RE.test(data)) return failed(error);
    refresh(input.incidentId);
    return { ok: true, id: data };
  } catch {
    return { error: "unavailable" };
  }
}

export async function setEvidenceHoldAction(input: {
  incidentId: string;
  evidenceId: string;
  legalHold: boolean;
}): Promise<IncidentActionResult> {
  const ctx = await requireAdmin();
  if (!UUID_RE.test(input.incidentId) || !UUID_RE.test(input.evidenceId)) {
    return { error: "invalid" };
  }
  // A legal hold is the one thing sweep_retention() respects. RELEASING it is
  // the first step of destroying pinned evidence, so it needs the second
  // factor and is pushed to the other admins; applying a hold is the safe
  // direction and stays one click.
  if (input.legalHold === false) {
    const reauth = await ensureFreshReauth(ctx.user.id);
    if (reauth) return reauth;
  }
  try {
    let data: string | null = null;
    let error: { code?: string; message?: string } | null = null;
    if (input.legalHold === false) {
      // Release runs with the service role and an explicit actor: migration
      // 20260917150000 makes the user-callable RPC refuse a release, so a
      // stolen session cannot POST /rest/v1/rpc/set_incident_recording_hold
      // with its own token and skip the step-up above.
      const released = await createServiceClient().rpc("release_incident_recording_hold", {
        p_evidence_id: input.evidenceId,
        p_actor: ctx.user.id,
      });
      data = released.data;
      error = released.error;
      // PGRST202 = function not deployed yet (app ships before the migration).
      // Until then the old RPC still accepts a release; use it so the feature
      // never breaks in the deploy window.
      if (error?.code === "PGRST202") {
        const legacy = await (await createClient()).rpc("set_incident_recording_hold", {
          p_evidence_id: input.evidenceId,
          p_legal_hold: false,
        });
        data = legacy.data;
        error = legacy.error;
      }
    } else {
      const applied = await (await createClient()).rpc("set_incident_recording_hold", {
        p_evidence_id: input.evidenceId,
        p_legal_hold: true,
      });
      data = applied.data;
      error = applied.error;
    }
    if (error || data !== input.evidenceId) return failed(error);
    if (input.legalHold === false) {
      scheduleSecurityEvent({
        action: "EVIDENCE_HOLD_RELEASED",
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        detail: `incident=${input.incidentId} evidence=${input.evidenceId}`,
      });
    }
    refresh(input.incidentId);
    return { ok: true, id: input.evidenceId };
  } catch {
    return { error: "unavailable" };
  }
}
