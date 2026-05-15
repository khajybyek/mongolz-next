// One-time Sentry verification endpoint. Delete after first successful capture.
export async function GET() {
  throw new Error("MONGOLZ_SENTRY_TEST: deliberate error for integration check");
}
