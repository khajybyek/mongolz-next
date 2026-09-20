import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/workflow-query";

const schema = z.object({ note: z.string().max(500) });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid alert id" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid note" }, { status: 400 });
  const note = parsed.data.note.trim() || null;
  const service = createServiceClient();
  const { data, error } = await service.from("alerts").update({ note }).eq("id", id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "note unavailable" }, { status: 503 });
  if (!data) return NextResponse.json({ error: "alert not found" }, { status: 404 });
  await service.from("audit_log").insert({
    action: "ALERT_NOTE_UPDATED",
    detail: `${id} · ${note ? "note saved" : "note cleared"}`,
    user_id: auth.user.id,
    user_email: auth.user.email,
  });
  return NextResponse.json({ ok: true, note });
}
