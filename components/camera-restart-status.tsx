"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { reconnectText, type CameraRestartInfo } from "@/lib/camera-restarts";

/**
 * "Restarted ×N" — how often the ML supervisor re-opened this capture, with
 * the last reason as a tooltip and as screen-reader text. Renders nothing
 * before the first restart.
 */
export function CameraRestartBadge({ info, className }: { info: CameraRestartInfo; className?: string }) {
  const { t } = useT();
  if (info.count <= 0) return null;
  const label = `${t("grid_restarted")} ×${info.count}`;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-warning", className)}
      title={info.lastError ? `${label}: ${info.lastError}` : label}
    >
      <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />
      {label}
      {info.lastError && <span className="sr-only">: {info.lastError}</span>}
    </span>
  );
}

/**
 * "Reconnecting — next try at HH:mm (KST)" for a camera in supervisor
 * backoff, with the last reason as a tooltip and screen-reader text.
 * Renders nothing for a running camera.
 */
export function CameraReconnectLine({ info, className }: { info: CameraRestartInfo; className?: string }) {
  const { t } = useT();
  const text = reconnectText(info, t);
  if (!text) return null;
  const reason = info.lastError ? `${t("camera_last_reason")}: ${info.lastError}` : null;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-warning", className)}
      title={reason ?? undefined}
      role="status"
      // The "already due" branch depends on the clock, which differs between
      // the server render and hydration by a few hundred milliseconds.
      suppressHydrationWarning
    >
      <RefreshCw className="w-3 h-3 shrink-0" aria-hidden />
      <span className="truncate" suppressHydrationWarning>
        {text}
      </span>
      {reason && <span className="sr-only">. {reason}</span>}
    </span>
  );
}
