import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL;
const ML_TOKEN = process.env.ML_SERVICE_TOKEN;

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  if (!ML_URL || !ML_TOKEN) {
    return NextResponse.json(
      { error: "ML service not configured" },
      { status: 503 },
    );
  }

  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (file.size > 4 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large (>4 MB)" }, { status: 413 });
  }

  const proxied = new FormData();
  proxied.append("file", file, file.name || "face.jpg");

  try {
    const res = await fetch(`${ML_URL}/anti-spoof`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ML_TOKEN}` },
      body: proxied,
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
