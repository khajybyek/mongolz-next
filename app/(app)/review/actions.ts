"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import type { ReviewLabel } from "@/lib/database.types";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const LABELS: readonly ReviewLabel[] = ["confirmed", "rejected", "uncertain"];

export async function reviewFaceAction(faceId: string, label: ReviewLabel) {
  const { user } = await requireAdmin();
  if (!UUID_RE.test(faceId) || !LABELS.includes(label)) return;
  const svc = createServiceClient();

  await svc
    .from("faces")
    .update({
      reviewed: true,
      review_label: label,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", faceId);

  await svc.from("audit_log").insert({
    action: "FACE_REVIEW",
    detail: `face=${faceId} label=${label}`,
    user_id: user.id,
    user_email: user.email,
  });

  revalidatePath("/review");
}
