import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import {
  grantCameraPermissionAction,
  revokeCameraPermissionAction,
} from "./actions";
import { StepUpForm } from "@/components/step-up-form";
import {
  grantHasNoLiveEffect,
  groupGrantsByUser,
  isGrantableRole,
  permissionLabelKey,
  roleLabelKey,
  type GrantProfile,
  type PermissionRow,
} from "./grants";
import { RevokeGrantButton } from "./revoke-grant-button";

export const dynamic = "force-dynamic";

export default async function CameraPermissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { t } = await getT();
  const { id } = await params;

  const svc = createServiceClient();
  const { data: camera } = await svc
    .from("cameras")
    .select("id, name, cam_type")
    .eq("id", id)
    .single();
  if (!camera) notFound();

  const { data: perms } = await svc
    .from("camera_permissions")
    .select("id, user_id, permission, created_at")
    .eq("camera_id", id)
    .order("created_at", { ascending: false });

  const rows = (perms ?? []) as PermissionRow[];
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const profiles = new Map<string, GrantProfile>();
  if (userIds.length) {
    const { data } = await svc
      .from("profiles")
      .select("id, email, role")
      .in("id", userIds);
    for (const p of data ?? []) profiles.set(p.id, { email: p.email, role: p.role });
  }
  // One row per person: both kinds grant the same access, and the revoke
  // removes every row the user holds (actions.ts).
  const grants = groupGrantsByUser(rows, profiles);

  // Viewers only: admins watch every camera anyway and auditors never get
  // live video, so offering them a grant would promise nothing real.
  const { data: candidateRows } = await svc
    .from("profiles")
    .select("id, email, role")
    .eq("role", "viewer")
    .order("email");
  const candidates = (candidateRows ?? []).filter((u) => isGrantableRole(u.role));

  const revoke = revokeCameraPermissionAction.bind(null, camera.id);
  const roleLabel = (role: string | null) => {
    const key = roleLabelKey(role);
    return key ? t(key) : (role ?? "—");
  };

  return (
    <>
      <Link
        href="/cameras"
        className="text-sm text-text-soft hover:text-text inline-flex items-center gap-1.5 mb-3"
      >
        <ArrowLeft className="w-4 h-4" />
        {t("nav_cameras")}
      </Link>

      <PageHeader
        title={`${t("permissions_title_prefix")} ${camera.name}`}
        subtitle={t("permissions_subtitle")}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 mt-4">
        <div className="space-y-4">
          {grants.length === 0 ? (
            <Empty message={t("perm_empty")} />
          ) : (
            <div className="tbl-wrap">
              {/* Phones: the role moves under the e-mail (its own column would
                  squeeze the address into 4-character lines) and the long mn
                  permission header may wrap. */}
              <table className="tbl tbl-tight">
                <thead>
                  <tr>
                    <th>{t("perm_col_email")}</th>
                    <th className="hidden sm:table-cell">{t("perm_col_role")}</th>
                    <th className="whitespace-normal sm:whitespace-nowrap">{t("perm_col_permission")}</th>
                    <th className="num">{t("col_actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {grants.map((g) => {
                    const userLabel = g.email ?? g.user_id.slice(0, 8);
                    const noLive = grantHasNoLiveEffect(g.role);
                    const roleBadge = (
                      <span
                        className={`badge ${
                          g.role === "auditor"
                            ? "bg-warning/15 text-warning"
                            : "bg-text-muted/15 text-text-soft"
                        }`}
                      >
                        {roleLabel(g.role)}
                      </span>
                    );
                    return (
                      <tr key={g.user_id}>
                        <td>
                          {/* A 9rem floor keeps ordinary addresses on one line;
                              only a longer one wraps, and only where it must. */}
                          <span className="block min-w-[9rem] font-medium text-text [overflow-wrap:anywhere]">
                            {userLabel}
                          </span>
                          <div className="mt-1 sm:hidden">{roleBadge}</div>
                        </td>
                        <td className="hidden sm:table-cell">{roleBadge}</td>
                        <td>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {g.permissions.map((p) => (
                              <span key={p} className="badge bg-accent/15 text-accent">
                                {t(permissionLabelKey(p))}
                              </span>
                            ))}
                          </div>
                          {/* Auditors never reach the stream gateway: this row
                              gives no live video, it only keeps the camera
                              restricted to the listed users. */}
                          {noLive && (
                            <p className="text-2xs text-text-muted mt-1" title={t("perm_auditor_no_live_tip")}>
                              {t("perm_auditor_no_live")}
                            </p>
                          )}
                        </td>
                        <td className="num">
                          <RevokeGrantButton
                            userId={g.user_id}
                            userLabel={userLabel}
                            isLastGrant={grants.length === 1}
                            action={revoke}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* The two access levels differ on purpose (lib/live-access.ts):
              the rows here decide both, but "no rows" means opposite things. */}
          <div className="card space-y-2 text-xs leading-relaxed text-text-soft">
            <h3 className="text-sm font-semibold text-text flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent" aria-hidden />
              {t("perm_levels_title")}
            </h3>
            <p>{t("perm_levels_lists")}</p>
            <p>{t("perm_levels_live")}</p>
          </div>

          <StepUpForm action={grantCameraPermissionAction} className="card space-y-3">
            <h3 className="text-sm font-semibold">{t("perm_grant_title")}</h3>
            <input type="hidden" name="camera_id" value={camera.id} />
            <select name="user_id" required aria-label={t("perm_pick_user")} className="select text-sm">
              <option value="">{t("perm_pick_user")}</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email} ({roleLabel(u.role)})
                </option>
              ))}
            </select>
            <select
              name="permission"
              defaultValue="view"
              aria-label={t("perm_col_permission")}
              aria-describedby="perm-kinds-hint"
              className="select text-sm"
            >
              <option value="view">{t("perm_view")}</option>
              <option value="operate">{t("perm_operate")}</option>
            </select>
            <p id="perm-kinds-hint" className="helper mt-0">
              {t("perm_kinds_hint")}
            </p>
            <button type="submit" className="btn-primary w-full text-sm">
              {t("perm_grant")}
            </button>
          </StepUpForm>
        </div>
      </div>
    </>
  );
}
