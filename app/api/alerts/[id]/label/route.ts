import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { log } from "@/lib/log";

import type { AlertLabel } from "@/lib/database.types";

const LABELS: readonly AlertLabel[] = ["true_positive", "false_positive", "unknown"];

function parseLabel(v: unknown): AlertLabel | null {
  return typeof v === "string" && (LABELS as readonly string[]).includes(v)
    ? (v as AlertLabel)
    : null;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid alert id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { label?: unknown };
  const label = parseLabel(body.label);
  if (!label) {
    return NextResponse.json({ error: "label must be true_positive | false_positive | unknown" }, { status: 400 });
  }

  const supabase = await createClient();
  // `.select("id")` so a missing (or RLS-hidden) alert is a 404 instead of
  // `{ok:true}` plus an ALERT_LABEL ledger row for a label nobody applied —
  // same contract as the sibling state/note routes.
  const { data: updated, error } = await supabase
    .from("alerts")
    .update({
      label,
      labeled_by: auth.user.id,
      labeled_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    log.error("alert label: update failed", { alert_id: id, code: error.code });
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  await createServiceClient().from("audit_log").insert({
    action: "ALERT_LABEL",
    detail: `${id} → ${label}`,
    user_id: auth.user.id,
    user_email: auth.user.email,
  });

  return NextResponse.json({ ok: true, label });
}
