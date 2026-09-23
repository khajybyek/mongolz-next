import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { scheduleSecurityEvent } from "@/lib/notify";

export const dynamic = "force-dynamic";

async function audit(action: string, detail: string, userId: string, userEmail: string) {
  try {
    await createServiceClient().from("audit_log").insert({
      action,
      detail,
      user_id: userId,
      user_email: userEmail,
    });
  } catch {}
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Write model (2026-09-23): never_reveal zones are a live reveal control —
 * reveal_job.py drops matches inside them. Removing, disabling or loosening
 * a zone therefore needs a fresh TOTP step-up and notifies the other admins,
 * like every other loosening change since 2026-09-17; tightening (create a
 * never_reveal zone, re-enable, set never_reveal / enforce_vip_mask) stays
 * one click. All writes go through the service role after the admin gate
 * (migration 20260923180000 revokes user-token writes on the table).
 */
async function stepUp(userId: string) {
  const reauth = await ensureFreshReauth(userId);
  return reauth ? NextResponse.json(reauth, { status: 403 }) : null;
}

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

  // A zone created WITHOUT never_reveal is the weaker form — same gate.
  if (!parsed.data.never_reveal) {
    const refused = await stepUp(auth.user.id);
    if (refused) return refused;
  }

  const { data, error } = await createServiceClient()
    .from("privacy_zones")
    .insert({ ...parsed.data, created_by: auth.user.id })
    .select()
    .single();
  if (error) {
    console.error("[privacy-zones] insert:", error.message);
    return NextResponse.json({ error: "could not create zone" }, { status: 500 });
  }
  await audit(
    "PRIVACY_ZONE_CREATE",
    `zone ${data.id} "${parsed.data.name}" camera=${parsed.data.camera_id} never_reveal=${parsed.data.never_reveal}`,
    auth.user.id,
    auth.user.email,
  );
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
  const refused = await stepUp(auth.user.id);
  if (refused) return refused;

  const { data, error } = await createServiceClient()
    .from("privacy_zones")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    console.error("[privacy-zones] delete:", error.message);
    return NextResponse.json({ error: "could not delete zone" }, { status: 500 });
  }
  // Nothing removed → no audit row claiming a deletion happened.
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit("PRIVACY_ZONE_DELETE", `zone ${id}`, auth.user.id, auth.user.email);
  scheduleSecurityEvent({
    action: "PRIVACY_ZONE_DELETE",
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    detail: `zone ${id}`,
  });
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
  const loosening = rest.enabled === false || rest.never_reveal === false || rest.enforce_vip_mask === false;
  if (loosening) {
    const refused = await stepUp(auth.user.id);
    if (refused) return refused;
  }

  const { data, error } = await createServiceClient()
    .from("privacy_zones")
    .update(rest)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) {
    console.error("[privacy-zones] update:", error.message);
    return NextResponse.json({ error: "could not update zone" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const detail = `zone ${id} ${JSON.stringify(rest)}`;
  await audit("PRIVACY_ZONE_UPDATE", detail, auth.user.id, auth.user.email);
  if (loosening) {
    scheduleSecurityEvent({
      action: "PRIVACY_ZONE_UPDATE",
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      detail,
    });
  }
  return NextResponse.json({ zone: data });
}
