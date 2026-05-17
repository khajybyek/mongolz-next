import { type ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "info" | "success" | "warning" | "danger";

interface AlertProps {
  variant?: Variant;
  title?: ReactNode;
  children?: ReactNode;
  onClose?: () => void;
  icon?: LucideIcon | null;
  className?: string;
}

const variantClass: Record<Variant, string> = {
  info: "bg-info-soft text-info border-info/30",
  success: "bg-success-soft text-success border-success/30",
  warning: "bg-warning-soft text-warning border-warning/30",
  danger: "bg-danger-soft text-danger border-danger/30",
};

const defaultIcon: Record<Variant, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
};

export function Alert({
  variant = "info",
  title,
  children,
  onClose,
  icon,
  className,
}: AlertProps) {
  const Icon = icon === null ? null : icon ?? defaultIcon[variant];

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        variantClass[variant],
        className
      )}
    >
      {Icon && <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold mb-0.5">{title}</div>}
        {children && <div className="text-sm/relaxed opacity-90">{children}</div>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 -mr-1 -mt-0.5 p-1 rounded hover:bg-text-muted/10 transition"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
