/**
 * Per-face crop decryption proxy (ADR 0009 — pixel-level hash-chain seal).
 *
 * Demonstrates that a face crop's PIXELS — not just its embedding — are sealed
 * at rest with the per-face hash-chain key K_index. A request returns the crop
 * only when the requester's reveal_level ≤ the face's chain_index (ci < level
 * → 403).
 *
 * Honest threat model: this is an AUTHORIZATION gate enforced here + at the ML
 * service (which holds the master key and is the trusted decryptor) — not a
 * cryptographic impossibility against the service itself. The forward hash
 * chain matters for storage-at-rest / out-of-band delegated-key compromise
 * (a holder of only K_level can derive ≥level but never below). See the ML
 * endpoint docstring + ADR 0009.
 *
 * Admin-only: face crops are admin-scoped data (viewers never see face
 * metadata per the privacy design). The requester's reveal_level is read
 * server-side and passed to ML — the client cannot forge it.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "";
const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid face id" }, { status: 400 });
  }

  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  if (!ML_URL) {
    return NextResponse.json({ error: "ML service unavailable" }, { status: 502 });
  }

  // The requester's authority level (ADR 0009). profiles.reveal_level is a
  // newer column not in PublicProfile — read it via the service client.
  // Default 0 = director (can decrypt every face's crop).
  let level = 0;
  try {
    const svc = createServiceClient();
    const { data: prof } = await svc
      .from("profiles")
      .select("reveal_level")
      .eq("id", auth.user.id)
      .single();
    level = (prof as { reveal_level?: number } | null)?.reveal_level ?? 0;
  } catch {
    level = 0;
  }

  const headers: Record<string, string> = {};
  if (ML_TOKEN) headers.Authorization = `Bearer ${ML_TOKEN}`;

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ML_URL}/face/${encodeURIComponent(id)}/secure-crop?level=${encodeURIComponent(String(level))}`,
      { headers, cache: "no-store" },
    );
  } catch {
    return NextResponse.json({ error: "ML service unreachable" }, { status: 502 });
  }

  // 403 = below the requester's authority (forward-chain block) — pass it
  // through so the UI can render a "locked" placeholder. 404 = not sealed.
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `secure crop unavailable (${upstream.status})` },
      { status: upstream.status === 403 ? 403 : upstream.status === 404 ? 404 : 502 },
    );
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=60",
    },
  });
}
