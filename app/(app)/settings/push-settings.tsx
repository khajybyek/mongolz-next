"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, BellOff, Trash2, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { TotpPrompt } from "@/components/totp-prompt";

type Sub = {
  id: string;
  endpoint: string;
  ua: string | null;
  enabled: boolean;
  created_at: string;
  last_used_at: string | null;
};

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** `canEnrol` = false for an admin without TOTP (the step-up cannot succeed). */
export function PushSettings({ canEnrol = true }: { canEnrol?: boolean }) {
  const { t } = useT();
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"enroll" | "test" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Admins must present the second factor before a new notification channel
  // is registered; on REAUTH_REQUIRED the prompt opens and enrolment retries.
  const [needsTotp, setNeedsTotp] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/push/subscribe", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as { subscriptions?: Sub[] } | null;
      if (r.ok) setSubs((j?.subscriptions ?? []) as Sub[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(ok);
    if (ok) setPermission(Notification.permission);
    refresh();
  }, [refresh]);

  async function enroll() {
    setError(null);
    setSuccess(null);
    setBusy("enroll");
    try {
      const keyResp = await fetch("/api/push/public-key");
      const keyJson = await keyResp.json();
      if (!keyResp.ok) throw new Error(keyJson?.error ?? t("set_push_no_vapid"));
      const pub = keyJson.publicKey as string;

      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe().catch(() => undefined);

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error(t("push_blocked"));

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pub),
      });

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error(t("set_push_invalid_sub"));
      }
      const post = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          ua: navigator.userAgent,
        }),
      });
      const postJson = await post.json();
      if (post.status === 403 && postJson?.error === "REAUTH_REQUIRED") {
        setNeedsTotp(true);
        return;
      }
      if (!post.ok) throw new Error(postJson?.error ?? t("set_push_subscribe_failed"));
      setSuccess(t("push_status_enabled"));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setError(null);
    setSuccess(null);
    setBusy("test");
    try {
      const r = await fetch("/api/push/test", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? t("set_push_test_failed"));
      if ((j.delivered ?? 0) === 0) {
        setError(t("set_push_none_deliverable"));
      } else {
        setSuccess(`${t("set_push_test_sent")} · delivered=${j.delivered}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function removeSub(endpoint: string, id: string) {
    setBusy(id);
    setError(null);
    setSuccess(null);
    try {
      const r = await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`, {
        method: "DELETE",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? t("set_push_delete_failed"));
      try {
        const reg = await navigator.serviceWorker.ready;
        const cur = await reg.pushManager.getSubscription();
        if (cur && cur.endpoint === endpoint) await cur.unsubscribe();
      } catch {
        /* ignore */
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card space-y-3">
      <TotpPrompt
        open={needsTotp}
        onClose={() => setNeedsTotp(false)}
        onSuccess={() => {
          setNeedsTotp(false);
          void enroll();
        }}
      />
      <div className="flex items-start gap-2">
        <BellRing className="w-4 h-4 mt-0.5 text-accent" />
        <div className="min-w-0">
          <h3 className="section-title">{t("push_title")}</h3>
          <p className="text-xs text-text-soft leading-relaxed">{t("push_desc")}</p>
        </div>
      </div>

      {!supported && (
        <div className="text-xs text-text-muted flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" /> {t("push_unsupported")}
        </div>
      )}

      {supported && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={enroll}
              disabled={busy === "enroll" || !canEnrol}
              className="btn-primary"
            >
              {busy === "enroll" ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
              <span>{t("push_enable")}</span>
            </button>
            <button
              type="button"
              onClick={sendTest}
              disabled={busy === "test" || subs.filter((s) => s.enabled).length === 0}
              className="btn-secondary"
            >
              {busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellOff className="w-4 h-4 rotate-12" />}
              <span>{t("push_test")}</span>
            </button>
          </div>

          {!canEnrol && (
            <div className="text-xs text-warning flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> {t("set_enrol_needs_totp")}
            </div>
          )}
          {permission === "denied" && (
            <div className="text-xs text-danger-ring">{t("push_blocked")}</div>
          )}
          {error && <div className="text-xs text-danger-ring flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{error}</div>}
          {success && <div className="text-xs text-success-ring flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{success}</div>}

          {loading ? (
            <div className="text-xs text-text-muted">{t("loading_dots")}</div>
          ) : subs.length === 0 ? (
            <div className="text-xs text-text-muted">{t("set_push_none")}</div>
          ) : (
            <ul className="divide-y divide-border border border-border rounded">
              {subs.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                  <span className={s.enabled ? "text-success-ring" : "text-text-faint"}>
                    {s.enabled ? "●" : "○"}
                  </span>
                  <span className="truncate flex-1" title={s.ua ?? ""}>
                    {s.ua ? s.ua.slice(0, 64) : new URL(s.endpoint).host}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSub(s.endpoint, s.id)}
                    disabled={busy === s.id}
                    className="btn-icon hover:text-danger"
                    aria-label={t("remove")}
                    title={t("remove")}
                  >
                    {busy === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
