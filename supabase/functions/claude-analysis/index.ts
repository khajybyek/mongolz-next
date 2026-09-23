/**
 * MONGOLZ — Claude AI Analysis Edge Function
 * ─────────────────────────────────────────────
 * Endpoint: POST /functions/v1/claude-analysis
 *
 * Body:
 *   {
 *     mode: "summary" | "anomaly" | "chat",
 *     question?: string,         // chat mode-д хэрэглэгчийн мессеж
 *     history?: { role, content }[]  // chat history (optional)
 *   }
 *
 * DB-ээс faces / alerts / suspects / cameras-ыг авч контекст бэлдээд
 * Anthropic API руу Claude model-той дуудна.
 *
 * Хуучин mongolz/ai_analysis.py-ийн Ollama-г Claude-р солих.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// Current-generation model IDs (no date suffixes — these are complete as-is).
// CLAUDE_MODEL env may override the primary model; the fallback chain covers
// a retired/invalid override without a redeploy.
const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-opus-5";
const FALLBACK_CHAIN = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];
const MAX_HISTORY = 20;
const MAX_MESSAGE_CHARS = 4000;
const MODES = new Set(["summary", "anomaly", "chat"]);

interface RequestBody {
  mode: "summary" | "anomaly" | "chat";
  question?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

const SYSTEM_PROMPT = `Чи MONGOLZ Security системийн AI шинжээч. Монгол хэлээр товч, тодорхой хариул.
Чи нь нүүр таних CCTV хяналтын систем дээр ажиллаж байгаа бөгөөд дараах өгөгдлүүд дээр шинжилгээ хийнэ:
- Илрүүлсэн царайнууд (faces)
- Сэжигтэн илэрсэн alert-ууд
- Бүртгэгдсэн сэжигтнүүд (suspects)
- Камерууд (cameras)

Чухал зүйлс:
1. Аюулгүй байдлын үнэлгээг 1-10 онооноор тодорхойл
2. Аномали (хэвийн бус цаг, давтагдсан сэжигтэн)-ийг тэмдэглэ
3. Тоо баримтад тулгуурла, тааварлуулах хариулт өгөхгүй
4. Хэрвээ data хангалтгүй бол тэгж хэлээрэй`;

const KST_OFFSET_MS = 9 * 3600 * 1000;

/** UTC instant at which the current Asia/Seoul calendar day began. */
function kstDayStartUtc(now: Date): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS);
}

/** "YYYY-MM-DD HH:mm:ss" wall-clock time in Asia/Seoul (the prompts say KST). */
function kstTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

function userPromptFor(mode: string, ctx: any, question?: string): string {
  if (mode === "summary") {
    return `Систем дээрх дараах статистик үнэлгээ хий (цаг: KST, UTC+9):

Илрүүлсэн царай: ${ctx.faceCount}
Сэжигтэн: ${ctx.suspectCount}
Нийт alert: ${ctx.alertCount}
Өнөөдрийн alert: ${ctx.todayAlerts}
Камер тоо: ${ctx.cameraCount}

Сүүлийн 5 alert:
${ctx.recentAlerts.slice(0, 5).map((a: any) => `- ${a.suspect_name} (${Math.round(a.similarity * 100)}%) — ${kstTime(a.created_at)}`).join("\n")}

Аюулгүй байдлын ерөнхий үнэлгээг 1-10 оноогоор гарга.`;
  }

  if (mode === "anomaly") {
    return `Дараах alert-уудаас аномали байгаа эсэхийг шинжил.
Бүх цаг KST (UTC+9). Шөнийн цаг (22:00 - 06:00 KST) илэрсэн сэжигтэн, нэг хүн давтагдан илэрч буй эсэх, ер бусын хэвээ илрүүлэх.

Сүүлийн 20 alert:
${(ctx.recentAlerts ?? []).map((a: any) => `- ${a.suspect_name} (${Math.round(a.similarity * 100)}%) — ${kstTime(a.created_at)} @ ${a.camera_name ?? "Unknown"}`).join("\n")}`;
  }

  // chat
  return `Хэрэглэгчийн асуулт: ${question}

Системийн өнөөгийн төлөв:
- Илрүүлсэн царай: ${ctx.faceCount}
- Сэжигтэн: ${ctx.suspectCount}
- Нийт alert: ${ctx.alertCount}
- Өнөөдрийн alert: ${ctx.todayAlerts}`;
}

/**
 * True when the (gateway-verified) JWT proves nothing but a password.
 * Mirrors private.mfa_ok(): only an amr made up ENTIRELY of "password"
 * entries is refused; anything unreadable fails open, so the sessions the app
 * mints after TOTP / passkey (amr = otp) are never turned away.
 */
function passwordOnlyToken(token: string): boolean {
  try {
    const part = token.split(".")[1] ?? "";
    const claims = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    const amr = claims?.amr;
    if (!Array.isArray(amr) || amr.length === 0) return false;
    return amr.every((e: unknown) =>
      (typeof e === "string" ? e : (e as { method?: unknown })?.method) === "password",
    );
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ── Authorization (Supabase JWT шалгах) ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  // ── Role шалгах ──
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, totp_enabled")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return new Response(JSON.stringify({ error: "admin only" }), { status: 403 });
  }

  // ── Second factor ──
  // This function is reachable straight from the internet with any valid
  // user JWT, bypassing the Next proxy (requireAdminApi). A token from the
  // public password grant (amr = [password]) must not read alert data: same
  // rule the app (totp_required) and the data tier (private.mfa_ok) apply.
  if (!profile.totp_enabled) {
    return new Response(JSON.stringify({ error: "totp_required" }), { status: 403 });
  }
  if (passwordOnlyToken(authHeader.slice(7))) {
    return new Response(JSON.stringify({ error: "second factor required" }), { status: 403 });
  }

  // ── Body уншиx + validation ──
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400 });
  }
  if (!body || !MODES.has(body.mode)) {
    return new Response(JSON.stringify({ error: "mode must be summary | anomaly | chat" }), { status: 400 });
  }
  if (body.mode === "chat" && (typeof body.question !== "string" || !body.question.trim())) {
    return new Response(JSON.stringify({ error: "question required for chat mode" }), { status: 400 });
  }
  const question = body.question?.slice(0, MAX_MESSAGE_CHARS);
  // Client-supplied history is bounded and shape-checked; anything else is dropped.
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));

  // ── DB-ээс контекст цуглуулах ──
  // With the CALLER's token, not the service role: RLS (admin policies + the
  // RESTRICTIVE "second factor required" policies) decides what this request
  // may see, so the function can never hand out more than PostgREST would.
  const svc = supabase;

  // Leave a trace BEFORE the data is read or the model is called (it used to
  // be written only after a successful answer, so a failed or aborted call
  // that had already pulled the context left nothing). Service role is used
  // for this insert ONLY.
  try {
    const ledger = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    await ledger.from("audit_log").insert({
      action: "AI_ANALYSIS",
      detail: `mode=${body.mode}`,
      user_id: user.id,
      user_email: user.email ?? null,
    });
  } catch {
    /* best effort */
  }

  // "Today" is the Asia/Seoul calendar day, like the dashboard. The edge
  // runtime is UTC, so setHours(0) started the day at 09:00 KST. Korea has no
  // DST: a fixed +9 h offset is exact.
  const today = kstDayStartUtc(new Date());

  const [faces, suspects, alerts, todayAlerts, cameras, recent] = await Promise.all([
    svc.from("faces").select("*", { count: "exact", head: true }),
    svc.from("suspects").select("*", { count: "exact", head: true }),
    svc.from("alerts").select("*", { count: "exact", head: true }),
    svc.from("alerts").select("*", { count: "exact", head: true }).gte("created_at", today.toISOString()),
    svc.from("cameras").select("*", { count: "exact", head: true }),
    svc.from("alerts")
      .select("suspect_name, similarity, camera_name, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const ctx = {
    faceCount: faces.count ?? 0,
    suspectCount: suspects.count ?? 0,
    alertCount: alerts.count ?? 0,
    todayAlerts: todayAlerts.count ?? 0,
    cameraCount: cameras.count ?? 0,
    recentAlerts: recent.data ?? [],
  };

  // ── Anthropic Claude ──
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), { status: 500 });
  }

  const messages = [...history, { role: "user", content: userPromptFor(body.mode, ctx, question) }];

  // Model fallback chain — a retired/invalid CLAUDE_MODEL override falls back
  // to the current generation without a redeploy.
  const FALLBACK_MODELS = [CLAUDE_MODEL, ...FALLBACK_CHAIN.filter((m) => m !== CLAUDE_MODEL)];

  let claudeRes: Response | null = null;
  let lastErr = "";
  let usedModel = "";

  for (const model of FALLBACK_MODELS) {
    console.log(`[claude-analysis] Trying model: ${model}`);
    claudeRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (claudeRes.ok) {
      usedModel = model;
      console.log(`[claude-analysis] SUCCESS with model: ${model}`);
      break;
    }

    lastErr = await claudeRes.text();
    console.error(
      `[claude-analysis] Model ${model} failed: HTTP ${claudeRes.status} — ${lastErr.slice(0, 500)}`,
    );
    // Model invalid/retired бол fallback оролдох. Бусад алдааг шууд буцаах.
    const isModelError = claudeRes.status === 404 ||
      /model.*not.*found|invalid.*model|not_found_error/i.test(lastErr);
    if (!isModelError) {
      console.error(`[claude-analysis] Non-model error — stopping fallback chain`);
      break;
    }
  }

  if (!claudeRes || !claudeRes.ok) {
    // Алдааг ангилж тодорхой мессеж буцаах
    let userMessage = `Claude API алдаа (HTTP ${claudeRes?.status ?? 0})`;
    if (/credit balance is too low|insufficient.*credit/i.test(lastErr)) {
      userMessage =
        "Anthropic credit балланс хоосон байна. https://console.anthropic.com/settings/billing руу орж credit-ээ нэмнэ үү.";
    } else if (/invalid.*api.*key|authentication_error/i.test(lastErr)) {
      userMessage =
        "ANTHROPIC_API_KEY буруу эсвэл revoke хийгдсэн. Шинэ key үүсгэж тохируулна уу.";
    } else if (/rate.*limit|overloaded/i.test(lastErr)) {
      userMessage = "Anthropic API rate limit хэтэрсэн. Хэдэн минутын дараа дахин туршина уу.";
    } else if (/model.*not.*found|invalid.*model/i.test(lastErr)) {
      userMessage = `Claude model "${CLAUDE_MODEL}" буруу. CLAUDE_MODEL env-ийг зөв model ID-аар шинэчилнэ үү.`;
    }

    // Upstream detail stays in the function logs (above); the client gets the
    // classified message only.
    return new Response(
      JSON.stringify({ error: userMessage, models_tried: FALLBACK_MODELS, anthropic_status: claudeRes?.status ?? 0 }),
      { status: 502 },
    );
  }

  const claudeData = await claudeRes.json();
  // Adaptive thinking is on by default on current models: the first content
  // block may be a `thinking` block — take the first `text` block instead.
  const text: string = (claudeData.content ?? [])
    .filter((b: { type?: string }) => b?.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("\n")
    .trim();
  if (claudeData.stop_reason === "refusal") {
    return new Response(JSON.stringify({ error: "Claude энэ хүсэлтэд хариулахаас татгалзлаа." }), { status: 422 });
  }

  return new Response(
    JSON.stringify({
      text,
      model: usedModel,           // Аль snapshot амжилттай ажилласан (fallback-ийн дараа)
      model_requested: CLAUDE_MODEL,
      fell_back: usedModel !== CLAUDE_MODEL,
      context: ctx,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
