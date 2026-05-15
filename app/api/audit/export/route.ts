import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
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
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const header = ["id", "action", "detail", "user_email", "ip", "created_at"];
  const rows = (data ?? []).map((r) =>
    header.map((h) => csvEscape(r[h as keyof typeof r])).join(","),
  );
  const csv = [header.join(","), ...rows].join("\n") + "\n";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mongolz-audit-${Date.now()}.csv"`,
    },
  });
}
