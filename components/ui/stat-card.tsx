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
      <div className="flex items-start justify-between gap-2 mb-5">
        <span className="text-xs sm:text-sm leading-snug text-text-soft font-medium">{label}</span>
        {Icon && (
          <div className={cn("w-8 h-8 sm:w-9 sm:h-9 rounded-lg inline-flex items-center justify-center border shrink-0", accentBg[accent])}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>

      <div className="text-3xl lg:text-4xl font-semibold tracking-tight text-text tabular-nums">{value}</div>

      <div className="flex items-center gap-2 mt-3 min-h-[1rem]">
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
        {hint && !delta && <span className="text-xs leading-relaxed text-text-muted pr-4">{hint}</span>}
      </div>

      {href && (
        <ArrowUpRight
          className="absolute bottom-4 right-4 w-3.5 h-3.5 text-text-faint group-hover:text-accent transition-colors"
          aria-hidden
        />
      )}
    </>
  );

  const cls = cn(
    "card min-w-0 p-4 sm:p-5 relative overflow-hidden group transition-colors duration-200",
    href && "hover:border-accent/30 hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-accent/50",
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
