// Sentry integration verification endpoint.
//
// Admin-gated because anyone hitting it generates a Sentry error event,
// which would quietly burn quota and pollute the dashboard. Calling from an
// admin session captures a tagged "manual-capture" event so the operator can
// confirm the pipeline still works after env-var or DSN rotations.
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const err = new Error("MONGOLZ_SENTRY_TEST: deliberate error for integration check");
  Sentry.captureException(err, { tags: { test: "manual-capture" } });
  await Sentry.flush(3000);
  return NextResponse.json(
    { captured: true, dsn_set: !!process.env.NEXT_PUBLIC_SENTRY_DSN },
    { status: 200 },
  );
}
