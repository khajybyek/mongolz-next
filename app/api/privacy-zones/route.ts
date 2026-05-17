import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ZoneSchema = z.object({
  camera_id: z.string().regex(UUID_RE),
  name: z.string().min(1).max(120),
  reason: z.string().max(500).optional(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.01).max(1),
  h: z.number().min(0.01).max(1),
  never_reveal: z.boolean().default(true),
  enforce_vip_mask: z.boolean().default(false),
});

export async function GET(req: Request) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const { searchParams } = new URL(req.url);
  const cameraId = searchParams.get("camera_id");

  const supabase = await createClient();
  let q = supabase
    .from("privacy_zones")
    .select("id, camera_id, name, reason, x, y, w, h, never_reveal, enforce_vip_mask, enabled, created_at")
    .order("created_at", { ascending: false });
  if (cameraId && UUID_RE.test(cameraId)) {
    q = q.eq("camera_id", cameraId);
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ zones: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const parsed = ZoneSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", details: parsed.error.format() }, { status: 400 });
  }
  if (parsed.data.x + parsed.data.w > 1.0001 || parsed.data.y + parsed.data.h > 1.0001) {
    return NextResponse.json({ error: "rectangle extends beyond frame" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("privacy_zones")
    .insert({ ...parsed.data, created_by: auth.user.id })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ zone: data });
}

export async function DELETE(req: Request) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const supabase = await createClient();
  const { error } = await supabase.from("privacy_zones").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const body = await req.json().catch(() => null);
  const Patch = z.object({
    id: z.string().regex(UUID_RE),
    enabled: z.boolean().optional(),
    never_reveal: z.boolean().optional(),
    enforce_vip_mask: z.boolean().optional(),
  });
  const parsed = Patch.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  const { id, ...rest } = parsed.data;
  if (Object.keys(rest).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("privacy_zones")
    .update(rest)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ zone: data });
}
