"use client";

import { useState, useTransition } from "react";
import { UserPlus, Loader2, AlertCircle, Check } from "lucide-react";
import { createUserAction } from "./actions";

export function CreateUserForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [showForm, setShowForm] = useState(false);

  function onSubmit(formData: FormData) {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await createUserAction(formData);
      if (res?.error) setError(res.error);
      else {
        setOk(true);
        setShowForm(false);
        setTimeout(() => setOk(false), 3000);
      }
    });
  }

  if (!showForm) {
    return (
      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
          <UserPlus className="w-4 h-4" />
          Шинэ хэрэглэгч
        </button>
        {ok && (
          <span className="text-xs text-success flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            Амжилттай үүсгэлээ
          </span>
        )}
      </div>
    );
  }

  return (
    <form
      action={onSubmit}
      className="card mb-4 space-y-3"
    >
      <h3 className="text-sm font-semibold">Шинэ хэрэглэгч үүсгэх</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input
          name="email"
          type="email"
          placeholder="email@example.com"
          required
          className="input text-sm"
          autoComplete="off"
        />
        <input
          name="password"
          type="password"
          placeholder="Нууц үг (8+ тэмдэгт)"
          required
          minLength={8}
          className="input text-sm"
          autoComplete="new-password"
        />
        <input
          name="full_name"
          type="text"
          placeholder="Бүтэн нэр (optional)"
          className="input text-sm"
        />
        <select name="role" defaultValue="viewer" required className="input text-sm">
          <option value="viewer">Viewer (read-only)</option>
          <option value="auditor">Auditor (audit log only)</option>
          <option value="admin">Admin (full access)</option>
        </select>
      </div>

      {error && (
        <div className="text-xs text-danger bg-danger/10 rounded px-3 py-2 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary text-sm">
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
          Үүсгэх
        </button>
        <button
          type="button"
          onClick={() => { setShowForm(false); setError(null); }}
          className="btn-ghost text-sm"
        >
          Цуцлах
        </button>
      </div>
    </form>
  );
}
