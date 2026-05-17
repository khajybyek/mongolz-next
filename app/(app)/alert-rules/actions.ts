"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureFreshReauth } from "@/lib/auth/step-up";

const ruleSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().optional().default(true),
  suspect_id: z.string().uuid().optional().nullable(),
  camera_id: z.string().uuid().optional().nullable(),
  min_similarity: z.number().min(0).max(1).default(0.45),
  dedup_window_sec: z.number().int().min(0).max(86400).default(300),
  burst_count: z.number().int().min(1).max(100).default(1),
  burst_window_sec: z.number().int().min(1).max(3600).default(60),
  quiet_from: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  quiet_to: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
});

function pickFormValue(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export async function createRuleAction(formData: FormData) {
  const ctx = await requireAdmin();

  const parsed = ruleSchema.safeParse({
    name: pickFormValue(formData, "name") ?? "",
    enabled: pickFormValue(formData, "enabled") === "on",
    suspect_id: pickFormValue(formData, "suspect_id"),
    camera_id: pickFormValue(formData, "camera_id"),
    min_similarity: Number(formData.get("min_similarity") ?? 0.45),
    dedup_window_sec: Number(formData.get("dedup_window_sec") ?? 300),
    burst_count: Number(formData.get("burst_count") ?? 1),
    burst_window_sec: Number(formData.get("burst_window_sec") ?? 60),
    quiet_from: pickFormValue(formData, "quiet_from"),
    quiet_to: pickFormValue(formData, "quiet_to"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("alert_rules").insert({
    ...parsed.data,
    created_by: ctx.user.id,
  });
  if (error) return { error: error.message };

  await createServiceClient().from("audit_log").insert({
    action: "ALERT_RULE_CREATE",
    detail: parsed.data.name,
    user_id: ctx.user.id,
    user_email: ctx.user.email,
  });

  revalidatePath("/alert-rules");
  return { ok: true };
}

export async function toggleRuleAction(id: string, enabled: boolean) {
  const ctx = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("alert_rules")
    .update({ enabled })
    .eq("id", id);
  if (error) return { error: error.message };

  await createServiceClient().from("audit_log").insert({
    action: enabled ? "ALERT_RULE_ENABLE" : "ALERT_RULE_DISABLE",
    detail: id,
    user_id: ctx.user.id,
    user_email: ctx.user.email,
  });

  revalidatePath("/alert-rules");
  return { ok: true };
}

export async function deleteRuleAction(id: string) {
  const ctx = await requireAdmin();
  const reauth = await ensureFreshReauth(ctx.user.id);
  if (reauth) return reauth;
  const supabase = await createClient();
  const { error } = await supabase.from("alert_rules").delete().eq("id", id);
  if (error) return { error: error.message };

  await createServiceClient().from("audit_log").insert({
    action: "ALERT_RULE_DELETE",
    detail: id,
    user_id: ctx.user.id,
    user_email: ctx.user.email,
  });

  revalidatePath("/alert-rules");
  return { ok: true };
}
