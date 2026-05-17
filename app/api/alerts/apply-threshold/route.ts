import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const schema = z.object({
  suspect_id: z.string().uuid(),
  threshold: z.number().min(0).max(1),
});

/**
 * Auto-tune: applies an active-learning-suggested threshold by
 * upserting an alert_rule for the given suspect. Idempotent —
 * re-running updates the existing rule.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const ctx = auth;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  const { suspect_id, threshold } = parsed.data;
  const supabase = await createClient();

  // Look for an existing per-suspect, all-camera rule we previously created
  const RULE_NAME_PREFIX = "auto-tune:";
  const { data: existing } = await supabase
    .from("alert_rules")
    .select("id, name")
    .eq("suspect_id", suspect_id)
    .is("camera_id", null)
    .ilike("name", `${RULE_NAME_PREFIX}%`)
    .maybeSingle();

  const { data: susp } = await supabase
    .from("suspects")
    .select("name")
    .eq("id", suspect_id)
    .single();

  const name = `${RULE_NAME_PREFIX} ${susp?.name ?? suspect_id.slice(0, 8)}`.slice(0, 120);

  if (existing) {
    const { error } = await supabase
      .from("alert_rules")
      .update({ min_similarity: threshold, enabled: true, name })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await supabase.from("alert_rules").insert({
      name,
      enabled: true,
      suspect_id,
      camera_id: null,
      min_similarity: threshold,
      dedup_window_sec: 300,
      burst_count: 1,
      burst_window_sec: 60,
      created_by: ctx.user.id,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  try {
    await createServiceClient().from("audit_log").insert({
      action: existing ? "AUTOTUNE_UPDATE" : "AUTOTUNE_CREATE",
      detail: `${susp?.name ?? suspect_id} → ${threshold.toFixed(2)}`,
      user_id: ctx.user.id,
      user_email: ctx.user.email,
    });
  } catch {}

  return NextResponse.json({ ok: true, threshold, updated: Boolean(existing) });
}
