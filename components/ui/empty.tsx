import { Inbox, type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

interface EmptyProps {
  message: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}

export function Empty({ message, description, icon: Icon = Inbox, action }: EmptyProps) {
  return (
    <div className="card flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-text-muted/[0.04] border border-border inline-flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-text-muted" />
      </div>
      <p className="text-sm font-medium text-text">{message}</p>
      {description && (
        <p className="text-xs text-text-soft mt-1.5 max-w-sm text-balance">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
