import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const supabase = await createClient();
  const { data: suspects, error } = await supabase
    .from("suspects")
    .select("id, name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = await Promise.all(
    (suspects ?? []).map(async (s) => {
      const { data: rpc, error: rpcErr } = await supabase.rpc("suggested_threshold", {
        p_suspect_id: s.id,
      });
      if (rpcErr) return { suspect_id: s.id, suspect_name: s.name, error: rpcErr.message };
      const row = (rpc as Array<Record<string, unknown>> | null)?.[0];
      return {
        suspect_id: s.id,
        suspect_name: s.name,
        suggested_threshold: row?.suggested_threshold ?? null,
        tp_count: row?.tp_count ?? 0,
        fp_count: row?.fp_count ?? 0,
        total_labeled: row?.total_labeled ?? 0,
      };
    }),
  );

  return NextResponse.json({ suspects: results });
}
