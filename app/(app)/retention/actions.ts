"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { runRetentionSweep } from "@/lib/retention";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { scheduleSecurityEvent } from "@/lib/notify";

type ActionResult = { error: string } | { ok: true };

/**
 * Shrinking retention + a manual sweep destroys recordings, faces and alerts
 * irreversibly, and used to need nothing but a (possibly stolen) admin
 * session — unlike deleting one camera, which asked for the second factor.
 * Both now require a fresh TOTP step-up; the refusal is audited, and every
 * change is pushed to the other admins in real time.
 */
async function stepUp(ctx: { user: { id: string; email: string } }, what: string) {
  const reauth = await ensureFreshReauth(ctx.user.id);
  if (!reauth) return null;
  try {
    await audit("RETENTION_STEP_UP_REQUIRED", what, ctx.user.id, ctx.user.email);
  } catch {
    /* the refusal stands either way */
  }
  return reauth;
}

// audit_log is deliberately not editable: the ledger is an immutable hash
// chain under legal hold (sweep_retention() reports it as skipped).
const updateSchema = z.object({
  resource: z.enum([
    "recordings",
    "faces",
    "alerts",
    "reveal_jobs",
    "reveal_outputs",
    "edge_ingest_events",
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

export async function updateRetentionAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin();
  const reauth = await stepUp(ctx, `policy update (${String(formData.get("resource") ?? "?").slice(0, 40)})`);
  if (reauth) return reauth;
  const parsed = updateSchema.safeParse({
    resource: formData.get("resource"),
    retention_days: formData.get("retention_days"),
    enabled: formData.get("enabled") ?? "false",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid" };

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
  if (error) return { error: "update failed" };

  const detail = `${parsed.data.resource}: ${parsed.data.retention_days} days, enabled=${parsed.data.enabled}`;
  await audit("RETENTION_POLICY_UPDATE", detail, ctx.user.id, ctx.user.email);
  scheduleSecurityEvent({
    action: "RETENTION_POLICY_UPDATE",
    actorId: ctx.user.id,
    actorEmail: ctx.user.email,
    detail,
  });
  revalidatePath("/retention");
  return { ok: true };
}

export async function runSweepAction(): Promise<ActionResult> {
  const ctx = await requireAdmin();
  const reauth = await stepUp(ctx, "manual sweep");
  if (reauth) return reauth;
  const svc = createServiceClient();
  const data = await runRetentionSweep(svc);
  const detail = `Manual sweep result: ${JSON.stringify(data)}`;
  await audit("RETENTION_SWEEP_MANUAL", detail, ctx.user.id, ctx.user.email);
  scheduleSecurityEvent({
    action: "RETENTION_SWEEP_MANUAL",
    actorId: ctx.user.id,
    actorEmail: ctx.user.email,
    detail,
  });
  revalidatePath("/retention");
  return { ok: true };
}
