"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";

interface Alert {
  id: string;
  suspect_name: string;
  similarity: number;
  camera_name: string | null;
  created_at: string;
}

const HIGH_CONF_THRESHOLD = 0.7;
const FLASH_MS = 4000;

/**
 * Full-viewport flash overlay shown on /live when a high-confidence suspect
 * match arrives via Supabase Realtime. Designed for the defense demo: when
 * the panel sees a "match" event on the live feed, the screen pulses red
 * and a large suspect name + similarity card appears centre-screen.
 *
 * Coexists with the global RealtimeAlerts toast (top-right); this is only
 * the high-impact flash, fires for similarity >= 0.7 only.
 */
export function LiveMatchFlash() {
  const [match, setMatch] = useState<Alert | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    const supabase = createBrowserClient(url, key);

    const channel = supabase
      .channel("live-match-flash")
      .on(
        "postgres_changes" as never,
        { event: "INSERT", schema: "public", table: "alerts" },
        (payload: { new: Alert }) => {
          const a = payload.new;
          if ((a?.similarity ?? 0) < HIGH_CONF_THRESHOLD) return;
          setMatch(a);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!match) return;
    const t = window.setTimeout(() => setMatch(null), FLASH_MS);
    return () => window.clearTimeout(t);
  }, [match]);

  if (!match) return null;

  return (
    <div
      className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center"
      role="alert"
      aria-live="assertive"
    >
      {/* Pulsing red border around the viewport */}
      <div className="absolute inset-0 ring-8 ring-danger/70 animate-pulse" aria-hidden />
      <div
        className="absolute inset-0 bg-gradient-to-br from-danger/10 via-transparent to-danger/10"
        aria-hidden
      />

      {/* Centre card */}
      <button
        type="button"
        onClick={() => setMatch(null)}
        className="pointer-events-auto relative max-w-md mx-4 bg-bg-secondary/95 backdrop-blur-xl border-2 border-danger rounded-2xl p-6 shadow-2xl animate-in zoom-in-95 fade-in flex flex-col items-center text-center"
      >
        <div className="w-14 h-14 rounded-full bg-danger/15 border-2 border-danger inline-flex items-center justify-center mb-3 animate-pulse">
          <ShieldAlert className="w-7 h-7 text-danger" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-danger font-semibold">
          High-confidence match
        </div>
        <div className="text-2xl font-bold text-text mt-1 leading-tight">
          {match.suspect_name}
        </div>
        <div className="text-base font-mono text-danger mt-2">
          {(match.similarity * 100).toFixed(1)}%
        </div>
        <div className="text-sm text-text-soft mt-3 truncate max-w-full">
          {match.camera_name ?? "—"}
        </div>
        <div className="mt-4 text-2xs text-text-muted inline-flex items-center gap-1">
          <X className="w-3 h-3" />
          Click to dismiss · {Math.round(FLASH_MS / 1000)}s
        </div>
      </button>
    </div>
  );
}
