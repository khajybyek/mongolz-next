import { UUID_RE } from "@/lib/workflow-query";

export interface SearchFilterInput {
  cameraId?: FormDataEntryValue | null;
  from?: FormDataEntryValue | null;
  to?: FormDataEntryValue | null;
  threshold?: FormDataEntryValue | null;
  limit?: FormDataEntryValue | null;
  offset?: FormDataEntryValue | null;
}

export interface SearchFilters {
  cameraId: string | null;
  from: string | null;
  to: string | null;
  threshold: number;
  limit: number;
  offset: number;
}

/** Convert a minute-precision datetime-local value to the product's KST zone. */
export function kstLocalToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, ys, ms, ds, hs, mins] = match;
  const year = Number(ys), month = Number(ms), day = Number(ds), hour = Number(hs), minute = Number(mins);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const parsed = new Date(`${value}:00+09:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function text(value: FormDataEntryValue | null | undefined): string | null {
  return typeof value === "string" ? value.trim() : null;
}

export function parseSearchFilters(input: SearchFilterInput): SearchFilters | null {
  const cameraRaw = text(input.cameraId) ?? "";
  const fromRaw = text(input.from) ?? "";
  const toRaw = text(input.to) ?? "";
  const thresholdRaw = text(input.threshold) || "0.5";
  const limitRaw = text(input.limit) || "50";
  const offsetRaw = text(input.offset) || "0";

  if (cameraRaw && !UUID_RE.test(cameraRaw)) return null;
  const from = fromRaw ? kstLocalToIso(fromRaw) : null;
  const to = toRaw ? kstLocalToIso(toRaw) : null;
  if ((fromRaw && !from) || (toRaw && !to) || (from && to && from >= to)) return null;

  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(thresholdRaw)
      || !/^\d{1,3}$/.test(limitRaw)
      || !/^\d{1,5}$/.test(offsetRaw)) return null;
  const threshold = Number(thresholdRaw);
  const limit = Number(limitRaw);
  const offset = Number(offsetRaw);
  if (threshold < 0.3 || threshold > 0.95 || limit < 1 || limit > 100 || offset > 10000) return null;

  return { cameraId: cameraRaw || null, from, to, threshold, limit, offset };
}

export function paginateSearchResults<T>(
  rows: T[],
  limit: number,
  offset: number,
): { matches: T[]; hasMore: boolean; nextOffset: number | null } {
  const matches = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    matches,
    hasMore,
    nextOffset: hasMore ? offset + matches.length : null,
  };
}
