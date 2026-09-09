"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { canReadRevealOutput, readRevealAuthority } from "@/lib/reveal-authority";
import { mlTriggerReveal, MLError } from "@/lib/ml-client";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { notifyRevealDecision } from "@/lib/notify";

/**
 * 4-eyes reveal decisions. Both actions return a result object (never throw)
 * so the client form can show the reason inline, open the TOTP prompt on
 * REAUTH_REQUIRED, and disable the buttons while pending — a thrown server
 * action used to unmount the whole app shell into global-error.tsx.
 */
export type DecisionResult =
  | { ok: true }
  | { error: "REAUTH_REQUIRED" | "INVALID" | "NOT_FOUND" | "ALREADY_DECIDED" | "SELF" | "ML_FAILED" | "DB"; detail?: string };

const jobIdSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(3).max(500);

async function audit(action: string, detail: string, userId: string, userEmail: string) {
  const svc = createServiceClient();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    await svc.from("audit_log").insert({ action, detail, user_id: userId, user_email: userEmail, ip });
  } catch {}
}

export async function approveRevealAction(jobIdRaw: string): Promise<DecisionResult> {
  const ctx = await requireAdmin();
  // The approver is the party who actually triggers decryption — same
  // step-up as the requester needed to create the job.
  if (await ensureFreshReauth(ctx.user.id)) return { error: "REAUTH_REQUIRED" };
  const parsed = jobIdSchema.safeParse(jobIdRaw);
  if (!parsed.success) return { error: "INVALID" };
  const jobId = parsed.data;

  const svc = createServiceClient();
  const { data: job } = await svc
    .from("reveal_jobs")
    .select("id, status, requested_by, requested_email, recording_id, reveal_level")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) return { error: "NOT_FOUND" };
  if (job.status !== "pending_approval") return { error: "ALREADY_DECIDED" };
  // Authority: approving is what actually triggers decryption, so the approver
  // must be allowed to see the output they are releasing. The page now reads
  // under RLS, but a hand-made request must not get past that.
  const authority = await readRevealAuthority(ctx.user.id);
  if ("error" in authority) return { error: "INVALID" };
  if (!canReadRevealOutput(authority.level, job.reveal_level)) return { error: "NOT_FOUND" };
  // 4-eyes: the approver MUST differ from the requester (also a DB CHECK).
  if (job.requested_by === ctx.user.id) return { error: "SELF" };

  // Compare-and-set on status: two concurrent approvals (or approve+reject)
  // must not both pass — only the transition from pending_approval wins.
  const { data: transitioned, error } = await svc
    .from("reveal_jobs")
    .update({
      status: "queued",
      approved_by: ctx.user.id,
      approved_email: ctx.user.email,
      approved_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "pending_approval")
    .select("id");
  if (error) {
    console.error("[reveal-approvals] approve update:", error.message);
    return { error: "DB" };
  }
  if (!transitioned || transitioned.length === 0) return { error: "ALREADY_DECIDED" };

  // Now that a second admin has approved, actually kick off the ML decrypt.
  // (start/route deliberately does NOT trigger — the 4-eyes gate lives here.)
  try {
    await mlTriggerReveal(job.id);
  } catch (e) {
    const msg = e instanceof MLError ? e.message : "ML service unreachable";
    await svc
      .from("reveal_jobs")
      .update({ status: "failed", error_message: msg })
      .eq("id", job.id);
    await audit(
      "REVEAL_APPROVE_FAILED",
      `job ${job.id} approved but ML trigger failed: ${msg}`,
      ctx.user.id,
      ctx.user.email,
    );
    revalidatePath("/reveal-approvals");
    return { error: "ML_FAILED", detail: msg };
  }

  await audit(
    "REVEAL_APPROVE",
    `job ${job.id} (requested_by=${job.requested_email}) → ML triggered`,
    ctx.user.id,
    ctx.user.email,
  );
  // Tell the requester after the action has returned; best-effort, never
  // affects the DecisionResult.
  after(() =>
    notifyRevealDecision({
      jobId: job.id,
      recordingId: job.recording_id,
      requesterId: job.requested_by,
      requesterEmail: job.requested_email,
      approved: true,
      deciderEmail: ctx.user.email,
    }),
  );
  revalidatePath("/reveal-approvals");
  return { ok: true };
}

export async function rejectRevealAction(jobIdRaw: string, reasonRaw: string): Promise<DecisionResult> {
  const ctx = await requireAdmin();
  if (await ensureFreshReauth(ctx.user.id)) return { error: "REAUTH_REQUIRED" };
  const parsedId = jobIdSchema.safeParse(jobIdRaw);
  const parsedReason = reasonSchema.safeParse(reasonRaw);
  if (!parsedId.success || !parsedReason.success) return { error: "INVALID" };

  const svc = createServiceClient();
  const { data: job } = await svc
    .from("reveal_jobs")
    .select("id, status, requested_by, requested_email, recording_id, reveal_level")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (!job) return { error: "NOT_FOUND" };
  if (job.status !== "pending_approval") return { error: "ALREADY_DECIDED" };
  if (job.requested_by === ctx.user.id) return { error: "SELF" };
  // Rejecting decides an investigation, so it needs the same authority as
  // approving — otherwise a restricted admin can veto work they cannot see.
  const rejectAuthority = await readRevealAuthority(ctx.user.id);
  if ("error" in rejectAuthority) return { error: "INVALID" };
  if (!canReadRevealOutput(rejectAuthority.level, job.reveal_level)) return { error: "NOT_FOUND" };

  const { data: transitioned, error } = await svc
    .from("reveal_jobs")
    .update({
      status: "rejected",
      rejected_by: ctx.user.id,
      rejected_email: ctx.user.email,
      rejected_reason: parsedReason.data,
      rejected_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "pending_approval")
    .select("id");
  if (error) {
    console.error("[reveal-approvals] reject update:", error.message);
    return { error: "DB" };
  }
  if (!transitioned || transitioned.length === 0) return { error: "ALREADY_DECIDED" };

  await audit(
    "REVEAL_REJECT",
    `job ${job.id} reason=${parsedReason.data}`,
    ctx.user.id,
    ctx.user.email,
  );
  after(() =>
    notifyRevealDecision({
      jobId: job.id,
      recordingId: job.recording_id,
      requesterId: job.requested_by,
      requesterEmail: job.requested_email,
      approved: false,
      deciderEmail: ctx.user.email,
      reason: parsedReason.data,
    }),
  );
  revalidatePath("/reveal-approvals");
  return { ok: true };
}
