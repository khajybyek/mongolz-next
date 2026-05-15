"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";

export async function reviewFaceAction(faceId: string, label: "confirmed" | "rejected" | "uncertain") {
  const { user } = await requireAdmin();
  const svc = createServiceClient();

  await svc
    .from("faces")
    .update({ reviewed: true, review_label: label, reviewed_by: user.id })
    .eq("id", faceId);

  await svc.from("audit_log").insert({
    action: "FACE_REVIEW",
    detail: `face=${faceId} label=${label}`,
    user_id: user.id,
    user_email: user.email,
  });

  revalidatePath("/review");
}
