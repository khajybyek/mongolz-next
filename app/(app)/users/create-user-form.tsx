"use client";

import { useRef, useState, useTransition } from "react";
import { UserPlus, Loader2, AlertCircle, Check } from "lucide-react";
import { createUserAction } from "./actions";
import { TotpPrompt } from "@/components/totp-prompt";
import { useT } from "@/lib/i18n/client";

const REAUTH_REQUIRED = "REAUTH_REQUIRED";

export function CreateUserForm() {
  const { t } = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const pendingFormData = useRef<FormData | null>(null);

  function runCreate(fd: FormData) {
    setError(null);
    setOk(false);
    pendingFormData.current = fd;
    startTransition(async () => {
      const res = await createUserAction(fd);
      if ("error" in res) {
        if (res.error === REAUTH_REQUIRED) {
          setNeedsTotp(true);
          return;
        }
        pendingFormData.current = null;
        setError(res.error);
      } else {
        pendingFormData.current = null;
        setOk(true);
        setShowForm(false);
        setTimeout(() => setOk(false), 3000);
      }
    });
  }

  function onSubmit(formData: FormData) {
    runCreate(formData);
  }

  function onTotpSuccess() {
    setNeedsTotp(false);
    const fd = pendingFormData.current;
    if (fd) runCreate(fd);
  }

  if (!showForm) {
    return (
      <>
        <div className="mb-4 flex items-center gap-3">
          <button onClick={() => setShowForm(true)} className="btn-primary btn-sm">
            <UserPlus className="w-4 h-4" />
            {t("users_new_btn")}
          </button>
          {ok && (
            <span className="text-xs text-success flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              {t("users_created_ok")}
            </span>
          )}
        </div>
        <TotpPrompt
          open={needsTotp}
          onClose={() => {
            setNeedsTotp(false);
            pendingFormData.current = null;
          }}
          onSuccess={onTotpSuccess}
        />
      </>
    );
  }

  return (
    <>
      <form action={onSubmit} className="card mb-4 space-y-3">
        <h3 className="section-title">{t("users_new_form_title")}</h3>
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
            placeholder={t("users_pwd_placeholder")}
            required
            minLength={8}
            className="input text-sm"
            autoComplete="new-password"
          />
          <input
            name="full_name"
            type="text"
            placeholder={t("users_fullname_placeholder")}
            className="input text-sm"
          />
          <select name="role" defaultValue="viewer" required className="select text-sm">
            <option value="viewer">Viewer (read-only)</option>
            <option value="auditor">Auditor (audit log only)</option>
            <option value="admin">Admin (full access)</option>
          </select>
        </div>

        {error && (
          <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={pending} className="btn-primary btn-sm">
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
            {t("create_btn")}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowForm(false);
              setError(null);
            }}
            className="btn-ghost btn-sm"
          >
            {t("cancel_btn")}
          </button>
        </div>
      </form>
      <TotpPrompt
        open={needsTotp}
        onClose={() => {
          setNeedsTotp(false);
          pendingFormData.current = null;
        }}
        onSuccess={onTotpSuccess}
      />
    </>
  );
}
