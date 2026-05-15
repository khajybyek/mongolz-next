import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const supabase = await createClient();
  const { data: alerts } = await supabase
    .from("alerts")
    .select("suspect_name, similarity, camera_name, created_at, screenshot_path")
    .order("created_at", { ascending: false })
    .limit(10000);

  const header = ["suspect_name", "similarity", "camera_name", "created_at", "screenshot_path"];
  const lines = [header.join(",")];

  for (const a of alerts ?? []) {
    lines.push(
      [
        JSON.stringify(a.suspect_name),
        a.similarity,
        JSON.stringify(a.camera_name ?? ""),
        a.created_at,
        JSON.stringify(a.screenshot_path ?? ""),
      ].join(",")
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="alerts_${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
