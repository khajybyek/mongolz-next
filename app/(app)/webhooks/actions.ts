"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { dispatchEvent } from "@/lib/webhooks";
import { ensureFreshReauth } from "@/lib/auth/step-up";

const EVENTS = ["alert_created", "reveal_completed", "system_health", "audit_critical"] as const;

async function audit(action: string, detail: string, userId: string, userEmail: string) {
  try {
    await createServiceClient().from("audit_log").insert({
      action,
      detail,
      user_id: userId,
      user_email: userEmail,
    });
  } catch {}
}

/**
 * SSRF blocklist: prevent webhooks from targeting internal-only addresses.
 * - localhost / loopback (IPv4 + IPv6)
 * - RFC 1918 private networks (10/8, 172.16/12, 192.168/16)
 * - Link-local (169.254/16 — includes cloud metadata 169.254.169.254)
 * - Carrier-grade NAT (100.64/10)
 * - .internal / .local / .home suffixes
 */
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127(\.|$)/,
  /^::1$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /\.(internal|local|home|lan)$/i,
];

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return PRIVATE_HOST_PATTERNS.some((p) => p.test(h));
}

function publicHttpsUrl(raw: unknown, ctx: z.RefinementCtx): void {
  if (typeof raw !== "string") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL must be a string" });
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid URL" });
    return;
  }
  if (parsed.protocol !== "https:") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL must use HTTPS" });
    return;
  }
  if (isPrivateHost(parsed.hostname)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "URL points to a private / internal host (blocked for SSRF)",
    });
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["slack", "discord", "generic"]),
  url: z.string().max(1024).superRefine(publicHttpsUrl),
  events: z.array(z.enum(EVENTS)).min(1),
});

export async function createWebhookAction(formData: FormData) {
  const ctx = await requireAdmin();
  // A webhook is an outbound channel that receives suspect names — same
  // step-up as deleting one.
  const reauth = await ensureFreshReauth(ctx.user.id);
  if (reauth) return reauth;

  const events = EVENTS.filter((e) => formData.get(`event_${e}`) === "on");
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    url: formData.get("url"),
    events,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const signing_secret =
    parsed.data.kind === "generic" ? randomBytes(32).toString("base64url") : null;

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("webhooks")
    .insert({
      ...parsed.data,
      signing_secret,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error) return { error: "Could not create webhook" };
  await audit(
    "WEBHOOK_CREATE",
    `${created?.id ?? "?"} "${parsed.data.name}" kind=${parsed.data.kind} host=${new URL(parsed.data.url).hostname} events=${parsed.data.events.join(",")}`,
    ctx.user.id,
    ctx.user.email,
  );

  revalidatePath("/webhooks");
  return { ok: true, signing_secret };
}

export async function deleteWebhookAction(id: string) {
  const ctx = await requireAdmin();
  const reauth = await ensureFreshReauth(ctx.user.id);
  if (reauth) return reauth;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "invalid id" };
  const supabase = await createClient();
  const { error } = await supabase.from("webhooks").delete().eq("id", id);
  if (error) return { error: "Could not delete webhook" };
  await audit("WEBHOOK_DELETE", id, ctx.user.id, ctx.user.email);
  revalidatePath("/webhooks");
  return { ok: true };
}

export async function testWebhookAction(id: string) {
  const ctx = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "invalid id" };
  const supabase = await createClient();
  const { data: hook } = await supabase
    .from("webhooks")
    .select("id, name, events")
    .eq("id", id)
    .single();
  if (!hook) return { error: "not found" };

  const event = (hook.events?.[0] ?? "alert_created") as
    | "alert_created" | "reveal_completed" | "system_health" | "audit_critical";

  await dispatchEvent(event, {
    type: event,
    alert_id: "00000000-0000-0000-0000-000000000000",
    suspect_name: "TEST: Sample Suspect",
    camera_name: "TEST: Camera",
    similarity: 0.87,
    similarity_pct: 87,
    created_at: new Date().toISOString(),
    url: "https://aicctv.dev/alerts",
  });
  await audit("WEBHOOK_TEST", `${hook.id} "${hook.name}" event=${event}`, ctx.user.id, ctx.user.email);

  revalidatePath("/webhooks");
  return { ok: true };
}
