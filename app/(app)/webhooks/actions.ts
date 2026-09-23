"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  dispatchToHook,
  WEBHOOK_EVENTS,
  type EventPayload,
  type WebhookEvent,
} from "@/lib/webhooks";
import { isDeliveredWebhookEvent } from "@/lib/webhook-events";
import { isPrivateHost } from "@/lib/net-guard";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { getT } from "@/lib/i18n/server";
import { T, type TranslationKey } from "@/lib/i18n/translations";


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

// SSRF admission: literal IPs (incl. bracketed IPv6 and IPv4-mapped IPv6)
// and internal-looking names are refused here; delivery re-checks every
// resolved address and never follows redirects (lib/webhooks.ts).
// Issue messages are translation keys; createWebhookAction resolves them in
// the caller's language before returning them to the form.
function publicHttpsUrl(raw: unknown, ctx: z.RefinementCtx): void {
  if (typeof raw !== "string") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "wh_err_url_invalid" });
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "wh_err_url_invalid" });
    return;
  }
  if (parsed.protocol !== "https:") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "wh_err_url_https" });
    return;
  }
  if (isPrivateHost(parsed.hostname)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "wh_err_url_private" });
  }
}

function isTranslationKey(m: unknown): m is TranslationKey {
  return typeof m === "string" && Object.prototype.hasOwnProperty.call(T, m);
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["slack", "discord", "generic"]),
  url: z.string().max(1024).superRefine(publicHttpsUrl),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

export async function createWebhookAction(formData: FormData) {
  const ctx = await requireAdmin();
  // A webhook is an outbound channel that receives suspect names — same
  // step-up as deleting one.
  const reauth = await ensureFreshReauth(ctx.user.id);
  if (reauth) return reauth;

  const events = WEBHOOK_EVENTS.filter((e) => formData.get(`event_${e}`) === "on");
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    url: formData.get("url"),
    events,
  });
  if (!parsed.success) {
    const { t } = await getT();
    const m = parsed.error.issues[0]?.message;
    return { error: isTranslationKey(m) ? t(m) : t("wh_err_invalid") };
  }

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
  if (error) {
    const { t } = await getT();
    return { error: t("wh_err_create") };
  }
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

/** A sample payload shaped like the event the hook actually receives. */
function samplePayload(event: WebhookEvent): EventPayload {
  const now = new Date().toISOString();
  const zero = "00000000-0000-0000-0000-000000000000";
  if (event === "reveal_requested") {
    return {
      type: "reveal_requested",
      job_id: zero,
      recording_id: zero,
      method: "TEST",
      threshold: null,
      requested_email: null,
      created_at: now,
      url: "https://aicctv.dev/reveal-approvals",
    };
  }
  return {
    type: "reveal_completed",
    job_id: zero,
    recording_id: zero,
    status: "completed",
    duration_sec: null,
    requested_email: null,
    url: "https://aicctv.dev/reveal-approvals",
  };
}

/**
 * Send ONE sample event to ONE webhook (enabled or not) and report the HTTP
 * status. It used to fan a fabricated suspect alert out to every enabled
 * hook subscribed to the event, crash for reveal-event hooks, and report
 * success for a disabled hook that received nothing.
 */
export async function testWebhookAction(
  id: string,
): Promise<{ error: string } | { ok: boolean; status: number }> {
  const ctx = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "invalid id" };
  const supabase = await createClient();
  const { data: hook } = await supabase
    .from("webhooks")
    .select("id, events")
    .eq("id", id)
    .maybeSingle();
  if (!hook) {
    const { t } = await getT();
    return { error: t("wh_err_not_found") };
  }

  // Legacy rows may list names nothing dispatches ("alert.created"); test
  // with the first event this hook can actually receive.
  const event: WebhookEvent = (hook.events ?? []).find(isDeliveredWebhookEvent) ?? "reveal_requested";
  const result = await dispatchToHook(hook.id, samplePayload(event));
  if (!result) {
    const { t } = await getT();
    return { error: t("wh_err_not_found") };
  }
  await audit("WEBHOOK_TEST", `${hook.id} event=${event} status=${result.status}`, ctx.user.id, ctx.user.email);

  revalidatePath("/webhooks");
  return { ok: result.ok, status: result.status };
}

/**
 * Enable / disable a webhook. Enabling opens an outbound channel that
 * receives reveal requests, so it needs the TOTP step-up like create;
 * disabling only narrows and stays one click.
 */
export async function setWebhookEnabledAction(
  id: string,
  enabled: boolean,
): Promise<{ error: string } | { ok: true }> {
  const ctx = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "invalid id" };
  if (enabled) {
    const reauth = await ensureFreshReauth(ctx.user.id);
    if (reauth) return reauth;
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("webhooks")
    .update({ enabled, ...(enabled ? { fail_count: 0 } : {}) })
    .eq("id", id)
    .select("id");
  const { t } = await getT();
  if (error) return { error: t("wh_err_update") };
  if (!data?.length) return { error: t("wh_err_not_found") };
  await audit(enabled ? "WEBHOOK_ENABLE" : "WEBHOOK_DISABLE", id, ctx.user.id, ctx.user.email);
  revalidatePath("/webhooks");
  return { ok: true };
}
