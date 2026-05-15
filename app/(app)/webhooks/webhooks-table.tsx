"use client";

import { useState, useTransition } from "react";
import { Trash2, Send, Loader2 } from "lucide-react";
import { deleteWebhookAction, testWebhookAction } from "./actions";

interface Hook {
  id: string;
  name: string;
  kind: "slack" | "discord" | "generic";
  url: string;
  enabled: boolean;
  events: string[];
  last_fired_at: string | null;
  last_status: number | null;
  fail_count: number;
  created_at: string;
}

const KIND_BG: Record<Hook["kind"], string> = {
  slack: "bg-purple-500/15 text-purple-300",
  discord: "bg-indigo-500/15 text-indigo-300",
  generic: "bg-neutral-500/15 text-neutral-300",
};

export function WebhooksTable({ hooks }: { hooks: Hook[] }) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<{ id: string; action: "delete" | "test" } | null>(null);

  function remove(h: Hook) {
    if (!confirm(`"${h.name}" webhook-ийг устгах уу?`)) return;
    setBusy({ id: h.id, action: "delete" });
    startTransition(async () => {
      await deleteWebhookAction(h.id);
      setBusy(null);
    });
  }

  function test(h: Hook) {
    setBusy({ id: h.id, action: "test" });
    startTransition(async () => {
      await testWebhookAction(h.id);
      setBusy(null);
    });
  }

  function statusBadge(h: Hook) {
    if (!h.last_fired_at) return <span className="text-xs text-neutral-500">never</span>;
    if (h.fail_count > 0) return <span className="badge bg-danger/15 text-danger">{h.fail_count} fail</span>;
    if (h.last_status && h.last_status >= 200 && h.last_status < 300) {
      return <span className="badge bg-success/15 text-success">{h.last_status}</span>;
    }
    return <span className="badge bg-warning/15 text-warning">{h.last_status ?? "?"}</span>;
  }

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="bg-bg-tertiary/50">
          <tr className="text-xs uppercase tracking-wide text-neutral-400">
            <th className="px-4 py-2.5 text-left">Нэр</th>
            <th className="px-4 py-2.5 text-left">Төрөл</th>
            <th className="px-4 py-2.5 text-left">Event-ууд</th>
            <th className="px-4 py-2.5 text-left">Сүүлд</th>
            <th className="px-4 py-2.5 text-left">Статус</th>
            <th className="px-4 py-2.5 text-right">Үйлдэл</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {hooks.map((h) => (
            <tr key={h.id} className="hover:bg-white/[0.02]">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${h.enabled ? "bg-success" : "bg-neutral-600"}`} />
                  <span className="font-medium">{h.name}</span>
                </div>
                <div className="text-[10px] text-neutral-500 font-mono truncate max-w-xs">{h.url}</div>
              </td>
              <td className="px-4 py-2.5">
                <span className={`badge ${KIND_BG[h.kind]}`}>{h.kind}</span>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex flex-wrap gap-1">
                  {h.events.map((e) => (
                    <span key={e} className="badge bg-white/5 text-neutral-300 text-[10px]">{e}</span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-2.5 text-xs text-neutral-500">{h.last_fired_at ?? "—"}</td>
              <td className="px-4 py-2.5">{statusBadge(h)}</td>
              <td className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    disabled={pending}
                    onClick={() => test(h)}
                    title="Тест явуулах"
                    className="p-1.5 rounded hover:bg-accent/15 text-neutral-400 hover:text-accent"
                  >
                    {pending && busy?.id === h.id && busy.action === "test" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    disabled={pending}
                    onClick={() => remove(h)}
                    title="Устгах"
                    className="p-1.5 rounded hover:bg-danger/15 text-neutral-400 hover:text-danger"
                  >
                    {pending && busy?.id === h.id && busy.action === "delete" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
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
