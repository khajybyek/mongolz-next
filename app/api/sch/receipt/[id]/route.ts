/**
 * SCH Esports — audited receipt viewer.
 *
 * `sch-receipts` is a private bucket with no storage policy at all, so the
 * only way a payment screenshot reaches a browser is through here: admin +
 * second factor (`requireAdminApi`), the registration row read through the
 * RLS client (the mfa restrictive policy applies), the object fetched with
 * the service role and streamed inline with the stored mime. Every view is
 * one `SCH_RECEIPT_VIEWED` ledger row carrying the registration id only —
 * the same gateway pattern as the faces bucket.
 */

import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthErr, requireAdminApi } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/workflow-query";
import {
  RECEIPT_MIME_EXT,
  RECEIPT_PATH_RE,
  SCH_RECEIPT_BUCKET,
  isReceiptMime,
} from "@/lib/sch/schema";

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  if (typeof raw !== "string" || !UUID_RE.test(raw)) {
    return NextResponse.json({ error: "invalid registration id" }, { status: 400 });
  }
  const id = raw.toLowerCase();

  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("sch_registrations")
    .select("id, game, receipt_path, receipt_mime")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (!row) return NextResponse.json({ error: "registration not found" }, { status: 404 });
  if (!row.receipt_path || !RECEIPT_PATH_RE.test(row.receipt_path)) {
    return NextResponse.json({ error: "no receipt" }, { status: 404 });
  }

  // Service role: the bucket has no storage policy at all (migration
  // 20260917110000); this admin-gated, audited route is its only read path.
  const svc = createServiceClient();
  const { data: blob, error: downloadError } = await svc.storage
    .from(SCH_RECEIPT_BUCKET)
    .download(row.receipt_path);
  if (downloadError || !blob) {
    return NextResponse.json({ error: "receipt unavailable" }, { status: 404 });
  }

  const mime = isReceiptMime(row.receipt_mime) ? row.receipt_mime : "application/octet-stream";
  const ext = isReceiptMime(row.receipt_mime) ? RECEIPT_MIME_EXT[row.receipt_mime] : "bin";

  // Written once the bytes are on their way back — a 404 is a refusal, not a look.
  await logReceiptView(id, row.game, auth.user, request);

  const body = Buffer.from(await blob.arrayBuffer());
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="receipt-${id.slice(0, 8)}.${ext}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function logReceiptView(
  registrationId: string,
  game: string,
  user: { id: string; email: string },
  request: NextRequest,
): Promise<void> {
  try {
    // `audit_log.ip` is inet: an unparsable header value would reject the
    // whole ledger row, so only a real address is stored.
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ip = isIP(forwarded) ? forwarded : null;
    await createServiceClient().from("audit_log").insert({
      action: "SCH_RECEIPT_VIEWED",
      detail: `registration=${registrationId} game=${game}`,
      user_id: user.id,
      user_email: user.email,
      ip,
    });
  } catch {
    // A ledger write that fails must not hide the receipt from the organiser.
  }
}
