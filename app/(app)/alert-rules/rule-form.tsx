"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2, AlertCircle, Check } from "lucide-react";
import { createRuleAction } from "./actions";
import { useT } from "@/lib/i18n/client";

interface Option {
  id: string;
  name: string;
}

export function RuleForm({ suspects, cameras }: { suspects: Option[]; cameras: Option[] }) {
  const { t } = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [open, setOpen] = useState(false);

  function onSubmit(formData: FormData) {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await createRuleAction(formData);
      if (res?.error) setError(res.error);
      else {
        setOk(true);
        setOpen(false);
        setTimeout(() => setOk(false), 3000);
      }
    });
  }

  if (!open) {
    return (
      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => setOpen(true)} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" />
          {t("ar_new_rule_btn")}
        </button>
        {ok && (
          <span className="text-xs text-success flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            {t("ar_added_ok")}
          </span>
        )}
      </div>
    );
  }

  return (
    <form action={onSubmit} className="card mb-4 space-y-4">
      <h3 className="section-title">{t("ar_form_title")}</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          name="name"
          placeholder={t("ar_name_placeholder")}
          required
          maxLength={120}
          className="input text-sm md:col-span-2"
        />
        <label className="flex items-center gap-2 text-xs text-text-soft">
          <input type="checkbox" name="enabled" defaultChecked className="accent-accent" />
          {t("ar_active")}
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="label">{t("ar_suspect_label")}</label>
          <select name="suspect_id" defaultValue="" className="select text-sm">
            <option value="">{t("ar_all_suspects")}</option>
            {suspects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("ar_camera_label")}</label>
          <select name="camera_id" defaultValue="" className="select text-sm">
            <option value="">{t("ar_all_cameras")}</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="label">{t("ar_min_sim")}</label>
          <input
            type="number"
            name="min_similarity"
            defaultValue={0.45}
            step={0.01}
            min={0}
            max={1}
            required
            className="input text-sm"
          />
        </div>
        <div>
          <label className="label">{t("ar_dedup_win")}</label>
          <input
            type="number"
            name="dedup_window_sec"
            defaultValue={300}
            min={0}
            max={86400}
            required
            className="input text-sm"
          />
        </div>
        <div>
          <label className="label">{t("ar_burst_count")}</label>
          <input
            type="number"
            name="burst_count"
            defaultValue={1}
            min={1}
            max={100}
            required
            className="input text-sm"
          />
        </div>
        <div>
          <label className="label">{t("ar_burst_win")}</label>
          <input
            type="number"
            name="burst_window_sec"
            defaultValue={60}
            min={1}
            max={3600}
            required
            className="input text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="label">{t("ar_quiet_from")}</label>
          <input type="time" name="quiet_from" className="input text-sm" />
        </div>
        <div>
          <label className="label">{t("ar_quiet_to")}</label>
          <input type="time" name="quiet_to" className="input text-sm" />
        </div>
      </div>

      {error && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary btn-sm">
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          {t("create_btn")}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="btn-ghost btn-sm"
        >
          {t("cancel_btn")}
        </button>
      </div>
    </form>
  );
}
