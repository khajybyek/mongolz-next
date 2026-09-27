"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin, type AuthCtx } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { isRevealLevel } from "@/lib/reveal-authority";
import { getT } from "@/lib/i18n/server";
import { scheduleSecurityEvent } from "@/lib/notify";

type ActionError = { error: string };
type ActionOk = { ok: true };
type ServiceClient = ReturnType<typeof createServiceClient>;

async function audit(action: string, detail: string, user_id: string, user_email: string) {
  const svc = createServiceClient();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await svc.from("audit_log").insert({ action, detail, user_id, user_email, ip });
}

/**
 * Ledger row + real-time notice to the other admins / ops chat. User
 * management is exactly what a stolen admin session would do first, and with
 * two admins a 4-eyes rule could deadlock — so the control is step-up (TOTP
 * factor) + audit + somebody else finding out while it can still be undone.
 */
async function auditAndNotify(action: string, detail: string, ctx: AuthCtx) {
  await audit(action, detail, ctx.user.id, ctx.user.email);
  scheduleSecurityEvent({ action, actorId: ctx.user.id, actorEmail: ctx.user.email, detail });
}

/**
 * A refusal is evidence too (2026-09-08 audit, 5.2): an operator probing the
 * authority ceiling must leave the same kind of trace as one who succeeded.
 * Never fatal — a ledger write that fails must not turn a clean "no" into a
 * server error that looks like a bug in the console.
 */
async function auditDenied(action: string, reason: string, ctx: AuthCtx) {
  try {
    await audit(action, reason, ctx.user.id, ctx.user.email);
  } catch {
    // best effort
  }
}

const ensureReauth = ensureFreshReauth;

/**
 * Reveal authority of the acting admin (ADR 0009).
 *
 * A LOWER number is BROADER authority: 0 = director (can unseal every face),
 * N = only faces with chain_index >= N. `PublicProfile` deliberately omits
 * `reveal_level`, so the caller's own level is read here from the same place
 * `readRevealAuthority()` reads it for the reveal routes.
 *
 * "Cannot determine" is refused rather than assumed to be 0: treating an
 * unreadable row as director is precisely the escalation these guards exist
 * to stop. The blast radius of that refusal is one privileged action — role
 * changes, deletions, password resets and every other page keep working, and
 * an operator locked out of this control can always fix a level directly in
 * Supabase Studio (`update public.profiles set reveal_level = 0 where …`),
 * which is the documented break-glass path for the whole hierarchy.
 */
type Authority = { level: number } | { error: "unavailable" };

async function callerAuthority(svc: ServiceClient, userId: string): Promise<Authority> {
  try {
    const { data, error } = await svc
      .from("profiles")
      .select("role, reveal_level")
      .eq("id", userId)
      .single();
    if (error || !data || data.role !== "admin" || !isRevealLevel(data.reveal_level)) {
      return { error: "unavailable" };
    }
    return { level: data.reveal_level };
  } catch {
    return { error: "unavailable" };
  }
}

const createSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  full_name: z.string().max(120).optional(),
  role: z.enum(["admin", "viewer", "auditor"]),
  // Optional: the form does not expose it yet, so an omitted value inherits
  // the creator's own authority (see below). An empty string is treated as
  // omitted — z.coerce would otherwise turn "" into 0 = director.
  reveal_level: z.coerce.number().int().min(0).max(99).optional(),
});

function optionalField(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export async function createUserAction(formData: FormData): Promise<ActionError | ActionOk> {
  const ctx = await requireAdmin();
  const reauthErr = await ensureReauth(ctx.user.id);
  if (reauthErr) return reauthErr;
  const { t } = await getT();

  const parsed = createSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    full_name: formData.get("full_name") || undefined,
    role: formData.get("role"),
    reveal_level: optionalField(formData.get("reveal_level")),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("users_err_invalid_input") };
  }

  const { email, password, full_name, role } = parsed.data;
  const svc = createServiceClient();

  // The 4-eyes reveal rule needs two HUMANS. An ordinary admin who can mint a
  // second admin — with a password they chose and a TOTP they enrol on their
  // own phone — approves their own reveal requests. Only the (single,
  // DB-locked) super admin may create an admin account.
  if (role === "admin" && !ctx.profile.is_super_admin) {
    await auditDenied("USER_CREATE_DENIED", `non-super admin tried to create admin ${email}`, ctx);
    scheduleSecurityEvent({
      action: "USER_CREATE_DENIED",
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      detail: "attempt to create an admin account",
    });
    return { error: t("users_err_admin_super_only") };
  }

  // A new account must never start with authority its creator does not hold.
  // Without this the ceiling on setRevealLevelAction is decorative: a level-5
  // admin could mint an admin whose profile defaults to reveal_level 0 and
  // sign in as it with the password they just chose. The level is stamped for
  // every role (not only `admin`) so a later promotion cannot inherit the
  // column default either.
  const caller = await callerAuthority(svc, ctx.user.id);
  if ("error" in caller) {
    await auditDenied("USER_CREATE_DENIED", `authority unavailable — create ${email} refused`, ctx);
    return { error: t("users_err_authority_unavailable") };
  }
  const requestedLevel = parsed.data.reveal_level;
  if (requestedLevel !== undefined && requestedLevel < caller.level) {
    await auditDenied(
      "USER_CREATE_DENIED",
      `L${caller.level} tried to create ${email} at reveal_level ${requestedLevel}`,
      ctx,
    );
    return { error: t("users_err_level_ceiling").replace("{level}", String(caller.level)) };
  }
  const reveal_level = requestedLevel ?? caller.level;

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
    .upsert({ id: created.user.id, email, full_name: full_name ?? null, role, reveal_level });

  if (profileErr) {
    await svc.auth.admin.deleteUser(created.user.id);
    return { error: `Profile create failed: ${profileErr.message}` };
  }

  await auditAndNotify(
    "USER_CREATE",
    `created ${email} (${role}, reveal_level ${reveal_level})`,
    ctx,
  );
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
  const { t } = await getT();

  const parsed = roleSchema.safeParse({
    user_id: formData.get("user_id"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: t("users_err_invalid_input") };

  if (parsed.data.user_id === ctx.user.id) {
    return { error: t("users_err_role_self") };
  }

  const svc = createServiceClient();

  // Same rule as createUserAction: promoting an account whose password the
  // caller set (or can reset) is a second admin controlled by one person.
  if (parsed.data.role === "admin" && !ctx.profile.is_super_admin) {
    await auditDenied(
      "USER_ROLE_CHANGE_DENIED",
      `non-super admin tried to promote ${parsed.data.user_id} to admin`,
      ctx,
    );
    scheduleSecurityEvent({
      action: "USER_ROLE_CHANGE_DENIED",
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      detail: `attempt to promote ${parsed.data.user_id} to admin`,
    });
    return { error: t("users_err_admin_super_only") };
  }

  // Promotion is the other door into the authority hierarchy: an existing
  // viewer carries the column default (0 = director), so a restricted admin
  // could promote one and inherit director authority through it. A promotion
  // therefore needs the caller's level and is refused without it; a demotion
  // or lateral move hands out nothing, so it proceeds even when that read
  // fails (fail-open on "cannot determine", fail-closed on "not allowed").
  const caller = await callerAuthority(svc, ctx.user.id);
  let callerLevel: number | null = null;
  if ("error" in caller) {
    if (parsed.data.role === "admin") {
      await auditDenied(
        "USER_ROLE_CHANGE_DENIED",
        `authority unavailable — promotion of ${parsed.data.user_id} refused`,
        ctx,
      );
      return { error: t("users_err_authority_unavailable") };
    }
  } else {
    callerLevel = caller.level;
  }

  const { data: target } = await svc
    .from("profiles")
    .select("email, role, is_super_admin, reveal_level")
    .eq("id", parsed.data.user_id)
    .single();

  if (target?.is_super_admin) {
    return { error: t("users_err_super_admin_role") };
  }

  // `reveal_level` is live authority only on an admin row; on a viewer or
  // auditor it is an inert column that usually still holds the default 0.
  const targetLevel = target && isRevealLevel(target.reveal_level) ? target.reveal_level : 0;
  const targetIsAdmin = target?.role === "admin";

  // Authority flows downwards only: a restricted admin cannot demote (or
  // re-role) an operator whose authority is broader than their own.
  if (callerLevel !== null && targetIsAdmin && targetLevel < callerLevel) {
    await auditDenied(
      "USER_ROLE_CHANGE_DENIED",
      `L${callerLevel} tried to re-role L${targetLevel} ${target?.email ?? parsed.data.user_id}`,
      ctx,
    );
    return { error: t("users_err_level_target_higher") };
  }

  const patch: { role: "admin" | "viewer" | "auditor"; reveal_level?: number } = {
    role: parsed.data.role,
  };
  if (callerLevel !== null && callerLevel > 0 && targetLevel < callerLevel) {
    patch.reveal_level = callerLevel;
  }

  const { error } = await svc.from("profiles").update(patch).eq("id", parsed.data.user_id);

  if (error) return { error: error.message };

  await auditAndNotify(
    "USER_ROLE_CHANGE",
    `${target?.email ?? parsed.data.user_id} → ${parsed.data.role}` +
      (patch.reveal_level !== undefined ? ` (reveal_level pinned to ${patch.reveal_level})` : ""),
    ctx,
  );
  revalidatePath("/users");
  return { ok: true };
}

const revealLevelSchema = z.object({
  user_id: z.string().uuid(),
  // 0 = director (sees/decrypts every face); higher = more restricted —
  // a level-N holder can only reveal/decrypt faces with chain_index >= N
  // (ADR 0009 forward hash chain).
  reveal_level: z.coerce.number().int().min(0).max(99),
});

export async function setRevealLevelAction(
  formData: FormData,
): Promise<ActionError | ActionOk> {
  const ctx = await requireAdmin();
  const reauthErr = await ensureReauth(ctx.user.id);
  if (reauthErr) return reauthErr;
  const { t } = await getT();

  const parsed = revealLevelSchema.safeParse({
    user_id: formData.get("user_id"),
    reveal_level: formData.get("reveal_level"),
  });
  if (!parsed.success) {
    return { error: t("users_err_level_range") };
  }

  // 2026-09-08 audit 5.2 — authority was self-service: any admin could set
  // their OWN reveal_level to 0 and become a director in one action, with no
  // second party involved, which made the ADR 0009 hierarchy a label rather
  // than a boundary. Self-targeting is refused the same way changeRoleAction
  // refuses it; another admin performs the change.
  if (parsed.data.user_id === ctx.user.id) {
    await auditDenied(
      "USER_REVEAL_LEVEL_DENIED",
      `self-target refused (requested reveal_level ${parsed.data.reveal_level})`,
      ctx,
    );
    return { error: t("users_err_level_self") };
  }

  const svc = createServiceClient();

  const caller = await callerAuthority(svc, ctx.user.id);
  if ("error" in caller) {
    await auditDenied(
      "USER_REVEAL_LEVEL_DENIED",
      `authority unavailable — reveal_level change for ${parsed.data.user_id} refused`,
      ctx,
    );
    return { error: t("users_err_authority_unavailable") };
  }

  // Nobody hands out authority they do not hold: only a director (0) can
  // create a director. A level-N admin may grant N..99.
  if (parsed.data.reveal_level < caller.level) {
    await auditDenied(
      "USER_REVEAL_LEVEL_DENIED",
      `L${caller.level} tried to grant reveal_level ${parsed.data.reveal_level} to ${parsed.data.user_id}`,
      ctx,
    );
    return { error: t("users_err_level_ceiling").replace("{level}", String(caller.level)) };
  }

  const { data: target } = await svc
    .from("profiles")
    .select("email, role, is_super_admin, reveal_level")
    .eq("id", parsed.data.user_id)
    .single();

  // An update with no matching row silently "succeeds"; say so instead.
  if (!target) {
    await auditDenied(
      "USER_REVEAL_LEVEL_DENIED",
      `unknown target ${parsed.data.user_id}`,
      ctx,
    );
    return { error: t("users_err_target_missing") };
  }

  // The super admin is the break-glass director — keep them at level 0.
  if (target.is_super_admin && parsed.data.reveal_level !== 0) {
    await auditDenied(
      "USER_REVEAL_LEVEL_DENIED",
      `super admin ${target.email ?? parsed.data.user_id} must remain director`,
      ctx,
    );
    return { error: t("users_err_super_admin_level") };
  }

  // …and authority only flows downwards: a restricted admin cannot rewrite
  // the level of an ADMIN with broader authority than their own (which would
  // let L5 restrict the director and then act unopposed). On a viewer or
  // auditor row the column is inert, so the ceiling above is the only rule.
  const targetLevel = isRevealLevel(target.reveal_level) ? target.reveal_level : 0;
  if (target.role === "admin" && targetLevel < caller.level) {
    await auditDenied(
      "USER_REVEAL_LEVEL_DENIED",
      `L${caller.level} tried to change L${targetLevel} ${target.email ?? parsed.data.user_id}`,
      ctx,
    );
    return { error: t("users_err_level_target_higher") };
  }

  const { error } = await svc
    .from("profiles")
    .update({ reveal_level: parsed.data.reveal_level })
    .eq("id", parsed.data.user_id);
  if (error) return { error: error.message };

  await auditAndNotify(
    "USER_REVEAL_LEVEL",
    `${target.email ?? parsed.data.user_id} → reveal_level ${parsed.data.reveal_level} (was ${targetLevel}, by L${caller.level})`,
    ctx,
  );
  revalidatePath("/users");
  return { ok: true };
}

const deleteSchema = z.object({ user_id: z.string().uuid() });

export async function deleteUserAction(formData: FormData): Promise<ActionError | ActionOk> {
  const ctx = await requireAdmin();
  const reauthErr = await ensureReauth(ctx.user.id);
  if (reauthErr) return reauthErr;
  const { t } = await getT();

  const parsed = deleteSchema.safeParse({ user_id: formData.get("user_id") });
  if (!parsed.success) return { error: t("users_err_invalid_input") };

  if (parsed.data.user_id === ctx.user.id) {
    return { error: t("users_err_delete_self") };
  }

  const svc = createServiceClient();

  // Last-admin protection
  const { data: target } = await svc
    .from("profiles")
    .select("email, role, is_super_admin, reveal_level")
    .eq("id", parsed.data.user_id)
    .single();

  if (target?.is_super_admin) {
    return { error: t("users_err_super_admin_delete") };
  }

  // Removing a broader-authority admin is the destructive form of the same
  // escalation. Fail-OPEN when the caller's own level cannot be read: pulling
  // a compromised account is time-critical and must not depend on a second
  // lookup succeeding — the action still requires admin role + step-up.
  if (target?.role === "admin") {
    const caller = await callerAuthority(svc, ctx.user.id);
    if (
      !("error" in caller) &&
      isRevealLevel(target.reveal_level) &&
      target.reveal_level < caller.level
    ) {
      await auditDenied(
        "USER_DELETE_DENIED",
        `L${caller.level} tried to delete L${target.reveal_level} ${target.email ?? parsed.data.user_id}`,
        ctx,
      );
      return { error: t("users_err_level_target_higher") };
    }
  }

  if (target?.role === "admin") {
    const { count: adminCount } = await svc
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((adminCount ?? 0) <= 1) {
      return { error: t("users_err_last_admin") };
    }
  }

  const { error } = await svc.auth.admin.deleteUser(parsed.data.user_id);
  if (error) return { error: error.message };

  // Race-safety: between the count above and the delete, another admin may
  // have been deleted concurrently. If we just removed the only admin, raise
  // a critical audit event so an operator can promote someone via SQL ASAP.
  if (target?.role === "admin") {
    const { count: remaining } = await svc
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((remaining ?? 0) === 0) {
      try {
        await svc.from("audit_log").insert({
          action: "ADMIN_COUNT_ZERO",
          detail:
            "Last admin removed via race condition — promote a user via SQL immediately",
          user_id: ctx.user.id,
          user_email: ctx.user.email,
        });
      } catch {}
    }
  }

  await auditAndNotify(
    "USER_DELETE",
    `deleted ${target?.email ?? parsed.data.user_id}`,
    ctx,
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
  const { t } = await getT();

  const parsed = resetSchema.safeParse({
    user_id: formData.get("user_id"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: t("users_err_password_short") };

  const svc = createServiceClient();
  const { data: target } = await svc
    .from("profiles")
    .select("email, role, is_super_admin, reveal_level, totp_enabled")
    .eq("id", parsed.data.user_id)
    .single();

  if (target?.is_super_admin) {
    return { error: t("users_err_super_admin_password") };
  }

  // Sibling of the "only the super admin creates admins" rule: an admin who
  // has not enrolled TOTP yet is protected by the password alone, so resetting
  // it hands the caller a second admin identity (sign in, enrol TOTP on their
  // own phone, approve their own reveal). Admins WITH TOTP stay resettable —
  // the new password is useless without their authenticator — so an ordinary
  // emergency reset is never blocked; the super admin can always do this one.
  if (target?.role === "admin" && !target.totp_enabled && !ctx.profile.is_super_admin) {
    await auditDenied(
      "USER_PASSWORD_RESET_DENIED",
      `non-super admin tried to reset TOTP-less admin ${target.email ?? parsed.data.user_id}`,
      ctx,
    );
    scheduleSecurityEvent({
      action: "USER_PASSWORD_RESET_DENIED",
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      detail: "attempt to reset the password of an admin without a second factor",
    });
    return { error: t("users_err_reset_admin_no_totp") };
  }

  // A password reset is account takeover with extra steps: without this, a
  // restricted admin could reset a director's password and sign in as them.
  // Same fail-open rule as the delete path — locking out an emergency
  // password reset would be worse than the (TOTP-gated) escalation it stops.
  if (target?.role === "admin") {
    const caller = await callerAuthority(svc, ctx.user.id);
    if (
      !("error" in caller) &&
      isRevealLevel(target.reveal_level) &&
      target.reveal_level < caller.level
    ) {
      await auditDenied(
        "USER_PASSWORD_RESET_DENIED",
        `L${caller.level} tried to reset L${target.reveal_level} ${target.email ?? parsed.data.user_id}`,
        ctx,
      );
      return { error: t("users_err_level_target_higher") };
    }
  }

  const { error } = await svc.auth.admin.updateUserById(parsed.data.user_id, {
    password: parsed.data.password,
  });
  if (error) return { error: error.message };

  // New credentials, clean slate: notification channels registered under the
  // old ones (possibly by whoever made the reset necessary) are dropped.
  try {
    await svc.from("push_subscriptions").delete().eq("user_id", parsed.data.user_id);
  } catch {}

  await auditAndNotify(
    "USER_PASSWORD_RESET",
    `reset password for ${target?.email ?? parsed.data.user_id}`,
    ctx,
  );
  return { ok: true };
}
