import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  delta?: { value: number; positive?: boolean; label?: string };
  hint?: string;
  className?: string;
  accent?: "default" | "success" | "warning" | "danger" | "info";
  /** When set the whole card becomes a link (shows a corner arrow on hover). */
  href?: string;
}

const accentBg: Record<NonNullable<StatCardProps["accent"]>, string> = {
  default: "bg-accent/10 text-accent border-accent/20",
  success: "bg-success-soft text-success border-success/20",
  warning: "bg-warning-soft text-warning border-warning/20",
  danger: "bg-danger-soft text-danger border-danger/20",
  info: "bg-info-soft text-info border-info/20",
};

const accentGlow: Record<NonNullable<StatCardProps["accent"]>, string> = {
  default: "rgba(0,212,255,0.5)",
  success: "rgba(34,197,94,0.45)",
  warning: "rgba(245,158,11,0.45)",
  danger: "rgba(244,63,94,0.45)",
  info: "rgba(59,130,246,0.45)",
};

export function StatCard({
  label,
  value,
  icon: Icon,
  delta,
  hint,
  className,
  accent = "default",
  href,
}: StatCardProps) {
  const body = (
    <>
      {/* Accent corner glow */}
      <div
        className="absolute -top-12 -right-12 w-32 h-32 rounded-full blur-2xl opacity-0 group-hover:opacity-40 transition-opacity duration-300 pointer-events-none"
        style={{ background: `radial-gradient(circle, ${accentGlow[accent]} 0%, transparent 70%)` }}
        aria-hidden
      />

      <div className="flex items-center justify-between mb-3">
        <span className="text-2xs uppercase tracking-wider text-text-muted font-medium truncate">{label}</span>
        {Icon && (
          <div className={cn("w-8 h-8 rounded-lg inline-flex items-center justify-center border shrink-0", accentBg[accent])}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>

      <div className="text-2xl md:text-3xl font-bold tracking-tight text-text tabular-nums">{value}</div>

      <div className="flex items-center gap-2 mt-2 min-h-[1rem]">
        {delta && (
          <span
            className={cn(
              "text-xs font-medium inline-flex items-center gap-0.5",
              delta.positive === false ? "text-danger" : "text-success",
            )}
          >
            <span className="text-2xs">{delta.positive === false ? "▼" : "▲"}</span>
            {Math.abs(delta.value)}
            {delta.label && <span className="text-text-muted font-normal ml-1">{delta.label}</span>}
          </span>
        )}
        {hint && !delta && <span className="text-xs text-text-muted truncate">{hint}</span>}
      </div>

      {href && (
        <ArrowUpRight
          className="absolute bottom-4 right-4 w-4 h-4 text-text-faint opacity-0 -translate-x-1 translate-y-1 group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 transition-all"
          aria-hidden
        />
      )}
    </>
  );

  const cls = cn(
    "card relative overflow-hidden group transition-all duration-200",
    "hover:border-border-strong hover:bg-surface-elevated",
    href && "hover-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
    className,
  );

  if (href) {
    return (
      <Link href={href as never} className={cls} aria-label={`${label}: ${value}`}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}
