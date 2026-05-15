"use client";

import { useState, useTransition } from "react";
import { Trash2, Power, Loader2 } from "lucide-react";
import { toggleRuleAction, deleteRuleAction } from "./actions";
import { formatDate } from "@/lib/utils";

interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  min_similarity: number;
  dedup_window_sec: number;
  burst_count: number;
  burst_window_sec: number;
  quiet_from: string | null;
  quiet_to: string | null;
  suspect_name: string | null;
  camera_name: string | null;
  created_at: string;
}

export function RulesTable({ rules }: { rules: Rule[] }) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function toggle(r: Rule) {
    setBusy(r.id);
    startTransition(async () => {
      await toggleRuleAction(r.id, !r.enabled);
      setBusy(null);
    });
  }

  function remove(r: Rule) {
    if (!confirm(`"${r.name}" дүрмийг устгах уу?`)) return;
    setBusy(r.id);
    startTransition(async () => {
      await deleteRuleAction(r.id);
      setBusy(null);
    });
  }

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="bg-bg-tertiary/50">
          <tr className="text-xs uppercase tracking-wide text-neutral-400">
            <th className="px-4 py-2.5 text-left">Нэр</th>
            <th className="px-4 py-2.5 text-left">Хамрах хүрээ</th>
            <th className="px-4 py-2.5 text-left">Threshold</th>
            <th className="px-4 py-2.5 text-left">Dedup</th>
            <th className="px-4 py-2.5 text-left">Burst</th>
            <th className="px-4 py-2.5 text-left">Чимээгүй</th>
            <th className="px-4 py-2.5 text-right">Үйлдэл</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rules.map((r) => (
            <tr key={r.id} className="hover:bg-white/[0.02]">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${r.enabled ? "bg-success" : "bg-neutral-600"}`} />
                  <span className="font-medium">{r.name}</span>
                </div>
                <div className="text-[10px] text-neutral-500 mt-0.5">{formatDate(r.created_at)}</div>
              </td>
              <td className="px-4 py-2.5 text-xs text-neutral-400">
                <div>Сэжигтэн: <span className="text-neutral-200">{r.suspect_name ?? "any"}</span></div>
                <div>Камер: <span className="text-neutral-200">{r.camera_name ?? "any"}</span></div>
              </td>
              <td className="px-4 py-2.5 text-xs font-mono">≥ {r.min_similarity.toFixed(2)}</td>
              <td className="px-4 py-2.5 text-xs">{r.dedup_window_sec === 0 ? "off" : `${r.dedup_window_sec}s`}</td>
              <td className="px-4 py-2.5 text-xs">
                {r.burst_count > 1 ? `${r.burst_count} / ${r.burst_window_sec}s` : "off"}
              </td>
              <td className="px-4 py-2.5 text-xs">
                {r.quiet_from && r.quiet_to ? `${r.quiet_from}—${r.quiet_to}` : "—"}
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    disabled={pending && busy === r.id}
                    onClick={() => toggle(r)}
                    title={r.enabled ? "Disable" : "Enable"}
                    className={`p-1.5 rounded hover:bg-white/5 ${
                      r.enabled ? "text-success" : "text-neutral-500"
                    }`}
                  >
                    {pending && busy === r.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Power className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    disabled={pending && busy === r.id}
                    onClick={() => remove(r)}
                    title="Устгах"
                    className="p-1.5 rounded hover:bg-danger/15 text-neutral-400 hover:text-danger"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
