import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { isProductionRuntime, missingProductionSecrets } from "@/lib/env-check";

/**
 * Admin-only auth health probe. Besides "is the session valid" it reports
 * whether the production signing secrets are configured — by NAME only —
 * because a missing one (REAUTH_COOKIE_SECRET above all) silently breaks
 * TOTP login + step-up while every other probe stays green.
 */
export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const missing = missingProductionSecrets();
  const config = { ok: missing.length === 0, missing, production: isProductionRuntime() };
  const detail = config.ok
    ? "Auth session valid"
    : `Auth session valid · missing secrets: ${missing.join(", ")}`;

  return NextResponse.json({ status: "ok", detail, config });
}
