"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { mlEmbed } from "@/lib/ml-client";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { vectorParam } from "@/lib/pgvector";
import { getT } from "@/lib/i18n/server";
import { log } from "@/lib/log";
import { scheduleSecurityEvent } from "@/lib/notify";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Row writes go through the service role after requireAdmin() + TOTP step-up:
// migration 20260923150000 revokes INSERT/UPDATE/DELETE on public.suspects
// from `authenticated`, so a stolen session cannot rewrite the watchlist
// through PostgREST without the step-up, the audit row and the notice.

/**
 * Add a suspect: ArcFace embedding via the ML service + photo upload + row.
 * Returns a result object (the form is a client component that shows the
 * error inline and opens the TOTP prompt on REAUTH_REQUIRED). It used to
 * redirect to /suspects?error=… which the page never rendered, so a stale
 * step-up made the form fail silently.
 */
export type AddSuspectResult =
  | { ok: true }
  | { error: "REAUTH_REQUIRED" | "MISSING" | "INVALID_TIER" | "ML_FAILED" | "UPLOAD_FAILED" | "DB_FAILED" };

export async function addSuspectAction(formData: FormData): Promise<AddSuspectResult> {
  const { user } = await requireAdmin();
  const reauth = await ensureFreshReauth(user.id);
  if (reauth) return { error: "REAUTH_REQUIRED" };
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const photo = formData.get("photo");
  const tierRaw = String(formData.get("privacy_tier") ?? "standard");

  // Strict enum validation — anything outside the allowed values is
  // rejected with a clear error instead of silently coerced to "standard".
  const ALLOWED_TIERS = ["vip", "standard", "relaxed"] as const;
  if (!ALLOWED_TIERS.includes(tierRaw as (typeof ALLOWED_TIERS)[number])) {
    return { error: "INVALID_TIER" };
  }
  const privacy_tier = tierRaw as "vip" | "standard" | "relaxed";

  if (!name || !(photo instanceof File) || photo.size === 0 || photo.size > 10 * 1024 * 1024) {
    return { error: "MISSING" };
  }

  const buffer = Buffer.from(await photo.arrayBuffer());

  // 1. Python ML service-аас ArcFace embedding (512-dim) тооцоолох
  let embedding: number[];
  try {
    embedding = await mlEmbed(buffer);
  } catch {
    return { error: "ML_FAILED" };
  }

  // 2. Storage-д зураг upload (admin RLS-аар)
  const supabase = await createClient();
  const extRaw = photo.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const ext = /^(jpe?g|png|webp)$/.test(extRaw) ? extRaw : "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("suspects")
    .upload(path, buffer, { contentType: photo.type || "image/jpeg" });

  if (upErr) {
    console.error("[suspects] upload:", upErr.message);
    return { error: "UPLOAD_FAILED" };
  }

  // 3. DB-д бичих (service role — see the note at the top of the file)
  const svc = createServiceClient();
  const { data: inserted, error: dbErr } = await svc
    .from("suspects")
    .insert({
      name,
      image_path: path,
      embedding: vectorParam(embedding),
      privacy_tier,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (dbErr || !inserted) {
    console.error("[suspects] insert:", dbErr?.message);
    await supabase.storage.from("suspects").remove([path]).catch(() => undefined);
    return { error: "DB_FAILED" };
  }

  // 4. Audit — ids only, never the person's name.
  try {
    await svc.from("audit_log").insert({
      action: "SUSPECT_ADD",
      detail: `suspect_id=${inserted.id} tier=${privacy_tier}`,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}

  revalidatePath("/suspects");
  return { ok: true };
}

/**
 * Remove a suspect from the watchlist (admin + TOTP step-up).
 *
 * Order matters: the row goes first and the enrolment photo only after the
 * delete succeeded, so a failed delete never leaves a suspect without a photo.
 * Alerts for the suspect are NOT deleted once migration 20260923150000 is
 * applied: alerts.suspect_id becomes ON DELETE SET NULL (it used to CASCADE,
 * silently wiping alert history, TP/FP labels and incident links). The audit
 * row records how many alerts referenced the suspect; other admins are told.
 */
export async function deleteSuspectAction(
  id: string,
): Promise<{ error: string } | { ok: true }> {
  const { user } = await requireAdmin();
  const reauth = await ensureFreshReauth(user.id);
  if (reauth) return reauth;
  const { t } = await getT();
  if (!UUID_RE.test(id)) return { error: t("suspect_delete_failed") };

  const svc = createServiceClient();

  const { data: s, error: readErr } = await svc
    .from("suspects")
    .select("image_path")
    .eq("id", id)
    .maybeSingle();
  if (readErr) {
    log.error("suspect delete: load failed", { suspect_id: id, code: readErr.code });
    return { error: t("suspect_delete_failed") };
  }
  // Already gone (double click, another admin): nothing left to do.
  if (!s) {
    revalidatePath("/suspects");
    return { ok: true };
  }

  const { count: alertCount } = await svc
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("suspect_id", id);

  const { data: deleted, error } = await svc
    .from("suspects")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    log.error("suspect delete: delete failed", { suspect_id: id, code: error.code });
    return { error: t("suspect_delete_failed") };
  }
  if (!deleted?.length) {
    revalidatePath("/suspects");
    return { ok: true };
  }

  if (s.image_path) {
    const { error: rmErr } = await svc.storage.from("suspects").remove([s.image_path]);
    // The row is gone; an orphaned photo in the private bucket is harmless.
    if (rmErr) log.warn("suspect delete: photo not removed", { suspect_id: id });
  }

  // Ids and counts only — never the person's name.
  const detail = `suspect_id=${id} alerts=${alertCount ?? "unknown"}`;
  try {
    await svc.from("audit_log").insert({
      action: "SUSPECT_DELETE",
      detail,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}
  scheduleSecurityEvent({
    action: "SUSPECT_DELETE",
    actorId: user.id,
    actorEmail: user.email,
    detail,
  });

  revalidatePath("/suspects");
  return { ok: true };
}
