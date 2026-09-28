"use client";

import { Lock, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

/**
 * "Privacy mode" — the camera's capture is in private mode right now
 * (ADR 0012): no recognition, no alerts, no reveal of this footage. Masking
 * is on either way, so the badge never implies the picture is any less
 * protected in standard mode.
 *
 * `failClosed`: the ML service could not read the schedule, so recognition is
 * paused by an outage — not by a window (the schedule page may say
 * "Standard"). Shown in the warning colour with its own explanation.
 *
 * The explanation is reachable without hover: the badge is focusable (its
 * `title` + `aria-describedby`), it opts back into pointer events inside the
 * `pointer-events-none` tile overlays, and /grid and /wall render
 * `PrivacyModeLegend` under the tiles whenever a badge is shown.
 */
export function PrivacyModeBadge({ className, failClosed = false }: { className?: string; failClosed?: boolean }) {
  const { t } = useT();
  const title = failClosed ? t("privacy_mode_badge_fail_closed_title") : t("privacy_mode_badge_title");
  const Icon = failClosed ? ShieldAlert : Lock;
  return (
    <span
      tabIndex={0}
      className={cn(
        "pointer-events-auto inline-flex items-center gap-1 rounded-md text-[10px] font-semibold px-1.5 py-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
        failClosed ? "bg-warning/15 text-warning" : "bg-accent/15 text-accent",
        className,
      )}
      title={title}
    >
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      {failClosed ? t("privacy_mode_badge_fail_closed") : t("privacy_mode_badge")}
      <span className="sr-only">: {title}</span>
    </span>
  );
}

/**
 * One-line, always-visible explanation for pages that show the badge on video
 * tiles (touch screens have no hover).
 */
export function PrivacyModeLegend({ failClosed = false, className }: { failClosed?: boolean; className?: string }) {
  const { t } = useT();
  return (
    <p className={cn("flex items-start gap-1.5 text-[11px] text-text-muted leading-relaxed", className)}>
      <Lock className="w-3 h-3 mt-0.5 shrink-0 text-accent" aria-hidden />
      <span>
        {t("privacy_mode_legend")}
        {failClosed && <> {t("privacy_mode_legend_fail_closed")}</>}
      </span>
    </p>
  );
}
