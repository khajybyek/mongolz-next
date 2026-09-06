"use client";

import { useRef, useState, useTransition } from "react";
import { Trash2, Send, Loader2 } from "lucide-react";
import { deleteWebhookAction, testWebhookAction } from "./actions";
import { TotpPrompt } from "@/components/totp-prompt";
import { useT } from "@/lib/i18n/client";

const REAUTH_REQUIRED = "REAUTH_REQUIRED";

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
  generic: "bg-text-muted/15 text-text-soft",
};

export function WebhooksTable({ hooks }: { hooks: Hook[] }) {
  const { t } = useT();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<{ id: string; action: "delete" | "test" } | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const pendingDeleteRef = useRef<string | null>(null);

  function runDelete(id: string) {
    setBusy({ id, action: "delete" });
    startTransition(async () => {
      const res = await deleteWebhookAction(id);
      setBusy(null);
      if (res && "error" in res && res.error === REAUTH_REQUIRED) {
        pendingDeleteRef.current = id;
        setNeedsTotp(true);
      }
    });
  }

  function remove(h: Hook) {
    if (!confirm(`"${h.name}" — ${t("wh_delete_confirm")}`)) return;
    runDelete(h.id);
  }

  function test(h: Hook) {
    setBusy({ id: h.id, action: "test" });
    startTransition(async () => {
      await testWebhookAction(h.id);
      setBusy(null);
    });
  }

  function statusBadge(h: Hook) {
    if (!h.last_fired_at) return <span className="text-xs text-text-muted">{t("wh_never")}</span>;
    if (h.fail_count > 0) return <span className="badge bg-danger/15 text-danger">{h.fail_count} {t("wh_fail")}</span>;
    if (h.last_status && h.last_status >= 200 && h.last_status < 300) {
      return <span className="badge bg-success/15 text-success">{h.last_status}</span>;
    }
    return <span className="badge bg-warning/15 text-warning">{h.last_status ?? "?"}</span>;
  }

  return (
    <>
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>{t("col_name")}</th>
            <th>{t("camera_type")}</th>
            <th>{t("wh_col_events")}</th>
            <th>{t("wh_col_last")}</th>
            <th>{t("col_status")}</th>
            <th className="text-right">{t("col_actions")}</th>
          </tr>
        </thead>
        <tbody>
          {hooks.map((h) => (
            <tr key={h.id}>
              <td>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${h.enabled ? "bg-success" : "bg-text-faint"}`} />
                  <span className="font-medium text-text">{h.name}</span>
                </div>
                <div className="text-[10px] text-text-muted font-mono truncate max-w-xs">{h.url}</div>
              </td>
              <td>
                <span className={`badge ${KIND_BG[h.kind]}`}>{h.kind}</span>
              </td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {h.events.map((e) => (
                    <span key={e} className="badge bg-text-muted/5 text-text-soft text-[10px]">{e}</span>
                  ))}
                </div>
              </td>
              <td className="text-xs text-text-muted">{h.last_fired_at ?? "—"}</td>
              <td>{statusBadge(h)}</td>
              <td>
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => test(h)}
                    title={t("wh_test")}
                    aria-label={t("wh_test")}
                    className="btn-icon hover:text-accent"
                  >
                    {pending && busy?.id === h.id && busy.action === "test" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(h)}
                    title={t("delete")}
                    aria-label={t("delete")}
                    className="btn-icon hover:text-danger"
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
    <TotpPrompt
      open={needsTotp}
      onClose={() => {
        setNeedsTotp(false);
        pendingDeleteRef.current = null;
      }}
      onSuccess={() => {
        setNeedsTotp(false);
        const id = pendingDeleteRef.current;
        if (id) {
          pendingDeleteRef.current = null;
          runDelete(id);
        }
      }}
    />
    </>
  );
}
