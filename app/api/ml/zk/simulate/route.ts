import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "http://localhost:8000";
const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";

export async function POST(req: Request) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  try {
    const body = await req.json().catch(() => ({}));
    const n_trials = Math.max(10, Math.min(1000, Number(body.n_trials) || 100));
    const threshold = Math.max(0, Math.min(1, Number(body.threshold) || 0.45));

    const res = await fetch(
      `${ML_URL}/zk/simulate?n_trials=${encodeURIComponent(n_trials)}&threshold=${encodeURIComponent(threshold)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${ML_TOKEN}` },
      },
    );

    if (!res.ok) {
      return NextResponse.json({ error: "ML service error" }, { status: res.status });
    }

    return NextResponse.json(await res.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to reach ML service" },
      { status: 502 },
    );
  }
}
