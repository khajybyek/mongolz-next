"use client";

import { useState, useTransition } from "react";
import { Shield, ShieldOff, KeyRound, Trash2, Loader2, AlertCircle, Check } from "lucide-react";
import { changeRoleAction, deleteUserAction, resetPasswordAction } from "./actions";

interface User {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "viewer" | "auditor";
  totp_enabled: boolean;
  created_at: string;
}

export function UsersTable({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; type: "ok" | "err"; msg: string } | null>(null);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  function showFeedback(id: string, type: "ok" | "err", msg: string) {
    setFeedback({ id, type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  function changeRole(user: User, newRole: "admin" | "viewer" | "auditor") {
    if (!confirm(`${user.email}-ийн role-ыг "${newRole}"-руу өөрчлөх үү?`)) return;
    setBusyId(user.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("user_id", user.id);
      fd.append("role", newRole);
      const r = await changeRoleAction(fd);
      setBusyId(null);
      if (r?.error) showFeedback(user.id, "err", r.error);
      else showFeedback(user.id, "ok", `Role → ${newRole}`);
    });
  }

  function nextRoleCycle(current: User["role"]): User["role"] {
    // admin → viewer → auditor → admin
    if (current === "admin") return "viewer";
    if (current === "viewer") return "auditor";
    return "admin";
  }

  function removeUser(user: User) {
    if (!confirm(`${user.email}-ийг бүрмөсөн устгах уу? Энэ нь буцаашгүй.`)) return;
    setBusyId(user.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("user_id", user.id);
      const r = await deleteUserAction(fd);
      setBusyId(null);
      if (r?.error) showFeedback(user.id, "err", r.error);
    });
  }

  function resetPassword(user: User) {
    if (newPassword.length < 8) {
      showFeedback(user.id, "err", "8+ тэмдэгт хэрэгтэй");
      return;
    }
    setBusyId(user.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("user_id", user.id);
      fd.append("password", newPassword);
      const r = await resetPasswordAction(fd);
      setBusyId(null);
      setResetUserId(null);
      setNewPassword("");
      if (r?.error) showFeedback(user.id, "err", r.error);
      else showFeedback(user.id, "ok", "Нууц үг шинэчилсэн");
    });
  }

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="bg-bg-tertiary/50">
          <tr className="text-xs uppercase tracking-wide text-neutral-400">
            <th className="px-4 py-2.5 text-left">Имэйл</th>
            <th className="px-4 py-2.5 text-left">Нэр</th>
            <th className="px-4 py-2.5 text-left">Role</th>
            <th className="px-4 py-2.5 text-left">2FA</th>
            <th className="px-4 py-2.5 text-left">Үүсгэсэн</th>
            <th className="px-4 py-2.5 text-right">Үйлдэл</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            const fb = feedback?.id === u.id ? feedback : null;
            return (
              <>
                <tr key={u.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{u.email}</span>
                    {isSelf && <span className="ml-2 text-[10px] text-accent">(та)</span>}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-400">{u.full_name ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`badge ${
                        u.role === "admin"
                          ? "bg-accent/15 text-accent"
                          : u.role === "auditor"
                          ? "bg-warning/15 text-warning"
                          : "bg-neutral-500/15 text-neutral-300"
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {u.totp_enabled ? (
                      <span className="badge bg-success/15 text-success">enabled</span>
                    ) : (
                      <span className="badge bg-neutral-500/15 text-neutral-500">disabled</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-neutral-500">{u.created_at}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {!isSelf && (
                        <>
                          <button
                            disabled={pending && busyId === u.id}
                            onClick={() => changeRole(u, nextRoleCycle(u.role))}
                            title={`Цикл: admin → viewer → auditor → admin (одоо: ${u.role})`}
                            className="p-1.5 rounded hover:bg-white/5 text-neutral-400 hover:text-accent"
                          >
                            {u.role === "admin" ? (
                              <ShieldOff className="w-3.5 h-3.5" />
                            ) : (
                              <Shield className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            disabled={pending && busyId === u.id}
                            onClick={() => { setResetUserId(u.id); setNewPassword(""); }}
                            title="Нууц үг шинэчлэх"
                            className="p-1.5 rounded hover:bg-white/5 text-neutral-400 hover:text-warning"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>
                          <button
                            disabled={pending && busyId === u.id}
                            onClick={() => removeUser(u)}
                            title="Устгах"
                            className="p-1.5 rounded hover:bg-danger/15 text-neutral-400 hover:text-danger"
                          >
                            {pending && busyId === u.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {resetUserId === u.id && (
                  <tr className="bg-bg-tertiary/30">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          placeholder="Шинэ нууц үг (8+ тэмдэгт)"
                          minLength={8}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="input text-xs flex-1 max-w-sm"
                          autoComplete="new-password"
                        />
                        <button
                          onClick={() => resetPassword(u)}
                          disabled={pending && busyId === u.id}
                          className="btn-primary text-xs"
                        >
                          Хадгалах
                        </button>
                        <button
                          onClick={() => { setResetUserId(null); setNewPassword(""); }}
                          className="btn-ghost text-xs"
                        >
                          Цуцлах
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
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
