"use client";

import { useState, useTransition } from "react";
import { Webhook, Loader2, AlertCircle, Check, Copy } from "lucide-react";
import { createWebhookAction } from "./actions";

const EVENTS = [
  { key: "alert_created", label: "Шинэ alert үүсэх" },
  { key: "reveal_completed", label: "Reveal job дуусах" },
  { key: "system_health", label: "Systme health алдаа" },
  { key: "audit_critical", label: "Чухал аудит үйлдэл" },
] as const;

export function WebhookForm() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  function onSubmit(fd: FormData) {
    setError(null);
    setSecret(null);
    startTransition(async () => {
      const res = await createWebhookAction(fd);
      if (res?.error) setError(res.error);
      else {
        if (res?.signing_secret) setSecret(res.signing_secret);
        setOpen(false);
      }
    });
  }

  if (!open && !secret) {
    return (
      <div className="mb-4">
        <button onClick={() => setOpen(true)} className="btn-primary text-sm">
          <Webhook className="w-4 h-4" />
          Шинэ webhook
        </button>
      </div>
    );
  }

  if (secret) {
    return (
      <div className="card mb-4 bg-success/5 border-success/30 space-y-3">
        <div className="flex items-center gap-2 text-success">
          <Check className="w-4 h-4" />
          <strong className="text-sm">Webhook үүслээ</strong>
        </div>
        <p className="text-xs text-neutral-300">
          Generic webhook-ийн HMAC signing secret. Энэ нь дахин харагдахгүй — одоо хадгална уу.
        </p>
        <div className="flex items-center gap-2 bg-bg-tertiary rounded p-2">
          <code className="text-xs font-mono text-accent flex-1 truncate">{secret}</code>
          <button
            onClick={() => navigator.clipboard?.writeText(secret)}
            className="p-1.5 rounded hover:bg-white/5 text-neutral-400 hover:text-accent"
            title="Хуулах"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
        <button onClick={() => setSecret(null)} className="btn-ghost text-xs">
          Хаах
        </button>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="card mb-4 space-y-3">
      <h3 className="text-sm font-semibold">Шинэ webhook</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          name="name"
          placeholder="Нэр (жнь: 'Security alerts → Slack')"
          required
          maxLength={120}
          className="input text-sm md:col-span-2"
        />
        <select name="kind" defaultValue="slack" className="input text-sm" required>
          <option value="slack">Slack</option>
          <option value="discord">Discord</option>
          <option value="generic">Generic (HMAC signed)</option>
        </select>
      </div>

      <input
        name="url"
        type="url"
        placeholder="https://hooks.slack.com/... эсвэл https://discord.com/api/webhooks/..."
        required
        pattern="https://.*"
        className="input text-sm"
      />

      <div>
        <label className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-1.5">
          Сонгох event-ууд
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {EVENTS.map((e) => (
            <label key={e.key} className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
              <input
                type="checkbox"
                name={`event_${e.key}`}
                defaultChecked={e.key === "alert_created"}
                className="accent-accent"
              />
              {e.label}
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
        <button type="submit" disabled={pending} className="btn-primary text-sm">
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Webhook className="w-3.5 h-3.5" />}
          Үүсгэх
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} className="btn-ghost text-sm">
          Цуцлах
        </button>
      </div>
    </form>
  );
}
