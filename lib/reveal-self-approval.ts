/**
 * Super-admin reveal without a second admin (owner decision 2026-09-30,
 * ADR 0003 amendment, migration 20260930120000).
 *
 * The database is the source of truth: public.super_admin_self_reveal_allowed
 * answers true only for the one profile with is_super_admin (admin role,
 * valid reveal level) while private.security_settings.super_admin_self_reveal
 * is on. The reveal_jobs guard trigger and claim_reveal_job() apply the same
 * verdict, so nothing here can widen what the database allows — a wrong
 * answer here can only send the super admin through the normal 4-eyes flow.
 *
 * Server-only: needs the service-role client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.generated";

/** Audit action written next to REVEAL_REQUEST for a self-approved reveal. */
export const SELF_APPROVED_AUDIT_ACTION = "REVEAL_SUPER_ADMIN_SELF_APPROVED";

/**
 * Audit action that corrects the ledger when the self-approval rows were
 * written but the self-approved job was not created as such: the database
 * refused it (the request was filed for 4-eyes approval instead), the insert
 * failed, or its outcome could not be confirmed. Its detail starts with
 * `job <id>` like the self-approval row it follows.
 */
export const SELF_APPROVAL_ABORTED_AUDIT_ACTION = "REVEAL_SELF_APPROVAL_ABORTED";

/** Error code the start route returns when the self-approved path needs the TOTP factor. */
export const REVEAL_TOTP_REQUIRED_CODE = "REAUTH_TOTP_REQUIRED";

/**
 * Error code for a self-approved job whose creation could not be confirmed
 * and could not be proven cancelled: it may exist and run (its ledger rows
 * are already written), so the other admins were notified.
 */
export const REVEAL_START_UNCONFIRMED_CODE = "START_UNCONFIRMED";

/**
 * Detail of the REVEAL_SUPER_ADMIN_SELF_APPROVED ledger row: ids and the
 * reason's length only — the reason text stays in reveal_jobs.
 *
 * The `job <id> ` prefix is load-bearing: claim_reveal_job() (migration
 * 20260930120000) claims a self-approved job only while a
 * REVEAL_SUPER_ADMIN_SELF_APPROVED row by the requester whose detail starts
 * with `job <id> ` exists. Change the prefix and those jobs never run.
 */
export function selfApprovalAuditDetail(input: {
  jobId: string;
  recordingId: string;
  method: string;
  reasonLength: number;
}): string {
  return `job ${input.jobId} · recording=${input.recordingId} · method=${input.method} · reason_len=${input.reasonLength}`;
}

/**
 * True when a PostgREST error carries a Postgres SQLSTATE (five characters,
 * e.g. 42501, 23514): the statement failed inside the database and its
 * transaction rolled back, so nothing was written. Anything else — a network
 * failure, a lost response, a PGRST gateway code — leaves the outcome
 * unknown: the write may still have committed.
 */
export function isDatabaseVerdict(error: { code?: string | null } | null | undefined): boolean {
  return typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code);
}

type RpcClient = Pick<SupabaseClient<Database>, "rpc">;

/**
 * May this user's reveal request skip the second admin right now?
 *
 * `isSuperAdmin` is the caller's profile flag: every other admin gets false
 * without a database round-trip. Any failure — the RPC missing because the
 * web was deployed before the migration, a network error, a malformed
 * answer — reads as false, i.e. the normal pending_approval flow. Never
 * throws.
 */
export async function readSuperAdminSelfReveal(
  svc: RpcClient,
  userId: string,
  isSuperAdmin: boolean | null | undefined,
): Promise<boolean> {
  if (isSuperAdmin !== true) return false;
  try {
    const { data, error } = await svc.rpc("super_admin_self_reveal_allowed", { p_user_id: userId });
    if (error) {
      console.warn("[reveal] super-admin self-approval verdict unavailable:", error.code ?? error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.warn("[reveal] super-admin self-approval verdict failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** A reveal job row as the lists read it. */
export type ApprovalShape = {
  approval_required?: boolean | null;
  approved_by?: string | null;
  requested_by?: string | null;
};

/**
 * True for a job the super admin approved themselves (approval_required =
 * false). Presentation only — the lists label it so it never reads like a
 * normal 4-eyes approval.
 */
export function isSelfApprovedReveal(job: ApprovalShape): boolean {
  return job.approval_required === false;
}
