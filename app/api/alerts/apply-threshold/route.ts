import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * Active learning → alert-rule floor.
 *
 * What this endpoint used to claim, and why that was wrong
 * -------------------------------------------------------
 * The button said "apply threshold" and wrote `alert_rules.min_similarity`,
 * which reads like a detection filter. It is not one. `min_similarity` is the
 * predicate that decides **which rule applies** to a match
 * (`ml-service/storage.py::_select_alert_rule` selects enabled rules with
 * `min_similarity <= similarity`, most specific first). The alert itself is
 * created either way — a match below every rule's floor is inserted with
 * `rule_id = NULL`, so it is grouped only by the ML service's default dedup
 * window and gets **no burst smoothing and no quiet hours**. So raising the
 * "threshold" pushed exactly the weak matches the operator wanted suppressed
 * out of the rule that was supposed to be smoothing them.
 *
 * Making it a real filter is not something this side of the system can do:
 * alerts are only ever created by the ML pipeline, whose detection gate is
 * the module constant `ALERT_THRESHOLD` in ml-service/recording_pipeline.py.
 * There is no per-suspect gate in the schema and no web code path that
 * creates alerts. So the control is now labelled as what it actually is — a
 * per-suspect rule floor — and the response carries the consequence
 * (`above_detection_gate`, `uncovered_band`) so the UI can state it before
 * and after the write instead of implying a filter.
 */

/**
 * Mirrors `ALERT_THRESHOLD` in ml-service/recording_pipeline.py — the real
 * gate below which no alert is ever created. Kept here so the UI can explain
 * the band a rule floor leaves uncovered; change both together.
 */
const ML_DETECTION_GATE = 0.45;

/** Rules this endpoint owns. Operator-authored rules are never rewritten. */
const RULE_NAME_PREFIX = "auto-tune:";

const schema = z.object({
  suspect_id: z.guid(),
  threshold: z.number().min(0).max(1),
});

interface RuleFloor {
  suspect_id: string | null;
  rule_id: string;
  name: string;
  min_similarity: number;
  enabled: boolean;
  /** true when this endpoint created the rule (name starts with auto-tune:). */
  managed: boolean;
}

/**
 * The band between the ML detection gate and a rule floor: matches that land
 * in it still raise alerts, but no longer match this rule — they fall back to
 * the service's default dedup window and lose this rule's burst smoothing and
 * quiet hours. Empty when the floor is at or below the gate.
 */
function uncoveredBand(floor: number, gate = ML_DETECTION_GATE): [number, number] | null {
  return floor > gate ? [gate, floor] : null;
}

/** Current floors, so the card can show the truth before anyone clicks. */
export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alert_rules")
    .select("id, name, suspect_id, camera_id, min_similarity, enabled")
    .is("camera_id", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const floors: RuleFloor[] = rows
    .filter((r) => r.suspect_id !== null)
    .map((r) => ({
      suspect_id: r.suspect_id,
      rule_id: r.id,
      name: r.name,
      min_similarity: Number(r.min_similarity),
      enabled: r.enabled,
      managed: r.name.startsWith(RULE_NAME_PREFIX),
    }));

  // The catch-all rule a match falls through to when no suspect rule matches.
  const globalRule = rows.find((r) => r.suspect_id === null && r.enabled);

  return NextResponse.json({
    detection_gate: ML_DETECTION_GATE,
    global_floor: globalRule ? Number(globalRule.min_similarity) : null,
    floors,
  });
}

/**
 * Set (or create) the suspect's rule floor from the F1-optimal suggestion.
 * Idempotent — re-running updates the rule this endpoint created.
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

  const { data: susp, error: suspErr } = await supabase
    .from("suspects")
    .select("id, name")
    .eq("id", suspect_id)
    .maybeSingle();

  if (suspErr) return NextResponse.json({ error: suspErr.message }, { status: 500 });
  if (!susp) return NextResponse.json({ error: "suspect not found" }, { status: 404 });

  // `maybeSingle()` here used to raise PGRST116 as soon as two auto-tune rules
  // existed for one suspect (a duplicate is easy to create by hand), and the
  // route then silently inserted a third. Take the oldest and update it.
  const { data: existingRows, error: findErr } = await supabase
    .from("alert_rules")
    .select("id, name")
    .eq("suspect_id", suspect_id)
    .is("camera_id", null)
    .ilike("name", `${RULE_NAME_PREFIX}%`)
    .order("created_at", { ascending: true })
    .limit(1);

  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
  const existing = existingRows?.[0] ?? null;

  const name = `${RULE_NAME_PREFIX} ${susp.name ?? suspect_id.slice(0, 8)}`.slice(0, 120);

  let ruleId: string;
  if (existing) {
    const { data, error } = await supabase
      .from("alert_rules")
      .update({ min_similarity: threshold, enabled: true, name })
      .eq("id", existing.id)
      .select("id")
      .maybeSingle();
    // RLS refusing the update returns 0 rows and no error — that must not be
    // reported to the operator as a successful apply.
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: "rule update was refused" }, { status: 403 });
    ruleId = data.id;
  } else {
    const { data, error } = await supabase
      .from("alert_rules")
      .insert({
        name,
        enabled: true,
        suspect_id,
        camera_id: null,
        min_similarity: threshold,
        dedup_window_sec: 300,
        burst_count: 1,
        burst_window_sec: 60,
        created_by: ctx.user.id,
      })
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: "rule insert was refused" }, { status: 403 });
    ruleId = data.id;
  }

  const band = uncoveredBand(threshold);

  try {
    await createServiceClient()
      .from("audit_log")
      .insert({
        action: existing ? "ALERT_RULE_FLOOR_UPDATE" : "ALERT_RULE_FLOOR_CREATE",
        detail: JSON.stringify({
          suspect: susp.name ?? suspect_id,
          rule_id: ruleId,
          min_similarity: threshold,
          // Recorded because it is the operationally interesting part: these
          // matches still alert, just outside this rule's dedup/quiet hours.
          uncovered_band: band,
        }),
        user_id: ctx.user.id,
        user_email: ctx.user.email,
      });
  } catch {}

  return NextResponse.json({
    ok: true,
    effect: "rule_floor",
    rule_id: ruleId,
    min_similarity: threshold,
    updated: Boolean(existing),
    detection_gate: ML_DETECTION_GATE,
    above_detection_gate: threshold > ML_DETECTION_GATE,
    uncovered_band: band,
  });
}
