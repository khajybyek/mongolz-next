import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ALERT_STATES, asAlertState, auditActionFor, canTransition } from "@/lib/alerts";
import { log } from "@/lib/log";

import type { TablesUpdate } from "@/lib/database.types";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const schema = z.object({
  state: z.enum(ALERT_STATES),
  note: z.string().max(500).optional(),
});

/**
 * Alert workflow transition (new → acknowledged → closed, reopen → new).
 * Admin-only; the TP/FP label endpoint next door is a separate concept.
 */
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

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }
  const to = parsed.data.state;
  // Empty / whitespace-only notes are stored as NULL so the UI can treat
  // "no note" uniformly; an omitted field leaves the existing note alone.
  const note = parsed.data.note === undefined ? undefined : parsed.data.note.trim() || null;

  const service = createServiceClient();
  const { data: alert, error: loadErr } = await service
    .from("alerts")
    .select("id, state, suspect_name, acknowledged_at")
    .eq("id", id)
    .maybeSingle();

  if (loadErr) {
    log.error("alert state: load failed", { alert_id: id, code: loadErr.code });
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
  if (!alert) {
    return NextResponse.json({ error: "alert not found" }, { status: 404 });
  }

  const from = asAlertState(alert.state);
  if (!canTransition(from, to)) {
    return NextResponse.json({ error: "invalid transition", from, to }, { status: 409 });
  }

  const now = new Date().toISOString();
  const patch: TablesUpdate<"alerts"> = { state: to };
  if (to === "acknowledged") {
    patch.acknowledged_by = auth.user.id;
    patch.acknowledged_at = now;
  } else if (to === "closed") {
    patch.closed_by = auth.user.id;
    patch.closed_at = now;
    // Closing straight from `new` implies acknowledgement by the same person.
    if (!alert.acknowledged_at) {
      patch.acknowledged_by = auth.user.id;
      patch.acknowledged_at = now;
    }
  } else {
    // Reopen keeps acknowledged_* as history; only the closure is undone.
    patch.closed_by = null;
    patch.closed_at = null;
  }
  if (note !== undefined) patch.note = note;

  // Compare-and-set on the state we read: two admins acting on the same row
  // at once must not both succeed (the loser gets a 409 and refreshes).
  const { data: updated, error: updErr } = await service
    .from("alerts")
    .update(patch)
    .eq("id", id)
    .eq("state", from)
    .select("id")
    .maybeSingle();

  if (updErr) {
    log.error("alert state: update failed", { alert_id: id, code: updErr.code });
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "alert changed concurrently" }, { status: 409 });
  }

  await service.from("audit_log").insert({
    action: auditActionFor(from, to) ?? "ALERT_STATE",
    detail: `${id} · ${alert.suspect_name} · ${from} → ${to}${note ? " · note" : ""}`,
    user_id: auth.user.id,
    user_email: auth.user.email,
  });

  return NextResponse.json({ ok: true, state: to });
}
