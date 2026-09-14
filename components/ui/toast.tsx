"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

export type ToastTone = "success" | "danger" | "warning" | "info";

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss. 0 keeps it until closed. */
  duration?: number;
}

interface ToastRecord extends ToastInput {
  id: number;
  tone: ToastTone;
}

interface ToastApi {
  toast: (input: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi>({
  toast: () => -1,
  dismiss: () => undefined,
});

const ICONS: Record<ToastTone, typeof Info> = {
  success: CheckCircle2,
  danger: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const TONE_CLASS: Record<ToastTone, { ring: string; icon: string }> = {
  success: { ring: "border-success/30", icon: "text-success" },
  danger: { ring: "border-danger/40", icon: "text-danger" },
  warning: { ring: "border-warning/40", icon: "text-warning" },
  info: { ring: "border-accent/30", icon: "text-accent" },
};

/**
 * App-wide toast notifications. Mount once in the shell; call
 * `useToast().toast({ title, tone })` from any client component. The stack
 * sits bottom-right (bottom-left of the tab bar on phones) so it never
 * collides with the realtime alert popups pinned to the top-right corner.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  // Mounted inside the app shell's <LangProvider>, so the hook resolves the
  // operator's chosen language rather than the "mn" fallback.
  const { t } = useT();
  const [items, setItems] = useState<ToastRecord[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = ++counter.current;
      const tone = input.tone ?? "info";
      const duration = input.duration ?? (tone === "danger" ? 8000 : 4500);
      setItems((prev) => [...prev.slice(-4), { ...input, id, tone }]);
      if (duration > 0) {
        timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="fixed z-50 flex flex-col gap-2 pointer-events-none right-[max(1rem,env(safe-area-inset-right,0px))] bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:bottom-4 w-[min(360px,calc(100vw-2rem))]"
      >
        {items.map((item) => {
          const Icon = ICONS[item.tone];
          const tone = TONE_CLASS[item.tone];
          return (
            <div
              key={item.id}
              role="status"
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface-elevated/95 backdrop-blur-xl shadow-overlay p-3.5 animate-slide-in-right",
                tone.ring,
              )}
            >
              <Icon className={cn("w-4.5 h-4.5 w-[18px] h-[18px] shrink-0 mt-0.5", tone.icon)} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text leading-snug">{item.title}</div>
                {item.description && (
                  <div className="text-xs text-text-soft mt-0.5 leading-relaxed">{item.description}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label={t("close")}
                className="shrink-0 -mr-1 -mt-1 w-7 h-7 inline-flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-text-muted/[0.08] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
