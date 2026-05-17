import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SampleSchema = z.object({
  session_id: z.string().min(8).max(64),
  metric: z.enum(["LCP", "FID", "CLS", "INP", "TTFB", "FCP"]),
  value: z.number().finite().nonnegative(),
  rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
  page: z.string().min(1).max(512),
  navigation_type: z.string().max(64).optional(),
});

const PAGE_SANITIZE_RE = /[?#].*$/;
const MAX_BODY = 8 * 1024;

export async function POST(req: Request) {
  // Pull the bearer cookie session, but tolerate anonymous (we just don't tag user_id).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const text = await req.text();
  if (text.length > MAX_BODY) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const arr = Array.isArray(json) ? json : [json];
  if (arr.length > 32) {
    return NextResponse.json({ error: "too many samples" }, { status: 413 });
  }

  const rows: Array<{
    user_id: string | null;
    session_id: string;
    metric: string;
    value: number;
    rating: string | null;
    page: string;
    navigation_type: string | null;
    ua: string | null;
  }> = [];
  for (const item of arr) {
    const parsed = SampleSchema.safeParse(item);
    if (!parsed.success) continue;
    rows.push({
      user_id: user?.id ?? null,
      session_id: parsed.data.session_id,
      metric: parsed.data.metric,
      value: parsed.data.value,
      rating: parsed.data.rating ?? null,
      page: parsed.data.page.replace(PAGE_SANITIZE_RE, "").slice(0, 512),
      navigation_type: parsed.data.navigation_type ?? null,
      ua: req.headers.get("user-agent")?.slice(0, 512) ?? null,
    });
  }
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 });
  }

  const writer = user ? supabase : createServiceClient();
  const { error } = await writer.from("web_vitals").insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, inserted: rows.length });
}
