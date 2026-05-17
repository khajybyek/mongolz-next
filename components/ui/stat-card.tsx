import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  delta?: { value: number; positive?: boolean; label?: string };
  hint?: string;
  className?: string;
  accent?: "default" | "success" | "warning" | "danger" | "info";
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
}: StatCardProps) {
  return (
    <div
      className={cn(
        "card relative overflow-hidden group transition-all duration-200",
        "hover:border-border-strong hover:bg-surface-elevated",
        className
      )}
    >
      {/* Accent corner glow */}
      <div
        className="absolute -top-12 -right-12 w-32 h-32 rounded-full blur-2xl opacity-0 group-hover:opacity-30 transition-opacity duration-300 pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(0,212,255,0.5) 0%, transparent 70%)",
        }}
      />

      <div className="flex items-center justify-between mb-3">
        <span className="text-2xs uppercase tracking-wider text-text-muted font-medium">
          {label}
        </span>
        {Icon && (
          <div
            className={cn(
              "w-8 h-8 rounded-lg inline-flex items-center justify-center border",
              accentBg[accent]
            )}
          >
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>

      <div className="text-3xl font-bold tracking-tight text-text tabular-nums">{value}</div>

      <div className="flex items-center gap-2 mt-2">
        {delta && (
          <span
            className={cn(
              "text-xs font-medium inline-flex items-center gap-0.5",
              delta.positive === false ? "text-danger" : "text-success"
            )}
          >
            <span className="text-2xs">{delta.positive === false ? "▼" : "▲"}</span>
            {Math.abs(delta.value)}
            {delta.label && <span className="text-text-muted font-normal ml-1">{delta.label}</span>}
          </span>
        )}
        {hint && !delta && <span className="text-xs text-text-muted">{hint}</span>}
      </div>
    </div>
  );
}
