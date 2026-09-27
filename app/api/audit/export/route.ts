import { NextResponse, type NextRequest } from "next/server";
import { requireAdminOrAuditorApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { csvCell, csvDocument, CSV_CONTENT_TYPE } from "@/lib/csv";
import { fetchAllPaged } from "@/lib/paged-fetch";
import { log } from "@/lib/log";

/** Hard ceiling on one export; beyond it the file is marked partial. */
const AUDIT_CSV_CAP = 20_000;

export async function GET(req: NextRequest) {
  const auth = await requireAdminOrAuditorApi();
  if (isAuthErr(auth)) return auth.error;

  const sp = req.nextUrl.searchParams;
  const supabase = await createClient();

  const action = sp.get("action");
  const q = sp.get("q");
  const user = sp.get("user");
  const fromIso = toKstIso(sp.get("from"));
  const toIso = toKstIso(sp.get("to"));

  // PostgREST answers at most max_rows (1000) per request: the old single
  // `.limit(5000)` dropped everything past the newest 1000 matching rows
  // without saying so. Filters are applied on every page, ordered by the
  // unique id as a tiebreaker so pages neither overlap nor skip.
  const { rows: data, truncated, error } = await fetchAllPaged((lo, hi) => {
    let query = supabase
      .from("audit_log")
      .select("id, action, detail, user_email, ip, created_at");
    if (action) query = query.eq("action", action);
    if (user) query = query.ilike("user_email", `%${user}%`);
    if (q) query = query.ilike("detail", `%${q}%`);
    if (fromIso) query = query.gte("created_at", fromIso);
    if (toIso) query = query.lte("created_at", toIso);
    return query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(lo, hi);
  }, AUDIT_CSV_CAP);
  if (error) {
    log.error("audit export: query failed", { error });
    return NextResponse.json({ error: "query_failed" }, { status: 503 });
  }

  const header = ["id", "action", "detail", "user_email", "ip", "created_at"];
  const rows = data.map((r) =>
    header.map((h) => csvCell(r[h as keyof typeof r])).join(","),
  );
  // BOM first: without it Excel decodes Cyrillic / Hangul details as mojibake.
  const csv = csvDocument([header.join(","), ...rows].join("\n") + "\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      // Plain-link download: the filename is where the auditor sees the cap.
      "Content-Disposition": `attachment; filename="mongolz-audit-${Date.now()}${truncated ? "-partial" : ""}.csv"`,
      "X-Export-Truncated": truncated ? "1" : "0",
    },
  });
}

/** "YYYY-MM-DDTHH:mm" (KST wall-clock) → ISO instant; null when absent/invalid. */
function toKstIso(v: string | null): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)) return null;
  const d = new Date(`${v}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
