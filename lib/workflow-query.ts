export const ARCHIVE_PAGE_SIZE = 24;
export const REVIEW_PAGE_SIZE = 48;
export const JOB_PAGE_SIZE = 30;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type QueryParams = Record<string, string | string[] | undefined>;

export function pageNumber(value: unknown): number | null {
  if (value === undefined || value === "") return 1;
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value)) return null;
  return Number(value);
}

function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Inclusive calendar-day inputs use the same KST zone as displayed timestamps. */
export function archiveFilters(params: QueryParams) {
  const from = params.from || "";
  const to = params.to || "";
  const camera = params.camera || "";
  const page = pageNumber(params.page);
  if ((from && !validDay(from)) || (to && !validDay(to)) ||
      typeof camera !== "string" || (camera && !UUID_RE.test(camera)) ||
      typeof from !== "string" || typeof to !== "string" || (from && to && from > to) || page === null) {
    return null;
  }
  return {
    from, to, camera, page,
    since: from ? new Date(`${from}T00:00:00+09:00`).toISOString() : null,
    until: to ? new Date(new Date(`${to}T00:00:00+09:00`).getTime() + 86_400_000).toISOString() : null,
  };
}

export function pageHref(path: string, params: Record<string, string | number | undefined>, page: number, pageKey = "page"): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "" && key !== pageKey) q.set(key, String(value));
  if (page > 1) q.set(pageKey, String(page));
  return `${path}${q.size ? `?${q}` : ""}`;
}

export function recordingFaceHref(recordingId: string | null, faceId: string): string | null {
  return recordingId && UUID_RE.test(recordingId) && UUID_RE.test(faceId)
    ? `/playback/${recordingId}?face=${faceId}` : null;
}

/** Stable, same-page deep link used by push notifications and mobile alert review. */
export function alertHref(alertId: string): string | null {
  return UUID_RE.test(alertId) ? `/alerts/${alertId}` : null;
}
