"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, X, AlertTriangle, Check, Loader2 } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

interface Alert {
  id: string;
  suspect_name: string;
  similarity: number;
  camera_name: string | null;
  created_at: string;
}

interface RealtimeAlertsLabels {
  matchLabel: string;       // "Тааралцал" / "Match" / "일치율"
  seeAll: string;            // "Бүх alert харах →"
  dismiss: string;           // "Хаах"
  ack: string;
  ackFailed?: string;               // "Хүлээн авах" / "Acknowledge"
}

/**
 * Realtime alerts toast — admin only.
 */
export function RealtimeAlerts({
  labels = {
    matchLabel: "Match",
    seeAll: "See all alerts →",
    dismiss: "Close",
    ack: "Acknowledge",
  },
}: {
  labels?: RealtimeAlertsLabels;
} = {}) {
  const [toasts, setToasts] = useState<Alert[]>([]);
  const { toast } = useToast();
  const [acking, setAcking] = useState<Set<string>>(() => new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const notifPermissionRef = useRef<NotificationPermission>("default");

  // Permission асуух (анх удаа л)
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    notifPermissionRef.current = Notification.permission;
    if (Notification.permission === "default") {
      Notification.requestPermission().then((p) => {
        notifPermissionRef.current = p;
      });
    }
  }, []);

  // Supabase Realtime subscription
  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;

    const supabase = createBrowserClient(url, key);

    const channel = supabase
      .channel("realtime-alerts")
      .on(
        "postgres_changes" as never,
        { event: "INSERT", schema: "public", table: "alerts" },
        (payload: { new: Alert }) => {
          const a = payload.new;
          setToasts((prev) => [a, ...prev.slice(0, 4)]);
          setTimeout(() => dismiss(a.id), 10000);
          // Browser notification
          if (notifPermissionRef.current === "granted") {
            try {
              new Notification(`🚨 Alert: ${a.suspect_name}`, {
                body: `${labels.matchLabel} ${(a.similarity * 100).toFixed(1)}% · ${
                  a.camera_name ?? "Unknown"
                }`,
                icon: "/icon.png",
                tag: a.id,
              });
            } catch {}
          }
          // Sound (optional)
          audioRef.current?.play().catch(() => {});
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // Acknowledge straight from the popup. On failure the toast stays up with
  // the button re-enabled — the /alerts page carries the full error path.
  async function acknowledge(id: string) {
    setAcking((prev) => new Set(prev).add(id));
    let ok = false;
    try {
      const res = await fetch(`/api/alerts/${id}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "acknowledged" }),
      });
      // 409 = someone else already moved it; nothing left to do here either.
      ok = res.ok || res.status === 409;
    } catch {
      ok = false;
    }
    setAcking((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (ok) dismiss(id);
    else toast({ title: labels.ackFailed ?? "Acknowledge failed", tone: "danger" });
  }

  return (
    <>
      {/* Audio - subtle ping */}
      <audio
        ref={audioRef}
        src="data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAA=="
        preload="auto"
      />

      {/* Toast stack — top-right */}
      <div className="fixed top-[calc(4.5rem+env(safe-area-inset-top,0px))] right-4 z-50 flex flex-col gap-2 pointer-events-none w-[min(360px,calc(100vw-2rem))]">
        {toasts.map((a) => (
          <div
            key={a.id}
            className={cn(
              "pointer-events-auto rounded-xl bg-surface-elevated/95 backdrop-blur-xl",
              "border border-danger/40 shadow-overlay",
              "flex items-start gap-2.5 p-3.5 animate-slide-in-right"
            )}
          >
            <div className="w-8 h-8 rounded-full bg-danger/15 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-danger" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-danger truncate">
                🚨 {a.suspect_name}
              </div>
              <div className="text-[11px] text-text-soft mt-0.5">
                {(a.similarity * 100).toFixed(1)}% · {a.camera_name ?? "—"}
              </div>
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => acknowledge(a.id)}
                  disabled={acking.has(a.id)}
                  className="btn-outline btn-sm"
                >
                  {acking.has(a.id) ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3" />
                  )}
                  {labels.ack}
                </button>
                <a
                  href="/alerts"
                  className="text-[11px] text-accent hover:underline inline-flex items-center gap-1"
                >
                  <Bell className="w-3 h-3" />
                  {labels.seeAll}
                </a>
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismiss(a.id)}
              className="shrink-0 -mr-1 -mt-1 w-7 h-7 inline-flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-text-muted/[0.08] transition-colors"
              aria-label={labels.dismiss}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
