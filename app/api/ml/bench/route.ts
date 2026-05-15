import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "http://localhost:8000";
const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";

export async function POST(req: Request) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const body = await req.json().catch(() => ({}));
  const iterations = Math.max(1, Math.min(100, Number(body.iterations) || 10));

  try {
    const res = await fetch(
      `${ML_URL}/eval/bench?iterations=${encodeURIComponent(iterations)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${ML_TOKEN}` },
      },
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `ML service ${res.status}` },
        { status: res.status },
      );
    }
    return NextResponse.json(await res.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "ML unreachable" },
      { status: 502 },
    );
  }
}
