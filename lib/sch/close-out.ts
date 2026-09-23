/**
 * SCH Esports — post-event close-out (pure helpers).
 *
 * The consent text promises the registrants' data is used only to organise
 * the tournament. After the last match the organiser console purges it:
 * receipt images, registrations and teams. These helpers decide WHEN that is
 * allowed, so the purge cannot be triggered while the tournament still runs.
 */
import { SCH_DEFAULT_GAME_DATES, SCH_GAMES, type SchGame } from "./schema";

/** Typed by the admin to confirm; language-neutral on purpose. */
export const SCH_CLOSE_OUT_WORD = "DELETE";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The last game day (YYYY-MM-DD, Asia/Seoul) from `sch_event.game_dates`. */
export function lastGameDay(value: unknown): string {
  const src = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  let last = "";
  for (const g of SCH_GAMES as readonly SchGame[]) {
    const v = src[g];
    const day = typeof v === "string" && DAY_RE.test(v) ? v : SCH_DEFAULT_GAME_DATES[g];
    if (day > last) last = day;
  }
  return last;
}

/** Close-out opens at 00:00 KST on the day after the last game day. */
export function closeOutOpensAt(gameDates: unknown): Date {
  return new Date(Date.parse(`${lastGameDay(gameDates)}T00:00:00+09:00`) + DAY_MS);
}

export function closeOutAllowed(gameDates: unknown, now: number = Date.now()): boolean {
  return now >= closeOutOpensAt(gameDates).getTime();
}
