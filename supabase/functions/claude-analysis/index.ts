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
// Production-д snapshot ID хэрэглэх (Anthropic-ийн зөвлөгөө) — alias биш.
// CLAUDE_MODEL env-ээр override хийх боломжтой.
// Дэлгэрэнгүй: https://docs.anthropic.com/en/docs/about-claude/models
const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-4-20250514";

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

function userPromptFor(mode: string, ctx: any, question?: string): string {
  if (mode === "summary") {
    return `Систем дээрх дараах статистик үнэлгээ хий:

Илрүүлсэн царай: ${ctx.faceCount}
Сэжигтэн: ${ctx.suspectCount}
Нийт alert: ${ctx.alertCount}
Өнөөдрийн alert: ${ctx.todayAlerts}
Камер тоо: ${ctx.cameraCount}

Сүүлийн 5 alert:
${ctx.recentAlerts.map((a: any) => `- ${a.suspect_name} (${Math.round(a.similarity * 100)}%) — ${a.created_at}`).join("\n")}

Аюулгүй байдлын ерөнхий үнэлгээг 1-10 оноогоор гарга.`;
  }

  if (mode === "anomaly") {
    return `Дараах alert-уудаас аномали байгаа эсэхийг шинжил.
Шөнийн цаг (22:00 - 06:00) илэрсэн сэжигтэн, нэг хүн давтагдан илэрч буй эсэх, ер бусын хэвээ илрүүлэх.

Сүүлийн 20 alert:
${(ctx.recentAlerts ?? []).map((a: any) => `- ${a.suspect_name} (${Math.round(a.similarity * 100)}%) — ${a.created_at} @ ${a.camera_name ?? "Unknown"}`).join("\n")}`;
  }

  // chat
  return `Хэрэглэгчийн асуулт: ${question}

Системийн өнөөгийн төлөв:
- Илрүүлсэн царай: ${ctx.faceCount}
- Сэжигтэн: ${ctx.suspectCount}
- Нийт alert: ${ctx.alertCount}
- Өнөөдрийн alert: ${ctx.todayAlerts}`;
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
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return new Response(JSON.stringify({ error: "admin only" }), { status: 403 });
  }

  // ── Body уншиx ──
  const body = (await req.json()) as RequestBody;

  // ── DB-ээс контекст цуглуулах (service-role-оор) ──
  const svc = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

  const messages = body.history ?? [];
  messages.push({
    role: "user",
    content: userPromptFor(body.mode, ctx, body.question),
  });

  // Model fallback chain — хэрэв тохируулсан snapshot retired/invalid бол
  // мэдэгдэлтэй stable snapshot руу унаж дахин оролдоно.
  const FALLBACK_MODELS = [
    CLAUDE_MODEL,                      // default: claude-sonnet-4-20250514
    "claude-sonnet-4-20250514",        // Sonnet 4 original (long-lived stable)
    "claude-3-5-sonnet-20241022",      // 2024 Sonnet (very stable, older)
  ];

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
        max_tokens: 2048,
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
    let userMessage = `Claude API failed: ${lastErr.slice(0, 200)}`;
    if (/credit balance is too low|insufficient.*credit/i.test(lastErr)) {
      userMessage =
        "Anthropic credit балланс хоосон байна. https://console.anthropic.com/settings/billing руу орж credit-ээ нэмнэ үү.";
    } else if (/invalid.*api.*key|authentication_error/i.test(lastErr)) {
      userMessage =
        "ANTHROPIC_API_KEY буруу эсвэл revoke хийгдсэн. Шинэ key үүсгэж тохируулна уу.";
    } else if (/rate.*limit|overloaded/i.test(lastErr)) {
      userMessage = "Anthropic API rate limit хэтэрсэн. Хэдэн минутын дараа дахин туршина уу.";
    } else if (/model.*not.*found|invalid.*model/i.test(lastErr)) {
      userMessage = `Claude model "${CLAUDE_MODEL}" буруу. CLAUDE_MODEL env-ийг snapshot ID-аар шинэчилнэ үү.`;
    }

    return new Response(
      JSON.stringify({
        error: userMessage,
        raw_error: lastErr.slice(0, 300),
        models_tried: FALLBACK_MODELS,
        anthropic_status: claudeRes?.status ?? 0,
      }),
      { status: 502 },
    );
  }

  const claudeData = await claudeRes.json();
  const text = claudeData.content?.[0]?.text ?? "";

  // ── Audit log ──
  await svc.from("audit_log").insert({
    action: "AI_ANALYSIS",
    detail: `mode=${body.mode}`,
    user_id: user.id,
    user_email: user.email,
  });

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
