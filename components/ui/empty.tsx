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
      <div className={cn(
        "mb-4 rounded-2xl bg-bg-secondary border border-border inline-flex items-center justify-center",
        compact ? "w-12 h-12" : "w-14 h-14",
      )}>
        <Icon className={cn("text-text-muted", compact ? "w-5 h-5" : "w-6 h-6")} aria-hidden />
      </div>
      <p className="relative text-sm font-medium text-text">{message}</p>
      {description && (
        <p className="relative text-sm leading-relaxed text-text-muted mt-2 max-w-sm text-pretty">{description}</p>
      )}
      {action && <div className="relative mt-5">{action}</div>}
    </div>
  );
}
