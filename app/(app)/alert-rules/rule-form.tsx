"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2, AlertCircle, Check } from "lucide-react";
import { createRuleAction } from "./actions";

interface Option {
  id: string;
  name: string;
}

export function RuleForm({ suspects, cameras }: { suspects: Option[]; cameras: Option[] }) {
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
        <button onClick={() => setOpen(true)} className="btn-primary text-sm">
          <Plus className="w-4 h-4" />
          Шинэ дүрэм
        </button>
        {ok && (
          <span className="text-xs text-success flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            Дүрэм нэмлээ
          </span>
        )}
      </div>
    );
  }

  return (
    <form action={onSubmit} className="card mb-4 space-y-4">
      <h3 className="text-sm font-semibold">Шинэ alert rule</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          name="name"
          placeholder="Дүрмийн нэр (жнь: 'Гол хаалга, ажлын цаг')"
          required
          maxLength={120}
          className="input text-sm md:col-span-2"
        />
        <label className="flex items-center gap-2 text-xs text-neutral-300">
          <input type="checkbox" name="enabled" defaultChecked className="accent-accent" />
          Идэвхтэй
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-1">
            Сэжигтэн (хоосон = бүгд)
          </label>
          <select name="suspect_id" defaultValue="" className="input text-sm">
            <option value="">— Бүх сэжигтэн —</option>
            {suspects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-1">
            Камер (хоосон = бүгд)
          </label>
          <select name="camera_id" defaultValue="" className="input text-sm">
            <option value="">— Бүх камер —</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-1">
            Min similarity
          </label>
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
          <label className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-1">
            Dedup цонх (сек)
          </label>
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
          <label className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-1">
            Burst min (хэдэн ширхэг)
          </label>
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
          <label className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-1">
            Burst цонх (сек)
          </label>
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
          <label className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-1">
            Чимээгүй эхлэх (KST, optional)
          </label>
          <input type="time" name="quiet_from" className="input text-sm" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-1">
            Чимээгүй дуусах (KST, optional)
          </label>
          <input type="time" name="quiet_to" className="input text-sm" />
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
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Үүсгэх
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="btn-ghost text-sm"
        >
          Цуцлах
        </button>
      </div>
    </form>
  );
}
