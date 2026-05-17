"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { mlEmbed } from "@/lib/ml-client";
import { ensureFreshReauth } from "@/lib/auth/step-up";

export async function addSuspectAction(formData: FormData) {
  const { user } = await requireAdmin();
  const reauth = await ensureFreshReauth(user.id);
  if (reauth) {
    return redirect("/suspects?error=REAUTH_REQUIRED");
  }
  const name = String(formData.get("name") ?? "").trim();
  const photo = formData.get("photo");
  const tierRaw = String(formData.get("privacy_tier") ?? "standard");

  // Strict enum validation — anything outside the allowed values is
  // rejected with a clear error instead of silently coerced to "standard".
  const ALLOWED_TIERS = ["vip", "standard", "relaxed"] as const;
  if (!ALLOWED_TIERS.includes(tierRaw as (typeof ALLOWED_TIERS)[number])) {
    return redirect(
      `/suspects?error=${encodeURIComponent("invalid privacy_tier")}`,
    );
  }
  const privacy_tier = tierRaw as "vip" | "standard" | "relaxed";

  if (!name || !(photo instanceof File) || photo.size === 0) {
    return redirect("/suspects?error=missing-fields");
  }

  const buffer = Buffer.from(await photo.arrayBuffer());

  // 1. Python ML service-аас ArcFace embedding (512-dim) тооцоолох
  let embedding: number[];
  try {
    embedding = await mlEmbed(buffer);
  } catch {
    return redirect(
      `/suspects?error=${encodeURIComponent("ML service-с embedding авсангүй")}`
    );
  }

  // 2. Storage-д зураг upload (admin RLS-аар)
  const supabase = await createClient();
  const ext = photo.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("suspects")
    .upload(path, buffer, { contentType: photo.type });

  if (upErr) return redirect(`/suspects?error=${encodeURIComponent(upErr.message)}`);

  // 3. DB-д бичих
  const { error: dbErr } = await supabase.from("suspects").insert({
    name,
    image_path: path,
    embedding: embedding as never,
    privacy_tier,
    created_by: user.id,
  });

  if (dbErr) return redirect(`/suspects?error=${encodeURIComponent(dbErr.message)}`);

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
