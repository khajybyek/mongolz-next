import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) {
    return NextResponse.json({ error: "push-not-configured" }, { status: 501 });
  }
  return NextResponse.json({ publicKey: key });
}
