"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { Shield, ShieldOff, KeyRound, Trash2, Loader2, AlertCircle, Check, Crown, Lock, Layers } from "lucide-react";
import { changeRoleAction, deleteUserAction, resetPasswordAction, setRevealLevelAction } from "./actions";
import { TotpPrompt } from "@/components/totp-prompt";
import { useT } from "@/lib/i18n/client";

const REAUTH_REQUIRED = "REAUTH_REQUIRED";

interface User {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "viewer" | "auditor";
  totp_enabled: boolean;
  is_super_admin: boolean;
  reveal_level: number;
  created_at: string;
}

type PendingAction =
  | { kind: "role"; user: User; newRole: "admin" | "viewer" | "auditor" }
  | { kind: "delete"; user: User }
  | { kind: "reset"; user: User; password: string }
  | { kind: "level"; user: User; level: number };

export function UsersTable({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const { t } = useT();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; type: "ok" | "err"; msg: string } | null>(
    null,
  );
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [levelUserId, setLevelUserId] = useState<string | null>(null);
  const [levelValue, setLevelValue] = useState("0");
  const [needsTotp, setNeedsTotp] = useState(false);
  const pendingActionRef = useRef<PendingAction | null>(null);

  function showFeedback(id: string, type: "ok" | "err", msg: string) {
    setFeedback({ id, type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  function runPending(action: PendingAction) {
    pendingActionRef.current = action;
    setBusyId(action.user.id);
    startTransition(async () => {
      const fd = new FormData();
      let res: { error: string } | { ok: true };
      if (action.kind === "role") {
        fd.append("user_id", action.user.id);
        fd.append("role", action.newRole);
        res = await changeRoleAction(fd);
      } else if (action.kind === "delete") {
        fd.append("user_id", action.user.id);
        res = await deleteUserAction(fd);
      } else if (action.kind === "level") {
        fd.append("user_id", action.user.id);
        fd.append("reveal_level", String(action.level));
        res = await setRevealLevelAction(fd);
      } else {
        fd.append("user_id", action.user.id);
        fd.append("password", action.password);
        res = await resetPasswordAction(fd);
      }
      setBusyId(null);

      if ("error" in res) {
        if (res.error === REAUTH_REQUIRED) {
          setNeedsTotp(true);
          return;
        }
        pendingActionRef.current = null;
        showFeedback(action.user.id, "err", res.error);
      } else {
        pendingActionRef.current = null;
        if (action.kind === "role") {
          showFeedback(action.user.id, "ok", `Role → ${action.newRole}`);
        } else if (action.kind === "reset") {
          setResetUserId(null);
          setNewPassword("");
          showFeedback(action.user.id, "ok", t("users_pwd_updated"));
        } else if (action.kind === "level") {
          setLevelUserId(null);
          showFeedback(action.user.id, "ok", `Reveal level → ${action.level}`);
        }
      }
    });
  }

  function onTotpSuccess() {
    setNeedsTotp(false);
    const action = pendingActionRef.current;
    if (action) runPending(action);
  }

  function nextRoleCycle(current: User["role"]): User["role"] {
    if (current === "admin") return "viewer";
    if (current === "viewer") return "auditor";
    return "admin";
  }

  function changeRole(user: User, newRole: "admin" | "viewer" | "auditor") {
    if (!confirm(`${user.email} — "${newRole}" role?`)) return;
    runPending({ kind: "role", user, newRole });
  }

  function removeUser(user: User) {
    if (!confirm(t("users_delete_confirm").replace("{email}", user.email))) return;
    runPending({ kind: "delete", user });
  }

  function resetPassword(user: User) {
    if (newPassword.length < 8) {
      showFeedback(user.id, "err", t("users_pwd_too_short"));
      return;
    }
    runPending({ kind: "reset", user, password: newPassword });
  }

  function saveLevel(user: User) {
    const n = Number(levelValue);
    if (!Number.isInteger(n) || n < 0 || n > 99) {
      showFeedback(user.id, "err", "Reveal level 0–99 байх ёстой");
      return;
    }
    runPending({ kind: "level", user, level: n });
  }

  return (
    <>
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("users_col_email")}</th>
                <th>{t("users_col_name")}</th>
                <th>Role</th>
                <th>2FA</th>
                <th>{t("users_col_created")}</th>
                <th className="text-right">{t("col_action")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === currentUserId;
                const fb = feedback?.id === u.id ? feedback : null;
                return (
                  <Fragment key={u.id}>
                    <tr className={u.is_super_admin ? "bg-accent/[0.03]" : ""}>
                      <td>
                        <span className="font-medium text-text">{u.email}</span>
                        {isSelf && (
                          <span className="ml-2 text-2xs text-accent">
                            ({t("users_self_label")})
                          </span>
                        )}
                        {u.is_super_admin && (
                          <span
                            className="ml-2 inline-flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-accent"
                            title="Зөвхөн Supabase Studio-аас устгана"
                          >
                            <Crown className="w-3 h-3" />
                            Super admin
                          </span>
                        )}
                      </td>
                      <td>{u.full_name ?? "—"}</td>
                      <td>
                        <span
                          className={`badge ${
                            u.is_super_admin
                              ? "badge-accent"
                              : u.role === "admin"
                              ? "badge-accent"
                              : u.role === "auditor"
                              ? "badge-warning"
                              : "badge-muted"
                          }`}
                        >
                          {u.is_super_admin ? "super_admin" : u.role}
                        </span>
                        {(u.role === "admin" || u.is_super_admin) && (
                          <span
                            className="ml-1.5 inline-flex items-center gap-0.5 text-2xs font-mono text-text-muted"
                            title="Reveal authority (ADR 0009): 0 = director (бүх нүүр), N = зөвхөн chain_index ≥ N"
                          >
                            <Layers className="w-3 h-3" />
                            {u.reveal_level === 0 ? "director" : `L${u.reveal_level}`}
                          </span>
                        )}
                      </td>
                      <td>
                        {u.totp_enabled ? (
                          <span className="badge-success">enabled</span>
                        ) : (
                          <span className="badge-muted">disabled</span>
                        )}
                      </td>
                      <td className="text-xs">{u.created_at}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          {u.is_super_admin ? (
                            <span
                              className="inline-flex items-center gap-1 text-2xs text-text-muted"
                              title="Зөвхөн Supabase Studio-аас засна"
                            >
                              <Lock className="w-3 h-3" />
                              Protected
                            </span>
                          ) : !isSelf ? (
                            <>
                              <button
                                disabled={pending && busyId === u.id}
                                onClick={() => changeRole(u, nextRoleCycle(u.role))}
                                title={`admin → viewer → auditor → admin (${u.role})`}
                                className="p-1.5 rounded hover:bg-text-muted/5 text-text-soft hover:text-accent"
                              >
                                {u.role === "admin" ? (
                                  <ShieldOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Shield className="w-3.5 h-3.5" />
                                )}
                              </button>
                              {u.role === "admin" && (
                                <button
                                  disabled={pending && busyId === u.id}
                                  onClick={() => {
                                    setLevelUserId(u.id);
                                    setLevelValue(String(u.reveal_level));
                                  }}
                                  title="Reveal authority level (ADR 0009)"
                                  className="p-1.5 rounded hover:bg-text-muted/5 text-text-soft hover:text-accent"
                                >
                                  <Layers className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                disabled={pending && busyId === u.id}
                                onClick={() => {
                                  setResetUserId(u.id);
                                  setNewPassword("");
                                }}
                                title={t("users_pwd_reset_tip")}
                                className="p-1.5 rounded hover:bg-text-muted/5 text-text-soft hover:text-warning"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>
                              <button
                                disabled={pending && busyId === u.id}
                                onClick={() => removeUser(u)}
                                title={t("delete_btn")}
                                className="p-1.5 rounded hover:bg-danger-soft text-text-soft hover:text-danger"
                              >
                                {pending && busyId === u.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {resetUserId === u.id && (
                      <tr className="bg-surface-elevated/40">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <input
                              type="password"
                              placeholder={t("users_new_pwd_placeholder")}
                              minLength={8}
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              className="input text-xs flex-1 max-w-sm"
                              autoComplete="new-password"
                            />
                            <button
                              onClick={() => resetPassword(u)}
                              disabled={pending && busyId === u.id}
                              className="btn-primary btn-sm"
                            >
                              {t("save_btn")}
                            </button>
                            <button
                              onClick={() => {
                                setResetUserId(null);
                                setNewPassword("");
                              }}
                              className="btn-ghost btn-sm"
                            >
                              {t("cancel_btn")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {levelUserId === u.id && (
                      <tr className="bg-surface-elevated/40">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-text-soft">
                              Reveal authority level —{" "}
                              <span className="text-text-muted">
                                0 = director (бүх нүүр), N = зөвхөн chain_index ≥ N
                              </span>
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={99}
                              value={levelValue}
                              onChange={(e) => setLevelValue(e.target.value)}
                              className="input text-xs w-20"
                            />
                            <button
                              onClick={() => saveLevel(u)}
                              disabled={pending && busyId === u.id}
                              className="btn-primary btn-sm"
                            >
                              {t("save_btn")}
                            </button>
                            <button
                              onClick={() => setLevelUserId(null)}
                              className="btn-ghost btn-sm"
                            >
                              {t("cancel_btn")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {fb && (
                      <tr>
                        <td colSpan={6} className="px-4 py-1.5">
                          <div
                            className={`text-xs flex items-center gap-1.5 ${
                              fb.type === "ok" ? "text-success" : "text-danger"
                            }`}
                          >
                            {fb.type === "ok" ? (
                              <Check className="w-3 h-3" />
                            ) : (
                              <AlertCircle className="w-3 h-3" />
                            )}
                            {fb.msg}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <TotpPrompt
        open={needsTotp}
        onClose={() => {
          setNeedsTotp(false);
          pendingActionRef.current = null;
        }}
        onSuccess={onTotpSuccess}
      />
    </>
  );
}
