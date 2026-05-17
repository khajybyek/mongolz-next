"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, X, AlertTriangle } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { cn } from "@/lib/utils";

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
}

/**
 * Realtime alerts toast — admin only.
 */
export function RealtimeAlerts({
  labels = {
    matchLabel: "Match",
    seeAll: "See all alerts →",
    dismiss: "Close",
  },
}: {
  labels?: RealtimeAlertsLabels;
} = {}) {
  const [toasts, setToasts] = useState<Alert[]>([]);
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

  return (
    <>
      {/* Audio - subtle ping */}
      <audio
        ref={audioRef}
        src="data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAA=="
        preload="auto"
      />

      {/* Toast stack — top-right */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none w-[min(360px,calc(100vw-2rem))]">
        {toasts.map((a) => (
          <div
            key={a.id}
            className={cn(
              "card pointer-events-auto bg-bg-secondary/95 backdrop-blur",
              "border border-danger/40 shadow-2xl",
              "flex items-start gap-2 p-3 animate-in slide-in-from-right"
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
              <a
                href="/alerts"
                className="text-[11px] text-accent hover:underline mt-1 inline-flex items-center gap-1"
              >
                <Bell className="w-3 h-3" />
                {labels.seeAll}
              </a>
            </div>
            <button
              onClick={() => dismiss(a.id)}
              className="text-text-muted hover:text-text shrink-0"
              aria-label={labels.dismiss}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
