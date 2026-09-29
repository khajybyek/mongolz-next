/**
 * Pure helpers for /cameras/<id>/permissions (page + server actions).
 *
 * Every camera_permissions row grants the same access whatever its
 * `permission` value (lib/live-access.ts: the gateway checks for a row, not
 * its kind), so the page works per PERSON: one table row per user, one revoke
 * that removes every row that user holds, and a grant that replaces the kind
 * instead of adding a second row next to the first.
 */
import type { TranslationKey } from "@/lib/i18n/translations";

export type PermissionKind = "view" | "operate";

export interface PermissionRow {
  id: string;
  user_id: string;
  permission: PermissionKind;
  created_at: string;
}

export interface GrantProfile {
  email: string | null;
  role: string | null;
}

export interface UserGrant {
  user_id: string;
  email: string | null;
  role: string | null;
  /** Kinds this user holds, in display order (view before operate), de-duplicated. */
  permissions: PermissionKind[];
  /** Newest created_at among the user's rows — the table is ordered by it. */
  created_at: string;
}

const KIND_ORDER: PermissionKind[] = ["view", "operate"];

/**
 * Only viewers can be offered a grant: admins watch every camera anyway, and
 * auditors never get live video (requireUserApi is admin | viewer only), so a
 * grant would promise them something the gateway refuses.
 */
export function isGrantableRole(role: string | null | undefined): boolean {
  return role === "viewer";
}

/** Auditor rows exist from before the picker filtered them; they give no live video. */
export function grantHasNoLiveEffect(role: string | null | undefined): boolean {
  return role === "auditor";
}

export function roleLabelKey(role: string | null | undefined): TranslationKey | null {
  switch (role) {
    case "admin":
      return "role_admin";
    case "viewer":
      return "role_viewer";
    case "auditor":
      return "role_auditor";
    default:
      return null;
  }
}

export function permissionLabelKey(kind: PermissionKind): TranslationKey {
  return kind === "operate" ? "perm_operate" : "perm_view";
}

/** One entry per user, newest grant first; the user's kinds are merged into one list. */
export function groupGrantsByUser(
  rows: ReadonlyArray<PermissionRow>,
  profiles: ReadonlyMap<string, GrantProfile>,
): UserGrant[] {
  const byUser = new Map<string, UserGrant>();
  for (const r of rows) {
    let g = byUser.get(r.user_id);
    if (!g) {
      const p = profiles.get(r.user_id);
      g = {
        user_id: r.user_id,
        email: p?.email ?? null,
        role: p?.role ?? null,
        permissions: [],
        created_at: r.created_at,
      };
      byUser.set(r.user_id, g);
    }
    if (!g.permissions.includes(r.permission)) g.permissions.push(r.permission);
    if (r.created_at > g.created_at) g.created_at = r.created_at;
  }
  const out = [...byUser.values()];
  for (const g of out) g.permissions.sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
  return out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}
