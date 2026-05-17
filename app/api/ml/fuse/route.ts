import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL;
const ML_TOKEN = process.env.ML_SERVICE_TOKEN;

const schema = z.object({
  frames: z
    .array(
      z.object({
        embedding: z.array(z.number()).min(64).max(2048),
        quality: z.number().min(0).max(1).default(1),
      }),
    )
    .min(1)
    .max(20),
  strategy: z.enum(["weighted_mean", "median"]).default("weighted_mean"),
});

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  if (!ML_URL || !ML_TOKEN) {
    return NextResponse.json(
      { error: "ML service not configured" },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  }

  try {
    const res = await fetch(`${ML_URL}/embedding/fuse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ML_TOKEN}`,
      },
      body: JSON.stringify(parsed.data),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "ML service unreachable" },
      { status: 502 },
    );
  }
}
