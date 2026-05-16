"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";

const approveSchema = z.object({
  job_id: z.string().uuid(),
});

const rejectSchema = z.object({
  job_id: z.string().uuid(),
  reason: z.string().min(3).max(500),
});

async function audit(action: string, detail: string, userId: string, userEmail: string) {
  const svc = createServiceClient();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await svc.from("audit_log").insert({
    action,
    detail,
    user_id: userId,
    user_email: userEmail,
    ip,
  });
}

export async function approveRevealAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const parsed = approveSchema.safeParse({ job_id: formData.get("job_id") });
  if (!parsed.success) throw new Error("Invalid id");

  const svc = createServiceClient();
  const { data: job } = await svc
    .from("reveal_jobs")
    .select("id, status, requested_by, requested_email")
    .eq("id", parsed.data.job_id)
    .single();

  if (!job) throw new Error("Reveal job not found");
  if (job.status !== "pending_approval") {
    throw new Error(`Cannot approve: status is ${job.status}`);
  }

  // 4-eyes: the approver MUST differ from the requester
  if (job.requested_by === ctx.user.id) {
    throw new Error(
      "4-eyes principle: another admin must approve. You requested this job.",
    );
  }

  const { error } = await svc
    .from("reveal_jobs")
    .update({
      status: "queued",
      approved_by: ctx.user.id,
      approved_email: ctx.user.email,
      approved_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  if (error) throw new Error(error.message);

  await audit(
    "REVEAL_APPROVE",
    `job ${job.id} (requested_by=${job.requested_email})`,
    ctx.user.id,
    ctx.user.email,
  );
  revalidatePath("/reveal-approvals");
}

export async function rejectRevealAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const parsed = rejectSchema.safeParse({
    job_id: formData.get("job_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid");

  const svc = createServiceClient();
  const { data: job } = await svc
    .from("reveal_jobs")
    .select("id, status, requested_by, requested_email")
    .eq("id", parsed.data.job_id)
    .single();
  if (!job) throw new Error("Reveal job not found");
  if (job.status !== "pending_approval") {
    throw new Error(`Cannot reject: status is ${job.status}`);
  }
  if (job.requested_by === ctx.user.id) {
    throw new Error(
      "4-eyes principle: another admin must decide. You requested this job.",
    );
  }

  const { error } = await svc
    .from("reveal_jobs")
    .update({
      status: "rejected",
      rejected_by: ctx.user.id,
      rejected_email: ctx.user.email,
      rejected_reason: parsed.data.reason,
      rejected_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  if (error) throw new Error(error.message);

  await audit(
    "REVEAL_REJECT",
    `job ${job.id} reason=${parsed.data.reason}`,
    ctx.user.id,
    ctx.user.email,
  );
  revalidatePath("/reveal-approvals");
}
