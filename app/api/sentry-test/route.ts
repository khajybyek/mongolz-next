// One-time Sentry verification endpoint. Delete after first successful capture.
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

export async function GET() {
  const err = new Error("MONGOLZ_SENTRY_TEST: deliberate error for integration check");
  Sentry.captureException(err, { tags: { test: "manual-capture" } });
  await Sentry.flush(3000);
  return NextResponse.json(
    { captured: true, dsn_set: !!process.env.NEXT_PUBLIC_SENTRY_DSN },
    { status: 500 },
  );
}
