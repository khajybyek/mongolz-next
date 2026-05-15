import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;
    return NextResponse.json({ status: "ok", detail: `${data.length} buckets available` });
  } catch (e) {
    return NextResponse.json({ status: "error", detail: e instanceof Error ? e.message : "Storage error" }, { status: 503 });
  }
}
