import { cn } from "@/lib/utils";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
}

const sizeMap: Record<NonNullable<SpinnerProps["size"]>, string> = {
  sm: "w-3 h-3 border",
  md: "w-4 h-4 border-2",
  lg: "w-6 h-6 border-2",
};

export function Spinner({ size = "md", className, label = "Loading" }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-block rounded-full border-current border-b-transparent animate-[spin_0.8s_linear_infinite]",
        sizeMap[size],
        className
      )}
    />
  );
}
