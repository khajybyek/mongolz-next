"use client";

import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useModalFocus } from "@/lib/use-modal-focus";
import { useT } from "@/lib/i18n/client";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  closeOnBackdrop?: boolean;
}

const sizeMap: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  const { t } = useT();
  useModalFocus({ open, onClose, ref: panelRef });

  if (!open) return null;
  if (typeof window === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 pt-[env(safe-area-inset-top,0px)] sm:p-4 sm:pt-[max(1rem,env(safe-area-inset-top,0px))] animate-fade-in"
    >
      <div
        className="backdrop"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? headingId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          // z-10 keeps the panel painted above .backdrop even if a
          // future commit accidentally re-adds z-index to the backdrop.
          // Phones get a bottom sheet (slides up, rounded top corners,
          // scrolls inside); larger screens keep the centred card.
          "relative z-10 w-full bg-surface-elevated border border-border-strong shadow-overlay",
          "max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-2xl animate-slide-up pb-[env(safe-area-inset-bottom)]",
          "sm:max-h-[85vh] sm:rounded-2xl sm:animate-scale-in",
          sizeMap[size]
        )}
      >
        <div className="sm:hidden flex justify-center pt-2.5" aria-hidden>
          <span className="w-10 h-1 rounded-full bg-text-muted/30" />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="absolute top-3 right-3 w-11 h-11 inline-flex items-center justify-center rounded-lg bg-text-muted/[0.04] hover:bg-text-muted/[0.08] text-text-soft hover:text-text transition"
        >
          <X className="w-4 h-4" />
        </button>
        {(title || description) && (
          <div className="px-6 pt-6 pb-4 border-b border-border">
            {title && <h3 id={headingId} className="text-lg font-semibold tracking-tight pr-10">{title}</h3>}
            {description && <p id={descriptionId} className="text-sm text-text-soft mt-1 pr-8">{description}</p>}
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="px-6 py-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface/50">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
