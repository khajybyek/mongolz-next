/**
 * SCH Esports — pure helpers behind the public submit path.
 *
 * Kept out of app/sch/actions.ts (a "use server" module may only export
 * async functions) so the decisions can be unit-tested without a database.
 */
import { SCH_LIMITS, isSchGame, type SchGame } from "./schema";

/* ─────────────────────────── rate budgets ─────────────────────────── */

/**
 * The registrants are students on one campus, usually behind a single NAT
 * address (dorm / campus Wi-Fi), so a per-IP budget of six would let three
 * classmates register per hour and lock everyone else out. The per-IP
 * ceilings are therefore a multiple of the per-person figure in
 * `SCH_LIMITS`; the per-person guard is the (game, lower(email)) uniqueness
 * on the table, which no budget can bypass.
 */
export const SCH_NAT_FACTOR = 5;

/** Minting a signed receipt upload — its own bucket, so a submit never costs two units. */
export const SCH_PREPARE_LIMIT = {
  action: "SCH_SUBMIT",
  name: "sch_prepare",
  windowSec: 3600,
  max: SCH_LIMITS.submitPerHourPerIp * SCH_NAT_FACTOR,
} as const;

/** Writing the registration rows. */
export const SCH_SUBMIT_LIMIT = {
  action: "SCH_SUBMIT",
  name: "sch_submit",
  windowSec: 3600,
  max: SCH_LIMITS.submitPerHourPerIp * SCH_NAT_FACTOR,
} as const;

/* ─────────────────────────── insert errors ─────────────────────────── */

export type InsertErrorInfo = {
  code?: string | null;
  details?: string | null;
  message?: string | null;
};

export type InsertErrorKind =
  /** (game, lower(email)) already registered — `game` when Postgres named it. */
  | { kind: "duplicate"; game: SchGame | null }
  /** (submission_id, game) already exists — a replay of this very submission. */
  | { kind: "replay" }
  | { kind: "other" };

/**
 * Postgres reports a unique violation as
 * `Key (game, lower(email))=(cs2, a@b.c) already exists.` or, for the
 * replay index, `Key (submission_id, game)=(<uuid>, cs2) already exists.`
 */
export function classifyInsertError(err: InsertErrorInfo | null | undefined): InsertErrorKind {
  if (!err || err.code !== "23505") return { kind: "other" };
  const text = `${err.details ?? ""} ${err.message ?? ""}`;
  if (/\(submission_id,\s*game\)/i.test(text) || /submission_game_idx/i.test(text)) return { kind: "replay" };
  const m = /=\((mobile_legends|cs2|dota2),/.exec(err.details ?? "");
  return { kind: "duplicate", game: m && isSchGame(m[1]) ? m[1] : null };
}

/* ─────────────────────────── replay detection ─────────────────────────── */

/**
 * Rows already stored under a submission id belong to this call when they
 * carry the same e-mail — then the call is a replay (a retried request, a
 * double click) and the original success is returned again. Any other
 * owner means the id collided, which is a conflict.
 */
export function replayOutcome(
  rows: readonly { game: string; email: string }[],
  email: string,
): { kind: "none" } | { kind: "replay"; games: SchGame[] } | { kind: "conflict" } {
  if (rows.length === 0) return { kind: "none" };
  const mine = email.trim().toLowerCase();
  if (!rows.every((r) => r.email.trim().toLowerCase() === mine)) return { kind: "conflict" };
  const games = rows.map((r) => r.game).filter(isSchGame);
  return { kind: "replay", games };
}

/* ─────────────────────────── bank details ─────────────────────────── */

const ACCOUNT_RE = /\d[\d\s-]{6,}\d/;

/**
 * The account number inside a `payment_info` line ("Солонгос данс: 토스뱅크
 * 1001-9949-6201" → "1001-9949-6201"), whitespace stripped so it pastes
 * straight into a banking app. Null when the line has no account-like run.
 */
export function accountNumber(line: string): string | null {
  const m = ACCOUNT_RE.exec(line);
  return m ? m[0].replace(/\s+/g, "") : null;
}
