import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { mlEmbed } from "@/lib/ml-client";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const fd = await request.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const embedding = await mlEmbed(buffer);

  const svc = createServiceClient();
  const { data, error } = await svc.rpc("match_faces", {
    query_embedding: embedding,
    match_threshold: 0.5,
    match_limit: 50,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ matches: data });
}
