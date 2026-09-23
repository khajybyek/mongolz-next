import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Buckets the app needs (confirmed against storage.buckets on 2026-09-23).
 * The probe used to list buckets with the admin's user JWT — which sees no
 * row of storage.buckets (no SELECT policy, on purpose) — and so always
 * answered "ok · 0 buckets available".
 */
const EXPECTED_BUCKETS = [
  "alert-screenshots",
  "branding",
  "faces",
  "recordings",
  "revealed",
  "sch-receipts",
  "suspects",
] as const;

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  try {
    const { data, error } = await createServiceClient().storage.listBuckets();
    if (error) throw error;
    const present = new Set((data ?? []).map((b) => b.id));
    const missing = EXPECTED_BUCKETS.filter((id) => !present.has(id));
    if (missing.length) {
      return NextResponse.json({ status: "error", detail: `missing: ${missing.join(", ")}` }, { status: 503 });
    }
    return NextResponse.json({
      status: "ok",
      detail: `${EXPECTED_BUCKETS.length}/${EXPECTED_BUCKETS.length} buckets present`,
    });
  } catch (e) {
    console.error("[health/storage]", e instanceof Error ? e.message : e);
    return NextResponse.json({ status: "error", detail: "Storage unreachable" }, { status: 503 });
  }
}
