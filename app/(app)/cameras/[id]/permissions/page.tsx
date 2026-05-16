import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import {
  grantCameraPermissionAction,
  revokeCameraPermissionAction,
} from "./actions";

export const dynamic = "force-dynamic";

interface PermRow {
  id: string;
  user_id: string;
  permission: "view" | "operate";
  created_at: string;
  user_email: string | null;
  user_role: string | null;
}

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

  const rows = (perms ?? []) as PermRow[];
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  if (userIds.length) {
    const { data: profiles } = await svc
      .from("profiles")
      .select("id, email, role")
      .in("id", userIds);
    const map = new Map((profiles ?? []).map((p) => [p.id, p]));
    rows.forEach((r) => {
      const p = map.get(r.user_id);
      r.user_email = p?.email ?? null;
      r.user_role = p?.role ?? null;
    });
  }

  const { data: candidates } = await svc
    .from("profiles")
    .select("id, email, role")
    .neq("role", "admin")
    .order("email");

  return (
    <>
      <Link
        href="/cameras"
        className="text-sm text-neutral-400 hover:text-neutral-100 inline-flex items-center gap-1.5 mb-3"
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
          <div className="card p-0">
            <table className="w-full text-sm">
              <thead className="bg-bg-tertiary/50">
                <tr className="text-xs uppercase tracking-wide text-neutral-400">
                  <th className="px-4 py-2.5 text-left">{t("perm_col_email")}</th>
                  <th className="px-4 py-2.5 text-left">{t("perm_col_role")}</th>
                  <th className="px-4 py-2.5 text-left">{t("perm_col_permission")}</th>
                  <th className="px-4 py-2.5 text-right">{t("col_actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-6 text-center text-xs text-neutral-500"
                    >
                      {t("perm_empty")}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 font-medium">
                        {r.user_email ?? r.user_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`badge ${
                            r.user_role === "auditor"
                              ? "bg-warning/15 text-warning"
                              : "bg-neutral-500/15 text-neutral-300"
                          }`}
                        >
                          {r.user_role ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="badge bg-accent/15 text-accent">{r.permission}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <form action={revokeCameraPermissionAction} className="inline">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="camera_id" value={camera.id} />
                          <button
                            type="submit"
                            className="p-1.5 rounded hover:bg-danger/15 text-neutral-400 hover:text-danger"
                            title={t("delete")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <form action={grantCameraPermissionAction} className="card space-y-3">
            <h3 className="text-sm font-semibold">{t("perm_grant_title")}</h3>
            <input type="hidden" name="camera_id" value={camera.id} />
            <select name="user_id" required className="input text-sm">
              <option value="">{t("perm_pick_user")}</option>
              {(candidates ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email} ({u.role})
                </option>
              ))}
            </select>
            <select name="permission" defaultValue="view" className="input text-sm">
              <option value="view">{t("perm_view")}</option>
              <option value="operate">{t("perm_operate")}</option>
            </select>
            <button type="submit" className="btn-primary w-full text-sm">
              {t("perm_grant")}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
