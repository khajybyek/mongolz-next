"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import type { ReviewLabel } from "@/lib/database.types";
import type { RpcCapableClient } from "@/lib/metrics";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const LABELS: readonly ReviewLabel[] = ["confirmed", "rejected", "uncertain"];

export type ReviewResult = { ok: true } | { error: "invalid" | "conflict" | "unavailable" };
export async function reviewFaceAction(faceId: string, label: ReviewLabel): Promise<ReviewResult> {
  await requireAdmin();
  if (!UUID_RE.test(faceId) || !LABELS.includes(label)) return { error: "invalid" };
  try {
    const client = await createClient() as unknown as RpcCapableClient;
    // The caller JWT reaches Postgres: admin/MFA, update and audit are one transaction.
    const { data, error } = await client.rpc("review_face", { p_face_id: faceId, p_label: label });
    if (error) return { error: error.code === "P0002" ? "conflict" : "unavailable" };
    if (data !== faceId) return { error: "unavailable" };
  } catch {
    return { error: "unavailable" };
  }
  revalidatePath("/review");
  return { ok: true };
}
