/**
 * Weekday bitmask for privacy-schedule windows (ADR 0012): bit i is day i,
 * Sunday = 1 … Saturday = 64, so 127 = every day. The database, the ML
 * evaluator and the action all speak the mask; the form speaks day names.
 */

/** Checkbox name on the add-window form; one entry per ticked day, value = its bit. */
export const WEEKDAY_FIELD = "weekday_bit";

/** Day bits in display order (Sunday first, the same order as the mask). */
export const WEEKDAY_BITS = [1, 2, 4, 8, 16, 32, 64] as const;

export const EVERY_DAY_MASK = 127;

const WEEKDAY_NAMES: Record<string, string[]> = {
  mn: ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  kr: ["일", "월", "화", "수", "목", "금", "토"],
};

const EVERY_DAY: Record<string, string> = {
  mn: "Өдөр бүр",
  en: "Every day",
  kr: "매일",
};

export function weekdayNames(lang: string): string[] {
  return WEEKDAY_NAMES[lang] ?? WEEKDAY_NAMES.mn!;
}

/**
 * The days of a window as text. `ranges` folds a run of three or more
 * consecutive days (in the Sunday-first order of the mask) into "Mon–Fri",
 * so a table cell on a phone reads as one short line instead of five names
 * wrapping over three; the full list stays available for labels read aloud.
 */
export function weekdaysLabel(mask: number, lang: string, opts: { ranges?: boolean } = {}): string {
  if (mask === EVERY_DAY_MASK) return EVERY_DAY[lang] ?? EVERY_DAY.mn!;
  const names = weekdayNames(lang);
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    if (!(mask & (1 << i))) continue;
    let end = i;
    while (opts.ranges && end + 1 < 7 && mask & (1 << (end + 1))) end++;
    if (end - i >= 2) {
      parts.push(`${names[i]!}–${names[end]!}`);
      i = end;
    } else {
      parts.push(names[i]!);
    }
  }
  return parts.join(", ");
}

/**
 * The mask a submitted add-window form asks for. Ticked day checkboxes are
 * OR-ed together (a repeated day counts once); a value that is not a single
 * day bit yields NaN so the schema refuses the whole submission. With no day
 * ticked the result is 0 — refused by the schema's 1–127 range, never read
 * as "every day". A form without the checkbox group may still send the
 * numeric `weekdays` field.
 */
export function weekdaysFromForm(formData: FormData): number | FormDataEntryValue | null {
  const bits = formData.getAll(WEEKDAY_FIELD);
  if (bits.length === 0) return formData.has("weekdays") ? formData.get("weekdays") : 0;
  let mask = 0;
  for (const raw of bits) {
    const n = typeof raw === "string" && /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
    if (!(WEEKDAY_BITS as readonly number[]).includes(n)) return NaN;
    mask |= n;
  }
  return mask;
}
