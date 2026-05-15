// One-time Sentry verification endpoint. Delete after first successful capture.
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

export async function GET() {
  const client = Sentry.getClient();
  const options = client?.getOptions();
  const eventId = Sentry.captureException(
    new Error("MONGOLZ_SENTRY_TEST: deliberate error for integration check"),
    { tags: { test: "manual-capture" } },
  );
  const flushed = await Sentry.flush(5000);

  return NextResponse.json({
    captured: true,
    event_id: eventId,
    flushed,
    client_present: !!client,
    sdk_enabled: options?.enabled ?? null,
    dsn_present: !!options?.dsn,
    dsn_host: options?.dsn ? new URL(options.dsn).host : null,
    env_dsn_set: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
    env_dsn_host: process.env.NEXT_PUBLIC_SENTRY_DSN
      ? new URL(process.env.NEXT_PUBLIC_SENTRY_DSN).host
      : null,
  });
}
