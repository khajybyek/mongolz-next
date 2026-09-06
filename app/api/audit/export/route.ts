import { NextResponse, type NextRequest } from "next/server";
import { requireAdminOrAuditorApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { csvCell } from "@/lib/csv";

export async function GET(req: NextRequest) {
  const auth = await requireAdminOrAuditorApi();
  if (isAuthErr(auth)) return auth.error;

  const sp = req.nextUrl.searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("audit_log")
    .select("id, action, detail, user_email, ip, created_at")
    .order("created_at", { ascending: false })
    .limit(5000);

  const action = sp.get("action");
  const q = sp.get("q");
  const user = sp.get("user");
  const from = sp.get("from");
  const to = sp.get("to");

  if (action) query = query.eq("action", action);
  if (user) query = query.ilike("user_email", `%${user}%`);
  if (q) query = query.ilike("detail", `%${q}%`);
  const fromIso = toKstIso(from);
  const toIso = toKstIso(to);
  if (fromIso) query = query.gte("created_at", fromIso);
  if (toIso) query = query.lte("created_at", toIso);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const header = ["id", "action", "detail", "user_email", "ip", "created_at"];
  const rows = (data ?? []).map((r) =>
    header.map((h) => csvCell(r[h as keyof typeof r])).join(","),
  );
  const csv = [header.join(","), ...rows].join("\n") + "\n";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mongolz-audit-${Date.now()}.csv"`,
    },
  });
}

/** "YYYY-MM-DDTHH:mm" (KST wall-clock) → ISO instant; null when absent/invalid. */
function toKstIso(v: string | null): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)) return null;
  const d = new Date(`${v}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
