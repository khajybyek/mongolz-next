/**
 * PostgREST caps every response at the project's `max_rows` (1000 — see
 * supabase/config.toml), so `.limit(5000)` on a table query quietly returns
 * at most 1000 rows. Exports that must be complete page with `.range()`
 * through this helper instead.
 *
 * `page(from, to)` must build the whole filtered query and end in
 * `.range(from, to)`, ordered by a unique tiebreaker (for example
 * `created_at desc, id desc`) so page boundaries neither overlap nor skip.
 *
 * The loop advances by the number of rows actually returned and stops on an
 * empty page, so it stays correct if the server cap is ever lower than
 * `pageSize`. One row past `cap` is requested to tell a table that is exactly
 * `cap` rows long from a genuinely truncated result.
 */
export const EXPORT_PAGE_SIZE = 1000;

export type PageResponse<R> = {
  data: R[] | null;
  error: { message: string } | null;
};

export type PagedResult<R> = {
  rows: R[];
  /** More rows matched than `cap`; `rows` holds the first `cap`. */
  truncated: boolean;
  error: string | null;
};

export async function fetchAllPaged<R>(
  page: (from: number, to: number) => PromiseLike<PageResponse<R>>,
  cap: number,
  pageSize: number = EXPORT_PAGE_SIZE,
): Promise<PagedResult<R>> {
  const want = Math.max(0, Math.trunc(cap)) + 1;
  const rows: R[] = [];
  while (rows.length < want) {
    const from = rows.length;
    const to = Math.min(from + pageSize, want) - 1;
    const { data, error } = await page(from, to);
    if (error) return { rows, truncated: false, error: error.message };
    const got = data ?? [];
    if (got.length === 0) break;
    rows.push(...got.slice(0, want - from));
  }
  const truncated = rows.length > cap;
  return { rows: truncated ? rows.slice(0, cap) : rows, truncated, error: null };
}
