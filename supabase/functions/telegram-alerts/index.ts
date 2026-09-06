import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface AlertPayload {
  kind?: "alert";
  suspect_name: string | null;
  similarity: number | null;
  camera_name: string | null;
  created_at: string;
  screenshot_path?: string | null;
}

/** Posted by lib/notify.ts when a reveal job enters pending_approval (4-eyes). */
interface RevealRequestedPayload {
  kind: "reveal_requested";
  job_id: string;
  recording_id: string;
  requester_email: string | null;
  method: string;
  threshold?: number | null;
  created_at?: string;
}

/** Posted by lib/notify.ts when the second admin approves / rejects. */
interface RevealDecidedPayload {
  kind: "reveal_decided";
  job_id: string;
  approved: boolean;
  requester_email: string | null;
  decider_email: string | null;
  reason?: string | null;
  decided_at?: string;
}

/** Posted by private.uptime_collect() (pg_cron) on an ML ok↔down transition. */
interface UptimePayload {
  kind: "ml_down" | "ml_recovered";
  checked_at: string;
}

type Payload = AlertPayload | RevealRequestedPayload | RevealDecidedPayload | UptimePayload;

const TELEGRAM_API = "https://api.telegram.org";
const APPROVALS_URL = "https://aicctv.dev/reveal-approvals";
const JOBS_URL = "https://aicctv.dev/jobs";

function escapeMarkdown(text: string | null | undefined): string {
  return String(text ?? "—").replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

/**
 * MarkdownV2 inline link. Inside the `(...)` part only `)` and `\` need
 * escaping; the label goes through the normal escaper.
 */
function mdLink(label: string, url: string): string {
  return `[${escapeMarkdown(label)}](${url.replace(/[)\\]/g, "\\$&")})`;
}

/** KST (UTC+9) wall-clock, the timezone every other timestamp in the app uses. */
function formatKst(iso: string | null | undefined): string {
  const d = new Date(iso ?? Date.now());
  return (Number.isNaN(d.getTime()) ? new Date() : d).toLocaleString("mn-MN", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Caller authentication.
 *
 * The DB trigger (notify_telegram_on_alert, pg_net) sends the project's
 * service-role JWT as `Authorization: Bearer …`. The Supabase gateway has
 * already verified that JWT's signature (verify_jwt = true), so checking
 * that its `role` claim is `service_role` is sufficient. A static
 * `x-webhook-secret` header is accepted as an alternative when
 * TELEGRAM_WEBHOOK_SECRET is configured (for non-DB callers).
 */
function isAuthorised(req: Request): boolean {
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  const headerSecret = req.headers.get("x-webhook-secret");
  if (secret && headerSecret && constantTimeEqual(headerSecret, secret)) return true;

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function alertMessage(payload: AlertPayload): string {
  const similarity = typeof payload.similarity === "number" ? payload.similarity : Number(payload.similarity ?? 0);
  const similarityPercent = (Number.isFinite(similarity) ? similarity * 100 : 0).toFixed(1);
  const detectedAt = formatKst(payload.created_at);

  return (
    `🚨 *MONGOLZ Security Alert*\n\n` +
    `👤 *Сэжигтэн:* ${escapeMarkdown(payload.suspect_name)}\n` +
    `📊 *Тохирол:* ${escapeMarkdown(similarityPercent)}%\n` +
    `📹 *Камер:* ${escapeMarkdown(payload.camera_name)}\n` +
    `🕐 *Цаг:* ${escapeMarkdown(detectedAt)}`
  );
}

function revealRequestedMessage(p: RevealRequestedPayload): string {
  return (
    `🔐 *MONGOLZ Reveal хүсэлт* — 2 дахь админы зөвшөөрөл хүлээж байна\n\n` +
    `👤 *Хүсэгч:* ${escapeMarkdown(p.requester_email)}\n` +
    `🎞 *Бичлэг:* \`${escapeMarkdown(String(p.recording_id ?? "").slice(0, 8))}\`\n` +
    `🧭 *Арга:* ${escapeMarkdown(p.method)}\n` +
    `🕐 *Цаг:* ${escapeMarkdown(formatKst(p.created_at))}\n\n` +
    `👉 ${mdLink("Зөвшөөрөл өгөх / татгалзах", APPROVALS_URL)}`
  );
}

function revealDecidedMessage(p: RevealDecidedPayload): string {
  const head = p.approved
    ? `✅ *Reveal зөвшөөрөгдлөө* — decrypt эхэллээ`
    : `⛔ *Reveal татгалзагдлаа*`;
  const reason = !p.approved && p.reason ? `📝 *Шалтгаан:* ${escapeMarkdown(p.reason)}\n` : "";
  return (
    `${head}\n\n` +
    `🆔 *Job:* \`${escapeMarkdown(String(p.job_id ?? "").slice(0, 8))}\`\n` +
    `👤 *Хүсэгч:* ${escapeMarkdown(p.requester_email)}\n` +
    `🧑‍⚖️ *Шийдвэрлэсэн:* ${escapeMarkdown(p.decider_email)}\n` +
    reason +
    `🕐 *Цаг:* ${escapeMarkdown(formatKst(p.decided_at))}\n\n` +
    `👉 ${mdLink("Job-ууд харах", JOBS_URL)}`
  );
}

function uptimeMessage(p: UptimePayload): string {
  const at = escapeMarkdown(formatKst(p.checked_at));
  if (p.kind === "ml_down") {
    return (
      `🔴 *ML service DOWN*\n\n` +
      `Face detection / recognition зогссон — шинэ бичлэг боловсруулагдахгүй\\.\n` +
      `🕐 *Шалгасан:* ${at}\n\n` +
      `Runbook: Railway logs → \`railway logs --tail 80\`, дараа нь \`railway up --detach\``
    );
  }
  return (
    `🟢 *ML service recovered*\n\n` +
    `Face detection / recognition хэвийн ажиллаж байна\\.\n` +
    `🕐 *Шалгасан:* ${at}`
  );
}

function buildMessage(payload: Payload): string {
  switch (payload.kind) {
    case "reveal_requested":
      return revealRequestedMessage(payload);
    case "reveal_decided":
      return revealDecidedMessage(payload);
    case "ml_down":
    case "ml_recovered":
      return uptimeMessage(payload);
    default:
      // undefined / "alert" — the DB trigger never sets `kind`.
      return alertMessage(payload as AlertPayload);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!botToken || !chatId) {
    return json({ error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured" }, 500);
  }

  if (!isAuthorised(req)) return json({ error: "unauthorized" }, 401);

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!payload || typeof payload !== "object") return json({ error: "Invalid JSON" }, 400);

  const message = buildMessage(payload);

  try {
    const tgResponse = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "MarkdownV2" }),
    });
    const tgResult = await tgResponse.json().catch(() => ({}));
    if (!tgResponse.ok) {
      console.error("telegram sendMessage failed", tgResponse.status, tgResult?.description);
      return json({ error: "Telegram API error", status: tgResponse.status }, 502);
    }
    return json({ ok: true, message_id: tgResult.result?.message_id });
  } catch (e) {
    console.error("telegram network error", e instanceof Error ? e.message : e);
    return json({ error: "Network error" }, 500);
  }
});
