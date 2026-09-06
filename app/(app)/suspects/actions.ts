"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { mlEmbed } from "@/lib/ml-client";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { vectorParam } from "@/lib/pgvector";

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

  // 3. DB-д бичих
  const { error: dbErr } = await supabase.from("suspects").insert({
    name,
    image_path: path,
    embedding: vectorParam(embedding),
    privacy_tier,
    created_by: user.id,
  });

  if (dbErr) {
    console.error("[suspects] insert:", dbErr.message);
    await supabase.storage.from("suspects").remove([path]).catch(() => undefined);
    return { error: "DB_FAILED" };
  }

  // 4. Audit
  try {
    const svc = createServiceClient();
    await svc.from("audit_log").insert({
      action: "SUSPECT_ADD",
      detail: `Name: ${name}`,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}

  revalidatePath("/suspects");
  return { ok: true };
}

export async function deleteSuspectAction(
  id: string,
): Promise<{ error: string } | { ok: true }> {
  const { user } = await requireAdmin();
  const reauth = await ensureFreshReauth(user.id);
  if (reauth) return reauth;
  if (!id) return { error: "missing id" };

  const supabase = await createClient();

  const { data: s } = await supabase
    .from("suspects")
    .select("image_path, name")
    .eq("id", id)
    .maybeSingle();

  if (s) {
    await supabase.storage.from("suspects").remove([s.image_path]);
  }

  const { error } = await supabase.from("suspects").delete().eq("id", id);
  if (error) return { error: error.message };

  try {
    const svc = createServiceClient();
    await svc.from("audit_log").insert({
      action: "SUSPECT_DELETE",
      detail: s ? `Name: ${s.name}` : `id: ${id}`,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}

  revalidatePath("/suspects");
  return { ok: true };
}
