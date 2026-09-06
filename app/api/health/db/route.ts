import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  try {
    const supabase = await createClient();
    const { count, error } = await supabase.from("profiles").select("id", { count: "exact", head: true });
    if (error) throw error;
    return NextResponse.json({ status: "ok", detail: `Connected — ${count} profiles` });
  } catch (e) {
    return NextResponse.json({ status: "error", detail: e instanceof Error ? e.message : "DB error" }, { status: 503 });
  }
}
