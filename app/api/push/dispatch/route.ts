import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { isPushConfigured, sendPushToAllAdmins } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.object({
  alert_id: z.string().regex(UUID_RE).optional(),
  title: z.string().min(1).max(120).optional(),
  body: z.string().min(1).max(240).optional(),
  url: z.string().min(1).max(2048).optional(),
});

function constantTimeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  const secret = process.env.PUSH_DISPATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "dispatch-not-configured" }, { status: 501 });
  }
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!constantTimeEqual(provided, secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isPushConfigured()) {
    return NextResponse.json({ error: "push-not-configured" }, { status: 501 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  let title = parsed.data.title ?? "MONGOLZ Security";
  let body = parsed.data.body ?? "Шинэ alert ирлээ.";
  let url = parsed.data.url ?? "/alerts";

  if (parsed.data.alert_id) {
    const supabase = createServiceClient();
    const { data: alert } = await supabase
      .from("alerts")
      .select("suspect_name, similarity, camera_name, created_at")
      .eq("id", parsed.data.alert_id)
      .single<{ suspect_name: string | null; similarity: number | null; camera_name: string | null; created_at: string }>();
    if (alert) {
      const score = alert.similarity ? Math.round(alert.similarity * 100) : null;
      title = `Match · ${alert.suspect_name ?? "Unknown"}`;
      body = `${alert.camera_name ?? "Camera"}${score !== null ? ` · ${score}%` : ""}`;
      url = `/alerts#${parsed.data.alert_id}`;
    }
  }

  const result = await sendPushToAllAdmins({ title, body, url, tag: parsed.data.alert_id ?? "mongolz-alert" });
  return NextResponse.json({ ok: true, ...result });
}
