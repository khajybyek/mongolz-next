"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { formatRetryClockKst, reconnectText, type CameraRestartInfo } from "@/lib/camera-restarts";

/**
 * Warning colour: the theme token on page surfaces (/live's card), a fixed
 * light amber on video tiles. Tiles are always `bg-black`, and the light
 * theme's warning token (a dark amber) is close to invisible over video.
 */
function toneClass(onDark: boolean): string {
  return onDark ? "text-amber-300" : "text-warning";
}

/**
 * "Restarted ×N" — how often the ML supervisor re-opened this capture, with
 * the last reason as a tooltip and as screen-reader text. Renders nothing
 * before the first restart. `onDark` on the always-black video tiles;
 * `compact` (a phone tile) shows only "×N" and keeps the words for screen
 * readers and the tooltip.
 */
export function CameraRestartBadge({
  info,
  className,
  onDark = false,
  compact = false,
}: {
  info: CameraRestartInfo;
  className?: string;
  onDark?: boolean;
  compact?: boolean;
}) {
  const { t } = useT();
  if (info.count <= 0) return null;
  const label = `${t("grid_restarted")} ×${info.count}`;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", toneClass(onDark), className)}
      title={info.lastError ? `${label}: ${info.lastError}` : label}
    >
      <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />
      {compact ? (
        <>
          <span aria-hidden className="whitespace-nowrap">×{info.count}</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        label
      )}
      {info.lastError && <span className="sr-only">: {info.lastError}</span>}
    </span>
  );
}

/**
 * "Reconnecting — next try at HH:mm (KST)" for a camera in supervisor
 * backoff, with the last reason as a tooltip and screen-reader text.
 * Renders nothing for a running camera. The tooltip repeats the line, so a
 * tile that truncates it still offers the whole text. `onDark` on the
 * always-black video tiles. `compact` (a phone tile, ~60 px beside the tile
 * buttons, where a tooltip cannot be opened by touch) shows just the icon
 * and the "HH:mm" of the next try — the one fact that must stay readable —
 * with the whole sentence for screen readers.
 */
export function CameraReconnectLine({
  info,
  className,
  onDark = false,
  compact = false,
}: {
  info: CameraRestartInfo;
  className?: string;
  onDark?: boolean;
  compact?: boolean;
}) {
  const { t } = useT();
  const text = reconnectText(info, t);
  if (!text) return null;
  const reason = info.lastError ? `${t("camera_last_reason")}: ${info.lastError}` : null;
  const clock = compact ? formatRetryClockKst(info.nextRetryAt) : null;
  return (
    <span
      className={cn("inline-flex items-center gap-1", toneClass(onDark), className)}
      title={reason ? `${text}. ${reason}` : text}
      role="status"
      // The "already due" branch depends on the clock, which differs between
      // the server render and hydration by a few hundred milliseconds.
      suppressHydrationWarning
    >
      <RefreshCw className="w-3 h-3 shrink-0" aria-hidden />
      {/* The markup depends on `compact` only, never on the clock, so the
          server render and hydration agree even when the retry falls due
          in between (only the text differs, which is suppressed). */}
      {compact ? (
        <>
          <span aria-hidden className="truncate tabular-nums" suppressHydrationWarning>
            {clock ?? text}
          </span>
          <span className="sr-only" suppressHydrationWarning>
            {text}
          </span>
        </>
      ) : (
        <span className="truncate" suppressHydrationWarning>
          {text}
        </span>
      )}
      {reason && <span className="sr-only">. {reason}</span>}
    </span>
  );
}
