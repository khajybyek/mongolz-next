import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { csvCell } from "@/lib/csv";
import { recordAccess, READ_ACTIONS } from "@/lib/audit";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const supabase = await createClient();
  const { data: alerts } = await supabase
    .from("alerts")
    .select("suspect_name, similarity, camera_name, created_at, state, face_id, match_count, last_seen_at")
    .order("created_at", { ascending: false })
    .limit(10000);

  // match_count / last_seen_at: repeat sightings merge into the open alert, so
  // an export without them understates every recurring incident. face_id
  // replaces screenshot_path, which is NULL on every new alert since the
  // evidence became the sealed face crop (migration 20260909110000) — it is
  // the id to open at /api/faces/<id>/secure-crop, not a storage path.
  const header = ["suspect_name", "similarity", "camera_name", "created_at", "state", "face_id", "match_count", "last_seen_at"];
  const lines = [header.join(",")];

  for (const a of alerts ?? []) {
    lines.push(
      [
        csvCell(a.suspect_name),
        csvCell(a.similarity),
        csvCell(a.camera_name ?? ""),
        csvCell(a.created_at),
        csvCell(a.state),
        csvCell(a.face_id ?? ""),
        csvCell(a.match_count ?? 1),
        csvCell(a.last_seen_at ?? a.created_at),
      ].join(",")
    );
  }

  // Alert history leaving the system as a file is an export, not a page view:
  // it survives outside every control the app has. Logged with the row count
  // once the file is built.
  await recordAccess({
    action: READ_ACTIONS.ALERTS_EXPORTED,
    detail: `alerts csv · rows=${alerts?.length ?? 0}`,
    userId: auth.user.id,
    userEmail: auth.user.email,
    request,
  });

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="alerts_${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
