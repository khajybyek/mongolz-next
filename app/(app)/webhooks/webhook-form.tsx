"use client";

import { useRef, useState, useTransition } from "react";
import { Webhook, Loader2, AlertCircle, Check, Copy } from "lucide-react";
import { createWebhookAction } from "./actions";
import { TotpPrompt } from "@/components/totp-prompt";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";

const REAUTH_REQUIRED = "REAUTH_REQUIRED";

const EVENTS = [
  { key: "alert_created", labelKey: "wh_ev_alert_created" },
  { key: "reveal_completed", labelKey: "wh_ev_reveal_completed" },
  { key: "system_health", labelKey: "wh_ev_system_health" },
  { key: "audit_critical", labelKey: "wh_ev_audit_critical" },
] as const;

export function WebhookForm() {
  const { t } = useT();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  // Keeps the submitted form data so the request can be replayed after a
  // successful step-up (the server answers REAUTH_REQUIRED when the 15-min
  // reauth cookie has lapsed).
  const retryFd = useRef<FormData | null>(null);

  function onSubmit(fd: FormData) {
    setError(null);
    setSecret(null);
    startTransition(async () => {
      const res = await createWebhookAction(fd);
      if (res?.error === REAUTH_REQUIRED) {
        retryFd.current = fd;
        setNeedsTotp(true);
        return;
      }
      if (res?.error) {
        setError(res.error);
        toast({ title: t("toast_failed"), description: res.error, tone: "danger" });
      } else {
        if (res?.signing_secret) setSecret(res.signing_secret);
        toast({ title: t("wh_created"), tone: "success" });
        setOpen(false);
      }
    });
  }

  const totpPrompt = (
    <TotpPrompt
      open={needsTotp}
      onClose={() => {
        setNeedsTotp(false);
        retryFd.current = null;
      }}
      onSuccess={() => {
        setNeedsTotp(false);
        const fd = retryFd.current;
        retryFd.current = null;
        if (fd) onSubmit(fd);
      }}
    />
  );

  if (!open && !secret) {
    return (
      <div className="mb-4">
        <button type="button" onClick={() => setOpen(true)} className="btn-primary">
          <Webhook className="w-4 h-4" />
          {t("wh_new")}
        </button>
      </div>
    );
  }

  if (secret) {
    return (
      <div className="card mb-4 bg-success/5 border-success/30 space-y-3">
        <div className="flex items-center gap-2 text-success">
          <Check className="w-4 h-4" />
          <strong className="text-sm">{t("wh_created")}</strong>
        </div>
        <p className="text-xs text-text-soft">
          {t("wh_secret_note")}
        </p>
        <div className="flex items-center gap-2 bg-bg-tertiary rounded p-2">
          <code className="text-xs font-mono text-accent flex-1 truncate">{secret}</code>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(secret)}
            className="btn-icon hover:text-accent"
            title={t("wh_copy")}
            aria-label={t("wh_copy")}
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
        <button type="button" onClick={() => setSecret(null)} className="btn-ghost btn-sm">
          {t("rt_dismiss")}
        </button>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="card mb-4 space-y-3">
      <h3 className="section-title">{t("wh_new")}</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          name="name"
          placeholder={t("wh_name_placeholder")}
          required
          maxLength={120}
          className="input md:col-span-2"
        />
        <select name="kind" defaultValue="slack" className="select" required>
          <option value="slack">Slack</option>
          <option value="discord">Discord</option>
          <option value="generic">{t("wh_kind_generic")}</option>
        </select>
      </div>

      <input
        name="url"
        type="url"
        placeholder={t("wh_url_placeholder")}
        required
        pattern="https://.*"
        className="input"
      />

      <div>
        <label className="label">
          {t("wh_events_label")}
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {EVENTS.map((e) => (
            <label key={e.key} className="flex items-center gap-2 text-xs text-text-soft cursor-pointer">
              <input
                type="checkbox"
                name={`event_${e.key}`}
                defaultChecked={e.key === "alert_created"}
                className="accent-accent"
              />
              {t(e.labelKey)}
            </label>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-xs text-danger bg-danger/10 rounded px-3 py-2 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Webhook className="w-3.5 h-3.5" />}
          {t("create_btn")}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} className="btn-ghost">
          {t("cancel_btn")}
        </button>
      </div>
      {totpPrompt}
    </form>
  );
}
