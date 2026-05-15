import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "http://localhost:8000";
const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";

export async function POST() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  try {
    const res = await fetch(`${ML_URL}/dp/sweep`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ML_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "ML service error" }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to reach ML service" },
      { status: 502 },
    );
  }
}
