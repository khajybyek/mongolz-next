"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { runRetentionSweep } from "@/lib/retention";

// audit_log is deliberately not editable: the ledger is an immutable hash
// chain under legal hold (sweep_retention() reports it as skipped).
const updateSchema = z.object({
  resource: z.enum([
    "recordings",
    "faces",
    "alerts",
    "reveal_jobs",
    "reveal_outputs",
  ]),
  retention_days: z.coerce.number().int().min(1).max(36500),
  enabled: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "on"),
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

export async function updateRetentionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const parsed = updateSchema.safeParse({
    resource: formData.get("resource"),
    retention_days: formData.get("retention_days"),
    enabled: formData.get("enabled") ?? "false",
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid");

  const svc = createServiceClient();
  const { error } = await svc
    .from("retention_policies")
    .update({
      retention_days: parsed.data.retention_days,
      enabled: parsed.data.enabled,
      updated_at: new Date().toISOString(),
      updated_by: ctx.user.id,
    })
    .eq("resource", parsed.data.resource);
  if (error) throw new Error(error.message);

  await audit(
    "RETENTION_POLICY_UPDATE",
    `${parsed.data.resource}: ${parsed.data.retention_days} days, enabled=${parsed.data.enabled}`,
    ctx.user.id,
    ctx.user.email,
  );
  revalidatePath("/retention");
}

export async function runSweepAction(): Promise<void> {
  const ctx = await requireAdmin();
  const svc = createServiceClient();
  const data = await runRetentionSweep(svc);
  await audit(
    "RETENTION_SWEEP_MANUAL",
    `Manual sweep result: ${JSON.stringify(data)}`,
    ctx.user.id,
    ctx.user.email,
  );
  revalidatePath("/retention");
}
