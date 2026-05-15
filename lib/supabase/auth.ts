import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { createClient } from "./server";
import type { PublicProfile } from "@/lib/database.types";

const PUBLIC_PROFILE_COLUMNS = "id, email, full_name, role, totp_enabled, created_at, updated_at";

type AuthCtx = { user: { id: string; email: string }; profile: PublicProfile };
type ApiAuthOk = AuthCtx;
type ApiAuthErr = { error: NextResponse };
type ApiAuthResult = ApiAuthOk | ApiAuthErr;

function isAuthErr(r: ApiAuthResult): r is ApiAuthErr {
  return "error" in r;
}

/**
 * Page / Server Action: redirect хийдэг.
 */
export async function requireUser(): Promise<AuthCtx> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq("id", user.id)
    .single<PublicProfile>();

  if (error || !profile) {
    redirect("/login?error=no-profile");
  }

  return {
    user: { id: user.id, email: user.email! },
    profile,
  };
}

export async function requireAdmin() {
  const ctx = await requireUser();
  if (ctx.profile.role !== "admin") redirect("/dashboard?error=admin-only");
  return ctx;
}

/**
 * API Route Handler: 401/403 JSON буцаана (redirect биш).
 */
export async function requireAdminApi(): Promise<ApiAuthResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq("id", user.id)
    .single<PublicProfile>();

  if (error || !profile) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (profile.role !== "admin") return { error: NextResponse.json({ error: "forbidden: admin only" }, { status: 403 }) };
  return { user: { id: user.id, email: user.email! }, profile };
}

export async function requireUserApi(): Promise<ApiAuthResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq("id", user.id)
    .single<PublicProfile>();

  if (error || !profile) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { user: { id: user.id, email: user.email! }, profile };
}

export { isAuthErr };
export type { ApiAuthResult };

export async function getOptionalUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
