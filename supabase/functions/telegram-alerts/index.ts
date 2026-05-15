import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface AlertPayload {
  suspect_name: string;
  similarity: number;
  camera_name: string;
  created_at: string;
  screenshot_path?: string;
}

const TELEGRAM_API = "https://api.telegram.org";

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");

  if (!botToken || !chatId || !webhookSecret) {
    return new Response(
      JSON.stringify({
        error: "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, or TELEGRAM_WEBHOOK_SECRET not configured",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const headerSecret = req.headers.get("x-webhook-secret");
  if (headerSecret !== webhookSecret) {
    return new Response(JSON.stringify({ error: "Invalid webhook secret" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: AlertPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const similarityPercent = (payload.similarity * 100).toFixed(1);
  const detectedAt = new Date(payload.created_at).toLocaleString("mn-MN", {
    timeZone: "Asia/Seoul", // KST (UTC+9)
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const message =
    `🚨 *MONGOLZ Security Alert*\n\n` +
    `👤 *Сэжигтэн:* ${escapeMarkdown(payload.suspect_name)}\n` +
    `📊 *Тохирол:* ${escapeMarkdown(similarityPercent)}%\n` +
    `📹 *Камер:* ${escapeMarkdown(payload.camera_name)}\n` +
    `🕐 *Цаг:* ${escapeMarkdown(detectedAt)}`;

  try {
    const tgResponse = await fetch(
      `${TELEGRAM_API}/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "MarkdownV2",
        }),
      },
    );

    const tgResult = await tgResponse.json();

    if (!tgResponse.ok) {
      return new Response(
        JSON.stringify({
          error: "Telegram API error",
          telegram_response: tgResult,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, message_id: tgResult.result?.message_id }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Network error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
