import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type CardVariant = "default" | "hover" | "elevated" | "glass" | "glow";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  as?: "div" | "section" | "article";
}

const variantClass: Record<CardVariant, string> = {
  default: "card",
  hover: "card-hover",
  elevated: "card-elevated",
  glass: "card-glass",
  glow: "card-glow",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "default", className, ...rest },
  ref
) {
  return <div ref={ref} className={cn(variantClass[variant], className)} {...rest} />;
});

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex items-start justify-between gap-3", className)} {...rest} />;
}

export function CardTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-base font-semibold tracking-tight text-text", className)}
      {...rest}
    />
  );
}

export function CardDescription({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-text-soft mt-1", className)} {...rest} />;
}

export function CardContent({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm text-text-soft", className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-4 pt-4 border-t border-border flex items-center justify-end gap-2", className)}
      {...rest}
    />
  );
}
