"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { hasFreshReauth } from "@/lib/auth/step-up";

const REAUTH_REQUIRED = "REAUTH_REQUIRED" as const;
type ActionError = { error: string };
type ActionOk = { ok: true };

async function audit(action: string, detail: string, user_id: string, user_email: string) {
  const svc = createServiceClient();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await svc.from("audit_log").insert({ action, detail, user_id, user_email, ip });
}

/**
 * Sensitive user-CRUD operations require a fresh TOTP step-up. The
 * client posts the TOTP code to `/api/auth/reauth/totp` which sets the
 * `mongolz-reauth` cookie; this check just verifies that cookie is fresh.
 *
 * Returns `null` if reauth is satisfied, or a typed error to surface
 * to the client (which will then prompt for TOTP).
 */
async function ensureReauth(userId: string): Promise<ActionError | null> {
  if (await hasFreshReauth(userId)) return null;
  return { error: REAUTH_REQUIRED };
}

const createSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  full_name: z.string().max(120).optional(),
  role: z.enum(["admin", "viewer", "auditor"]),
});

export async function createUserAction(formData: FormData): Promise<ActionError | ActionOk> {
  const ctx = await requireAdmin();
  const reauthErr = await ensureReauth(ctx.user.id);
  if (reauthErr) return reauthErr;

  const parsed = createSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    full_name: formData.get("full_name") || undefined,
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }

  const { email, password, full_name, role } = parsed.data;
  const svc = createServiceClient();

  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (createErr || !created.user) {
    return { error: createErr?.message ?? "Failed to create user" };
  }

  const { error: profileErr } = await svc
    .from("profiles")
    .upsert({ id: created.user.id, email, full_name: full_name ?? null, role });

  if (profileErr) {
    await svc.auth.admin.deleteUser(created.user.id);
    return { error: `Profile create failed: ${profileErr.message}` };
  }

  await audit("USER_CREATE", `created ${email} (${role})`, ctx.user.id, ctx.user.email);
  revalidatePath("/users");
  return { ok: true };
}

const roleSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["admin", "viewer", "auditor"]),
});

export async function changeRoleAction(formData: FormData): Promise<ActionError | ActionOk> {
  const ctx = await requireAdmin();
  const reauthErr = await ensureReauth(ctx.user.id);
  if (reauthErr) return reauthErr;

  const parsed = roleSchema.safeParse({
    user_id: formData.get("user_id"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: "Invalid input" };

  if (parsed.data.user_id === ctx.user.id) {
    return { error: "Cannot change your own role" };
  }

  const svc = createServiceClient();
  const { data: target } = await svc
    .from("profiles")
    .select("email")
    .eq("id", parsed.data.user_id)
    .single();

  const { error } = await svc
    .from("profiles")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.user_id);

  if (error) return { error: error.message };

  await audit(
    "USER_ROLE_CHANGE",
    `${target?.email ?? parsed.data.user_id} → ${parsed.data.role}`,
    ctx.user.id,
    ctx.user.email,
  );
  revalidatePath("/users");
  return { ok: true };
}

const deleteSchema = z.object({ user_id: z.string().uuid() });

export async function deleteUserAction(formData: FormData): Promise<ActionError | ActionOk> {
  const ctx = await requireAdmin();
  const reauthErr = await ensureReauth(ctx.user.id);
  if (reauthErr) return reauthErr;

  const parsed = deleteSchema.safeParse({ user_id: formData.get("user_id") });
  if (!parsed.success) return { error: "Invalid user id" };

  if (parsed.data.user_id === ctx.user.id) {
    return { error: "Cannot delete yourself" };
  }

  const svc = createServiceClient();

  // Last-admin protection
  const { data: target } = await svc
    .from("profiles")
    .select("email, role")
    .eq("id", parsed.data.user_id)
    .single();

  if (target?.role === "admin") {
    const { count: adminCount } = await svc
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((adminCount ?? 0) <= 1) {
      return { error: "Cannot delete the last admin" };
    }
  }

  const { error } = await svc.auth.admin.deleteUser(parsed.data.user_id);
  if (error) return { error: error.message };

  await audit(
    "USER_DELETE",
    `deleted ${target?.email ?? parsed.data.user_id}`,
    ctx.user.id,
    ctx.user.email,
  );
  revalidatePath("/users");
  return { ok: true };
}

const resetSchema = z.object({
  user_id: z.string().uuid(),
  password: z.string().min(8).max(128),
});

export async function resetPasswordAction(formData: FormData): Promise<ActionError | ActionOk> {
  const ctx = await requireAdmin();
  const reauthErr = await ensureReauth(ctx.user.id);
  if (reauthErr) return reauthErr;

  const parsed = resetSchema.safeParse({
    user_id: formData.get("user_id"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Invalid input (8+ char password)" };

  const svc = createServiceClient();
  const { data: target } = await svc
    .from("profiles")
    .select("email")
    .eq("id", parsed.data.user_id)
    .single();

  const { error } = await svc.auth.admin.updateUserById(parsed.data.user_id, {
    password: parsed.data.password,
  });
  if (error) return { error: error.message };

  await audit(
    "USER_PASSWORD_RESET",
    `reset password for ${target?.email ?? parsed.data.user_id}`,
    ctx.user.id,
    ctx.user.email,
  );
  return { ok: true };
}
