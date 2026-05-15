import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "";
const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const headers: Record<string, string> = {};
  if (ML_TOKEN) headers.Authorization = `Bearer ${ML_TOKEN}`;

  try {
    const res = await fetch(`${ML_URL}/eval/system`, { headers });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "ML service unavailable" }, { status: 502 });
  }
}
