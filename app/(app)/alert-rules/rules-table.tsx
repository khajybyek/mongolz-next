"use client";

import { useState, useTransition } from "react";
import { Trash2, Power, Loader2 } from "lucide-react";
import { toggleRuleAction, deleteRuleAction } from "./actions";
import { formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

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
  const { t } = useT();
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
    if (!confirm(`"${r.name}" — ${t("delete_confirm")}`)) return;
    setBusy(r.id);
    startTransition(async () => {
      await deleteRuleAction(r.id);
      setBusy(null);
    });
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t("col_name")}</th>
              <th>{t("col_scope")}</th>
              <th>Threshold</th>
              <th>Dedup</th>
              <th>Burst</th>
              <th>{t("col_quiet")}</th>
              <th className="text-right">{t("col_action")}</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        r.enabled ? "bg-success" : "bg-text-faint"
                      }`}
                    />
                    <span className="font-medium text-text">{r.name}</span>
                  </div>
                  <div className="text-2xs text-text-muted mt-0.5">
                    {formatDate(r.created_at)}
                  </div>
                </td>
                <td className="text-xs">
                  <div>
                    {t("scope_suspect")}:{" "}
                    <span className="text-text">{r.suspect_name ?? t("any_lower")}</span>
                  </div>
                  <div>
                    {t("scope_camera")}:{" "}
                    <span className="text-text">{r.camera_name ?? t("any_lower")}</span>
                  </div>
                </td>
                <td className="text-xs font-mono">≥ {r.min_similarity.toFixed(2)}</td>
                <td className="text-xs">
                  {r.dedup_window_sec === 0 ? t("off_lower") : `${r.dedup_window_sec}s`}
                </td>
                <td className="text-xs">
                  {r.burst_count > 1
                    ? `${r.burst_count} / ${r.burst_window_sec}s`
                    : t("off_lower")}
                </td>
                <td className="text-xs">
                  {r.quiet_from && r.quiet_to ? `${r.quiet_from}—${r.quiet_to}` : "—"}
                </td>
                <td>
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      disabled={pending && busy === r.id}
                      onClick={() => toggle(r)}
                      title={r.enabled ? "Disable" : "Enable"}
                      className={`p-1.5 rounded hover:bg-white/5 ${
                        r.enabled ? "text-success" : "text-text-muted"
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
                      title={t("delete_btn")}
                      className="p-1.5 rounded hover:bg-danger-soft text-text-soft hover:text-danger"
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
    </div>
  );
}
