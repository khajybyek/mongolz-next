"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkLoginRateLimit } from "@/lib/rate-limit";
import { verifyTOTP } from "@/lib/totp";

/** Хэрэглэгчийн IP-ийг (Vercel-аас ирсэн x-forwarded-for header)-аас авах */
async function getClientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim();
    return h.get("x-real-ip");
  } catch {
    return null;
  }
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const totpCode = String(formData.get("totp_code") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!email || !password) {
    return redirect("/login?error=Invalid+credentials");
  }

  const ip = await getClientIp();

  // Rate limit шалгах (5 fail/email/15min, 10 fail/IP/15min)
  const rl = await checkLoginRateLimit({ ip, email });
  if (!rl.ok) {
    // Audit-аас үлдээх — хязгаарт хүрсэн оролдлого
    try {
      const svc = createServiceClient();
      await svc.from("audit_log").insert({
        action: "LOGIN_BLOCKED",
        detail: `${rl.reason}: ${rl.message}`,
        user_email: email,
        ip,
      });
    } catch {}
    return redirect(`/login?error=${encodeURIComponent(rl.message ?? "Too many attempts")}`);
  }

  const supabase = await createClient();
  const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // ВАЖНО: Generic error message — "email буруу" эсвэл "password буруу"
    // гэж ялгахгүй (user enumeration attack-аас сэргийлнэ).
    try {
      const svc = createServiceClient();
      await svc.from("audit_log").insert({
        action: "LOGIN_FAILED",
        detail: `Reason: ${error.message}`,
        user_email: email,
        ip,
      });
    } catch {}
    return redirect("/login?error=Invalid+credentials");
  }

  const svc = createServiceClient();
  const user = signInData.user;
  if (!user) {
    await supabase.auth.signOut();
    return redirect("/login?error=Invalid+credentials");
  }

  const { data: profile } = await svc
    .from("profiles")
    .select("id, totp_enabled, totp_secret")
    .eq("id", user.id)
    .single();

  if (!profile) {
    await supabase.auth.signOut();
    return redirect("/login?error=Invalid+credentials");
  }

  if (profile.totp_enabled) {
    const ok = profile.totp_secret && verifyTOTP(profile.totp_secret, totpCode);
    if (!ok) {
      await supabase.auth.signOut();
      try {
        await svc.from("audit_log").insert({
          action: "TOTP_LOGIN_FAILED",
          detail: "2FA code missing or invalid",
          user_id: user.id,
          user_email: email,
          ip,
        });
      } catch {}
      return redirect("/login?error=Invalid+2FA+code");
    }
  }

  // Audit log — password + required TOTP амжилттай болсны дараа л login гэж бүртгэнэ.
  try {
    await svc.from("audit_log").insert({
      action: "LOGIN",
      detail: `Email: ${email}`,
      user_email: email,
      ip,
    });
  } catch {
    // audit фэйл болсон ч login алдаа болгохгүй
  }

  revalidatePath("/", "layout");
  const safeNext = sanitizeNextPath(next);
  redirect(safeNext as never);
}

function sanitizeNextPath(raw: string): string {
  if (!raw) return "/dashboard";
  try {
    const decoded = decodeURIComponent(raw);
    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      decoded.startsWith("/\\") ||
      decoded.includes("://")
    ) {
      return "/dashboard";
    }
    return decoded;
  } catch {
    return "/dashboard";
  }
}
