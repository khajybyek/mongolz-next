/**
 * SCH Esports — registrations CSV export (admin + second factor).
 *
 * `?game=` narrows to one game. Every column the organiser console shows is
 * here, plus the reference code and `has_receipt` — never the storage path:
 * the receipt itself is only reachable through the audited viewer route.
 * `has_receipt` is "yes" for an uploaded receipt and for an imported row's
 * trusted Drive link alike (the same rule the organiser console applies).
 * The body starts with a UTF-8 BOM so Excel decodes Cyrillic/Hangul names.
 * Cells go through `csvCell()` (formula neutralisation — names and ids are
 * player-typed text). One `SCH_REGISTRATIONS_EXPORTED` ledger row per export.
 * The last three columns describe sheet imports: `source` (web / import),
 * `receipt_url` (the external Drive link an imported row carries — also
 * player-supplied, so it is neutralised like the rest) and `submitted_at`.
 * New columns are only ever appended: organisers keep spreadsheets keyed on
 * the column order.
 */

import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";
import { log } from "@/lib/log";
import { isAuthErr, requireSchOrganiserApi } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { csvCell } from "@/lib/csv";
import { SCH_GAME_LABEL, isSchGame, referenceCode } from "@/lib/sch/schema";
import { isTrustedReceiptUrl } from "@/lib/sch/import";

const ROW_CAP = 5000;
/** Excel only reads a CSV as UTF-8 when it starts with a byte-order mark. */
const UTF8_BOM = "\uFEFF";

const HEADER = [
  "id",
  "reference",
  "submission_id",
  "game",
  "full_name",
  "email",
  "facebook",
  "phone",
  "in_game_id",
  "rank_label",
  "rank_score",
  "roles",
  "premier_rank",
  "faceit",
  "status",
  "paid_at",
  "checked_in_at",
  "team",
  "notes",
  "has_receipt",
  "created_at",
  "source",
  "receipt_url",
  "submitted_at",
] as const;

export async function GET(request: NextRequest) {
  const auth = await requireSchOrganiserApi();
  if (isAuthErr(auth)) return auth.error;

  const gameParam = request.nextUrl.searchParams.get("game");
  if (gameParam !== null && gameParam !== "" && gameParam !== "all" && !isSchGame(gameParam)) {
    return NextResponse.json({ error: "invalid game" }, { status: 400 });
  }
  const game = isSchGame(gameParam) ? gameParam : null;

  const supabase = await createClient();
  let query = supabase
    .from("sch_registrations")
    .select(
      "id, submission_id, game, full_name, email, facebook, phone, in_game_id, rank_label, rank_score, roles, answers, status, paid_at, checked_in_at, notes, receipt_path, created_at, source, receipt_url, submitted_at, team:sch_teams(name)",
    )
    .order("game", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(ROW_CAP);
  if (game) query = query.eq("game", game);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const rows = (data ?? []).map((r) => {
    const answers = r.answers && typeof r.answers === "object" && !Array.isArray(r.answers)
      ? (r.answers as Record<string, unknown>)
      : {};
    const team = Array.isArray(r.team) ? r.team[0] : r.team;
    const cells: Record<(typeof HEADER)[number], unknown> = {
      id: r.id,
      reference: referenceCode(r.submission_id),
      submission_id: r.submission_id,
      game: isSchGame(r.game) ? SCH_GAME_LABEL[r.game] : r.game,
      full_name: r.full_name,
      email: r.email,
      facebook: r.facebook,
      phone: r.phone,
      in_game_id: r.in_game_id,
      rank_label: r.rank_label,
      rank_score: r.rank_score,
      roles: (r.roles ?? []).join(" | "),
      premier_rank: typeof answers.premier_rank === "string" ? answers.premier_rank : "",
      faceit: typeof answers.faceit === "string" ? answers.faceit : "",
      status: r.status,
      paid_at: r.paid_at,
      checked_in_at: r.checked_in_at,
      team: team?.name ?? "",
      notes: r.notes,
      has_receipt:
        r.receipt_path || (typeof r.receipt_url === "string" && isTrustedReceiptUrl(r.receipt_url)) ? "yes" : "no",
      created_at: r.created_at,
      source: r.source,
      receipt_url: r.receipt_url,
      submitted_at: r.submitted_at,
    };
    return HEADER.map((h) => csvCell(cells[h])).join(",");
  });

  await logExport(game ?? "all", rows.length, auth.user, request);

  const csv = UTF8_BOM + [HEADER.join(","), ...rows].join("\n") + "\n";
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="sch-registrations-${game ?? "all"}-${stamp}.csv"`,
    },
  });
}

async function logExport(
  game: string,
  rows: number,
  user: { id: string; email: string },
  request: NextRequest,
): Promise<void> {
  try {
    // `audit_log.ip` is inet: an unparsable header value would reject the
    // whole ledger row, so only a real address is stored (as the receipt
    // viewer route does).
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ip = isIP(forwarded) ? forwarded : null;
    const { error } = await createServiceClient().from("audit_log").insert({
      action: "SCH_REGISTRATIONS_EXPORTED",
      detail: `game=${game} rows=${rows}`,
      user_id: user.id,
      user_email: user.email,
      ip,
    });
    if (error) log.error("sch export audit row rejected", { error: error.message });
  } catch (err) {
    // Best effort — the export already happened — but never silently.
    log.exception("sch export audit row failed", err);
  }
}
