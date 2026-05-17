import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "accent" | "success" | "warning" | "danger" | "info" | "muted";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
  dot?: boolean;
}

const variantClass: Record<Variant, string> = {
  accent: "badge-accent",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  info: "badge-info",
  muted: "badge-muted",
};

const dotClass: Record<Variant, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  muted: "bg-text-muted",
};

export function Badge({ variant = "muted", dot, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cn(variantClass[variant], className)} {...rest}>
      {dot && <span className={cn("badge-dot", dotClass[variant])} />}
      {children}
    </span>
  );
}
