"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { dispatchEvent } from "@/lib/webhooks";
import { ensureFreshReauth } from "@/lib/auth/step-up";

const EVENTS = ["alert_created", "reveal_completed", "system_health", "audit_critical"] as const;

const createSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["slack", "discord", "generic"]),
  url: z.string().url().max(1024).refine(
    (u) => u.startsWith("https://"),
    "URL must use HTTPS",
  ),
  events: z.array(z.enum(EVENTS)).min(1),
});

export async function createWebhookAction(formData: FormData) {
  const ctx = await requireAdmin();

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
  const { error } = await supabase.from("webhooks").insert({
    ...parsed.data,
    signing_secret,
    created_by: ctx.user.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/webhooks");
  return { ok: true, signing_secret };
}

export async function deleteWebhookAction(id: string) {
  const ctx = await requireAdmin();
  const reauth = await ensureFreshReauth(ctx.user.id);
  if (reauth) return reauth;
  const supabase = await createClient();
  const { error } = await supabase.from("webhooks").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/webhooks");
  return { ok: true };
}

export async function testWebhookAction(id: string) {
  await requireAdmin();
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
    url: "https://mongolz.vercel.app/alerts",
  });

  revalidatePath("/webhooks");
  return { ok: true };
}
