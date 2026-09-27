import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { buildMessage, type Payload } from "./messages.ts";

const TELEGRAM_API = "https://api.telegram.org";

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
