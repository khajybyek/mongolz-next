/**
 * DB-based rate limiting using audit_log table.
 * Хэрэглэгчийн хувийн (per-user) хязгаарлалт. IP биш — admin user-ийг target
 * хийсэн brute force / misuse-аас сэргийлнэ.
 *
 * Бид аль хэдийн audit_log-д бүх чухал үйлдэл бичигдэж байгаа тул түүгээр
 * count хийж дэр redis ч шаардахгүй.
 */
import { createServiceClient } from "@/lib/supabase/server";

export interface RateLimitOptions {
  /** Audit log-ын action нэр (LOGIN, REAUTH_OK, REVEAL_REQUEST, гэх мэт) */
  action: string | string[];
  /** Тоологдох цонх — секунд */
  windowSec: number;
  /** Дээд хязгаар (тоолуурын утга) */
  max: number;
}

export interface RateLimitResult {
  ok: boolean;
  count: number;
  resetSec: number;
  message?: string;
}

/**
 * Хэрэглэгчийн userId-ийн windowSec дотор `action`-уудын тоог тоолж max-аас
 * давсан эсэхийг буцаана.
 */
export async function checkRateLimit(
  userId: string,
  opts: RateLimitOptions
): Promise<RateLimitResult> {
  const svc = createServiceClient();
  const since = new Date(Date.now() - opts.windowSec * 1000).toISOString();

  const actions = Array.isArray(opts.action) ? opts.action : [opts.action];

  const { count } = await svc
    .from("audit_log")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("action", actions)
    .gte("created_at", since);

  const used = count ?? 0;
  if (used >= opts.max) {
    return {
      ok: false,
      count: used,
      resetSec: opts.windowSec,
      message: `Хэт олон хүсэлт (${used}/${opts.max} / ${formatWindow(opts.windowSec)}). Түр хүлээнэ үү.`,
    };
  }
  return { ok: true, count: used, resetSec: opts.windowSec };
}

function formatWindow(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} мин`;
  if (sec < 86400) return `${Math.round(sec / 3600)} цаг`;
  return `${Math.round(sec / 86400)} өдөр`;
}

// ── Default presets ────────────────────────────────────────────────
/** Step-up reauth: 1 минутад 5 удаа max — brute force-аас сэргийлнэ */
export const REAUTH_LIMIT: RateLimitOptions = {
  action: ["REAUTH_OK", "REAUTH_FAILED"],
  windowSec: 60,
  max: 5,
};

/** Reveal: 1 цагт 20 max — нэг админы misuse-аас сэргийлнэ */
export const REVEAL_LIMIT: RateLimitOptions = {
  action: "REVEAL_REQUEST",
  windowSec: 3600,
  max: 20,
};

// ── IP-based rate limiting (login attempts) ────────────────────────
/**
 * Login-д IP + email хослолоор rate limit хийнэ. Email-ээр шалгах нь нэг
 * accountad дайралт хязгаарладаг, IP-ээр шалгах нь credential stuffing-аас
 * сэргийлдэг.
 *
 * audit_log хүснэгтэд `ip` болон `detail` field байгаа тул шинэ table нэмэхгүй.
 */
export interface LoginAttemptOptions {
  ip: string | null;
  email: string;
  windowSec?: number;   // default 900 = 15 минут
  maxPerEmail?: number; // default 5
  maxPerIp?: number;    // default 10
}

export interface LoginRateLimitResult {
  ok: boolean;
  reason?: "email_locked" | "ip_locked";
  message?: string;
  retryAfterSec?: number;
}

export async function checkLoginRateLimit(
  opts: LoginAttemptOptions
): Promise<LoginRateLimitResult> {
  const svc = createServiceClient();
  const window = opts.windowSec ?? 15 * 60;
  const maxEmail = opts.maxPerEmail ?? 5;
  const maxIp = opts.maxPerIp ?? 10;
  const since = new Date(Date.now() - window * 1000).toISOString();

  // Email-ээр буруу login оролдлого
  const failedActions = ["LOGIN_FAILED", "TOTP_LOGIN_FAILED"];

  const { count: emailFails } = await svc
    .from("audit_log")
    .select("*", { count: "exact", head: true })
    .in("action", failedActions)
    .eq("user_email", opts.email)
    .gte("created_at", since);

  if ((emailFails ?? 0) >= maxEmail) {
    return {
      ok: false,
      reason: "email_locked",
      message: `Энэ имэйл рүү хэт олон буруу оролдлого (${emailFails}/${maxEmail}). ${Math.round(window / 60)} минутын дараа дахин оролдоно уу.`,
      retryAfterSec: window,
    };
  }

  // IP-ээр буруу login оролдлого (credential stuffing)
  if (opts.ip) {
    const { count: ipFails } = await svc
      .from("audit_log")
      .select("*", { count: "exact", head: true })
      .in("action", failedActions)
      .eq("ip", opts.ip)
      .gte("created_at", since);

    if ((ipFails ?? 0) >= maxIp) {
      return {
        ok: false,
        reason: "ip_locked",
        message: `Энэ IP хаягаас хэт олон буруу оролдлого (${ipFails}/${maxIp}). ${Math.round(window / 60)} минутын дараа дахин оролдоно уу.`,
        retryAfterSec: window,
      };
    }
  }

  return { ok: true };
}
