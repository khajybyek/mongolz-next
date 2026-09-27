/**
 * Telegram message rendering for the telegram-alerts edge function. Pure (no
 * Deno or network APIs) so Jest can import it: __tests__/telegram-alerts-
 * messages.test.ts ties the uptime kinds private.uptime_collect() posts to
 * the renderer.
 */

export interface AlertPayload {
  kind?: "alert";
  suspect_name: string | null;
  similarity: number | null;
  camera_name: string | null;
  created_at: string;
  screenshot_path?: string | null;
}

/** Posted by lib/notify.ts when a reveal job enters pending_approval (4-eyes). */
export interface RevealRequestedPayload {
  kind: "reveal_requested";
  job_id: string;
  recording_id: string;
  requester_email: string | null;
  method: string;
  threshold?: number | null;
  created_at?: string;
}

/** Posted by lib/notify.ts when the second admin approves / rejects. */
export interface RevealDecidedPayload {
  kind: "reveal_decided";
  job_id: string;
  approved: boolean;
  requester_email: string | null;
  decider_email: string | null;
  reason?: string | null;
  decided_at?: string;
}

/**
 * Posted by private.uptime_collect() (pg_cron), one per component transition
 * between two /api/uptime probes: web = aicctv.dev answered with its JSON body,
 * db / ml = the checks that body reports (compared only while the web answers).
 */
export const UPTIME_KINDS = [
  "web_down",
  "web_recovered",
  "db_down",
  "db_recovered",
  "ml_down",
  "ml_recovered",
] as const;
export type UptimeKind = (typeof UPTIME_KINDS)[number];
export interface UptimePayload {
  kind: UptimeKind;
  checked_at: string;
}

/**
 * Posted by lib/notify.ts#notifySecurityEvent for admin-level changes a stolen
 * session would make (2FA changes, user management, retention, permissions).
 */
export interface SecurityEventPayload {
  kind: "security_event";
  action: string;
  actor_email: string | null;
  detail?: string | null;
  at?: string;
}

export type Payload = SecurityEventPayload | AlertPayload | RevealRequestedPayload | RevealDecidedPayload | UptimePayload;

const APPROVALS_URL = "https://aicctv.dev/reveal-approvals";
const JOBS_URL = "https://aicctv.dev/jobs";
const AUDIT_URL = "https://aicctv.dev/audit";

export function escapeMarkdown(text: string | null | undefined): string {
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
  switch (p.kind) {
    case "web_down":
      return (
        `🔴 *Web app DOWN*\n\n` +
        `aicctv\\.dev нь /api/uptime\\-д хариу өгөхгүй байна \\(timeout, 5xx эсвэл JSON биш хариу\\) — ` +
        `консол болон шууд урсгал нээгдэхгүй\\. ML / DB төлөв тодорхойгүй\\.\n` +
        `🕐 *Шалгасан:* ${at}\n\n` +
        `Runbook: Vercel → \`vercel ls --prod\`, \`vercel logs --json\`; \`curl -si https://aicctv.dev/api/uptime\``
      );
    case "web_recovered":
      return (
        `🟢 *Web app recovered*\n\n` +
        `aicctv\\.dev дахин хариу өгч байна\\. ML / DB төлөв өөрчлөгдсөн бол тусад нь мэдэгдэнэ\\.\n` +
        `🕐 *Шалгасан:* ${at}`
      );
    case "db_down":
      return (
        `🔴 *Database DOWN*\n\n` +
        `Web app Supabase DB\\-д хүрч чадахгүй байна — нэвтрэлт, бичлэг, alert хадгалалт зогсоно\\.\n` +
        `🕐 *Шалгасан:* ${at}\n\n` +
        `Runbook: Supabase dashboard → Project health / API logs; \`curl -s https://aicctv.dev/api/uptime\``
      );
    case "db_recovered":
      return (
        `🟢 *Database recovered*\n\n` +
        `Web app → Supabase DB холболт хэвийн ажиллаж байна\\.\n` +
        `🕐 *Шалгасан:* ${at}`
      );
    case "ml_down":
      return (
        `🔴 *ML service DOWN*\n\n` +
        `Face detection / recognition зогссон — шинэ бичлэг боловсруулагдахгүй\\.\n` +
        `🕐 *Шалгасан:* ${at}\n\n` +
        `Runbook: Railway logs → \`railway logs --tail 80\`, дараа нь \`railway up --detach\``
      );
    case "ml_recovered":
      return (
        `🟢 *ML service recovered*\n\n` +
        `Face detection / recognition хэвийн ажиллаж байна\\.\n` +
        `🕐 *Шалгасан:* ${at}`
      );
  }
}

function securityEventMessage(p: SecurityEventPayload): string {
  const detail = p.detail ? `📝 *Дэлгэрэнгүй:* ${escapeMarkdown(p.detail)}\n` : "";
  return (
    `🛡 *MONGOLZ аюулгүй байдлын өөрчлөлт*\n\n` +
    `⚙️ *Үйлдэл:* \`${String(p.action ?? "").replace(/[`\\]/g, "\\$&")}\`\n` +
    `👤 *Хийсэн:* ${escapeMarkdown(p.actor_email)}\n` +
    detail +
    `🕐 *Цаг:* ${escapeMarkdown(formatKst(p.at))}\n\n` +
    `Та өөрөө хийгээгүй бол session\\-аа шалгаж, нууц үгээ солино уу\\.\n` +
    `👉 ${mdLink("Audit log", AUDIT_URL)}`
  );
}

export function buildMessage(payload: Payload): string {
  switch (payload.kind) {
    case "reveal_requested":
      return revealRequestedMessage(payload);
    case "reveal_decided":
      return revealDecidedMessage(payload);
    case "security_event":
      return securityEventMessage(payload);
    case "web_down":
    case "web_recovered":
    case "db_down":
    case "db_recovered":
    case "ml_down":
    case "ml_recovered":
      return uptimeMessage(payload);
    default:
      // undefined / "alert" — the DB trigger never sets `kind`.
      return alertMessage(payload as AlertPayload);
  }
}
