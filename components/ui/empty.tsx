import { Inbox, type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyProps {
  message: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  /** `compact` fits inside cards / table wrappers. */
  size?: "default" | "compact";
  className?: string;
}

export function Empty({
  message,
  description,
  icon: Icon = Inbox,
  action,
  size = "default",
  className,
}: EmptyProps) {
  const compact = size === "compact";
  return (
    <div
      className={cn(
        "card flex flex-col items-center justify-center text-center relative overflow-hidden",
        compact ? "py-10 px-5" : "py-16 px-6",
        className,
      )}
    >
      {/* Soft halo behind the icon */}
      <div
        className="absolute inset-x-0 top-0 h-40 pointer-events-none opacity-60"
        style={{
          background: "radial-gradient(ellipse 50% 70% at 50% 0%, rgb(var(--accent) / 0.10) 0%, transparent 70%)",
        }}
        aria-hidden
      />
      <div className="relative mb-4">
        <div className="absolute inset-0 rounded-3xl bg-accent/10 blur-xl scale-125" aria-hidden />
        <div
          className={cn(
            "relative rounded-2xl bg-surface-elevated border border-border inline-flex items-center justify-center shadow-soft",
            compact ? "w-12 h-12" : "w-14 h-14",
          )}
        >
          <Icon className={cn("text-text-muted", compact ? "w-5 h-5" : "w-6 h-6")} />
        </div>
      </div>
      <p className="relative text-sm font-medium text-text">{message}</p>
      {description && (
        <p className="relative text-xs text-text-soft mt-1.5 max-w-sm text-pretty">{description}</p>
      )}
      {action && <div className="relative mt-5">{action}</div>}
    </div>
  );
}
