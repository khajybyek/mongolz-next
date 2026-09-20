import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { parseSearchFilters } from "@/lib/search-filters";
import { UUID_RE } from "@/lib/workflow-query";

const presetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  cameraId: z.string().optional().default(""),
  from: z.string().optional().default(""),
  to: z.string().optional().default(""),
  recordingStatus: z.string().optional().default(""),
  minConfidence: z.string().optional().default(""),
  suspectId: z.string().optional().default(""),
  incidentId: z.string().optional().default(""),
  threshold: z.string().optional().default("0.50"),
  limit: z.string().optional().default("50"),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const parsed = presetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid preset" }, { status: 400 });
  const input = parsed.data;
  const filters = parseSearchFilters({
    cameraId: input.cameraId,
    from: input.from,
    to: input.to,
    recordingStatus: input.recordingStatus,
    minConfidence: input.minConfidence,
    suspectId: input.suspectId,
    incidentId: input.incidentId,
    threshold: input.threshold,
    limit: input.limit,
    offset: "0",
  });
  if (!filters) return NextResponse.json({ error: "invalid filters" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.from("face_search_presets").upsert({
    user_id: auth.user.id,
    name: input.name,
    camera_id: filters.cameraId,
    from_at: filters.from,
    to_at: filters.to,
    recording_status: filters.recordingStatus,
    min_confidence: filters.minConfidence,
    suspect_id: filters.suspectId,
    incident_id: filters.incidentId,
    match_threshold: filters.threshold,
    result_limit: filters.limit,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,name" }).select("id,name,camera_id,from_at,to_at,recording_status,min_confidence,suspect_id,incident_id,match_threshold,result_limit").single();
  if (error) return NextResponse.json({ error: "preset unavailable" }, { status: 503 });
  return NextResponse.json({ preset: data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid preset" }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.from("face_search_presets").delete().eq("id", id).eq("user_id", auth.user.id);
  if (error) return NextResponse.json({ error: "preset unavailable" }, { status: 503 });
  return NextResponse.json({ ok: true });
}
