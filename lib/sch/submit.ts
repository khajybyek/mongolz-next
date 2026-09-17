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

/* ─────────────────────────── rate limit verdict ─────────────────────────── */

export type RateVerdict = "ok" | "limited" | "unavailable";

/**
 * `checkRateLimit()` fails closed when the counter cannot be reached and
 * signals that with `count: -1` (lib/rate-limit.ts). That refusal must not
 * be shown to a registrant as "you personally tried too often — wait an
 * hour": the database is down, their answers are fine, and the honest
 * message is "temporarily unavailable, try again in a moment".
 */
export function rateLimitVerdict(rl: { ok: boolean; count: number } | null | undefined): RateVerdict {
  if (!rl) return "unavailable";
  if (rl.ok) return "ok";
  return rl.count < 0 ? "unavailable" : "limited";
}

/* ─────────────────────────── invalid → form field ─────────────────────────── */

/** Keys of the public form's inline errors that a server-side rejection can name. */
export type SchFieldKey =
  | "full_name" | "email" | "facebook"
  | "games"
  | "ml_rank" | "ml_roles" | "ml_id"
  | "cs2_steam" | "cs2_faceit"
  | "dota_roles" | "dota_rank" | "dota_steam"
  | "receipt";

const PERSON_FIELDS: Record<string, SchFieldKey> = { full_name: "full_name", email: "email", facebook: "facebook" };
const ENTRY_FIELDS: Record<SchGame, Record<string, SchFieldKey>> = {
  mobile_legends: { rank: "ml_rank", roles: "ml_roles", in_game_id: "ml_id" },
  cs2: { steam_url: "cs2_steam", faceit: "cs2_faceit" },
  dota2: { roles: "dota_roles", rank: "dota_rank", steam_url: "dota_steam" },
};

/**
 * Translate zod issue paths from `schSubmissionSchema` into the form's
 * field keys so the registrant sees WHICH answer was rejected instead of a
 * generic "some answers were rejected". `input` is the raw (unvalidated)
 * payload — only `entries[i].game` is read from it, to know which game
 * section an entry issue belongs to. Unknown paths are dropped; the result
 * is de-duplicated and in schema order.
 */
export function invalidFields(
  issues: readonly { path: readonly (string | number)[] }[],
  input: unknown,
): SchFieldKey[] {
  const entries = (input as { entries?: unknown } | null)?.entries;
  const gameAt = (i: number): SchGame | null => {
    const e = Array.isArray(entries) ? (entries[i] as { game?: unknown } | null) : null;
    return e && isSchGame(e.game) ? e.game : null;
  };
  const out = new Set<SchFieldKey>();
  for (const issue of issues) {
    const [head, second, third] = issue.path;
    if (head === "person" && typeof second === "string" && PERSON_FIELDS[second]) out.add(PERSON_FIELDS[second]);
    else if (head === "receipt_path") out.add("receipt");
    else if (head === "entries") {
      if (typeof second !== "number") {
        out.add("games");
        continue;
      }
      const game = gameAt(second);
      const key = game && typeof third === "string" ? ENTRY_FIELDS[game][third] : undefined;
      out.add(key ?? "games");
    }
  }
  return [...out];
}

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
