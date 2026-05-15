import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  delta?: { value: number; positive?: boolean };
  className?: string;
}

export function StatCard({ label, value, icon: Icon, delta, className }: StatCardProps) {
  return (
    <div className={cn("card", className)}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
        {Icon && <Icon className="w-4 h-4 text-neutral-500" />}
      </div>
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      {delta && (
        <div
          className={cn(
            "text-xs mt-2",
            delta.positive === false ? "text-danger" : "text-success"
          )}
        >
          {delta.positive === false ? "▼" : "▲"} {Math.abs(delta.value)}
        </div>
      )}
    </div>
  );
}
