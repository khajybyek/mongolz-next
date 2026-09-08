/**
 * Unified face-crop endpoint (ADR 0009 — one encrypted source for crops).
 *
 * Every gallery fetches a face crop through here, so the storage layer can be
 * encrypt-only without any display site knowing the difference:
 *   • crop_sealed = true  → the crop lives only as `<image_path>.enc`
 *     (AES-256-GCM with the per-face hash-chain key K_index). Proxied to the
 *     ML service which decrypts it, authority-gated by the caller's
 *     reveal_level (ci < level → 403; ADR 0009 forward chain).
 *   • crop_sealed = false → legacy plaintext crop at `image_path` (these
 *     predate the chain and have no chain_index, so they cannot be sealed).
 *     Streamed directly from the faces bucket. Admin-gated only.
 *
 * Honest threat model: the ML service holds the master key and is the trusted
 * decryptor; the level gate is authorization enforced here + at ML, not a
 * cryptographic wall against the service itself (see ADR 0009).
 *
 * Admin-only: face crops are admin-scoped (viewers never see face metadata;
 * the /wall kiosk only fetches crops for admins). reveal_level is read
 * server-side and is not client-forgeable.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { readRevealAuthority } from "@/lib/reveal-authority";
import { recordAccess, READ_ACTIONS, ACCESS_THROTTLE_MS } from "@/lib/audit";

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "";
const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid face id" }, { status: 400 });
  }

  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const authority = await readRevealAuthority(auth.user.id);
  if ("error" in authority) return authority.error;

  const svc = createServiceClient();
  const { data: face } = await svc
    .from("faces")
    .select("image_path, crop_sealed")
    .eq("id", id)
    .maybeSingle();

  if (!face || !face.image_path) {
    return NextResponse.json({ error: "face not found" }, { status: 404 });
  }

  // ── Legacy plaintext crop: stream directly from storage (admin-gated). ──
  if (!(face as { crop_sealed?: boolean }).crop_sealed) {
    // Legacy crops have no chain index proving a restricted caller's scope.
    if (authority.level !== 0) {
      return NextResponse.json({ error: "REVEAL_FORBIDDEN" }, { status: 403 });
    }
    const { data: blob, error } = await svc.storage
      .from("faces")
      .download(face.image_path as string);
    if (error || !blob) {
      return NextResponse.json({ error: "crop unavailable" }, { status: 404 });
    }
    const buf = Buffer.from(await blob.arrayBuffer());
    await logCropRead(id, "legacy-plain", authority.level, auth.user, request);
    return new NextResponse(buf, {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" },
    });
  }

  // ── Sealed crop: authority-gated decrypt via ML. ──
  if (!ML_URL) {
    return NextResponse.json({ error: "ML service unavailable" }, { status: 502 });
  }

  const headers: Record<string, string> = {};
  if (ML_TOKEN) headers.Authorization = `Bearer ${ML_TOKEN}`;

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ML_URL}/face/${encodeURIComponent(id)}/secure-crop?level=${encodeURIComponent(String(authority.level))}`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    return NextResponse.json({ error: "ML service unreachable" }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    // 403 = below the caller's authority (forward-chain block) — the UI
    // renders a lock. 404 = not sealed / missing.
    return NextResponse.json(
      { error: `crop unavailable (${upstream.status})` },
      { status: upstream.status === 403 ? 403 : upstream.status === 404 ? 404 : 502 },
    );
  }

  await logCropRead(id, "sealed", authority.level, auth.user, request);

  return new NextResponse(upstream.body, {
    status: 200,
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" },
  });
}

/**
 * One ledger row per operator per face per throttle window. Written only once
 * the pixels are on their way back — a 403 from the authority gate or a 404
 * from storage is a refusal, not a look, and must not appear as one.
 *
 * Galleries render dozens of crops at once and `no-store` means a revisit
 * re-fetches every one of them, so an un-throttled row per request would bury
 * the ledger (and serialise on its hash-chain lock) without adding meaning.
 */
async function logCropRead(
  faceId: string,
  kind: "sealed" | "legacy-plain",
  level: number,
  user: { id: string; email: string },
  request: NextRequest,
): Promise<void> {
  await recordAccess({
    action: READ_ACTIONS.FACE_CROP_VIEWED,
    detail: `face=${faceId} · ${kind} · level=${level}`,
    userId: user.id,
    userEmail: user.email,
    request,
    throttleMs: ACCESS_THROTTLE_MS,
  });
}
