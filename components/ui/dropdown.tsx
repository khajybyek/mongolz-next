"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

interface DropdownProps {
  /** Content of the trigger button. */
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  ariaLabel: string;
  triggerClassName?: string;
  panelClassName?: string;
}

/**
 * Minimal accessible dropdown: click / Enter opens, ESC and outside-click
 * close, arrow keys move between items. Items call `close()` through the
 * `data-dropdown-close` attribute so any child element can dismiss it.
 */
export function Dropdown({
  trigger,
  children,
  align = "end",
  ariaLabel,
  triggerClassName,
  panelClassName,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = rootRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']");
      if (!items || items.length === 0) return;
      e.preventDefault();
      const list = Array.from(items);
      const idx = list.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === "ArrowDown"
          ? list[(idx + 1) % list.length]
          : list[(idx - 1 + list.length) % list.length];
      next?.focus();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((p) => !p)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          role="menu"
          onClick={(e) => {
            const el = (e.target as HTMLElement).closest("[data-dropdown-close]");
            if (el) close();
          }}
          className={cn(
            "absolute top-full mt-2 z-40 min-w-[13rem] rounded-xl border border-border-strong bg-surface-elevated shadow-overlay p-1.5 animate-scale-in origin-top",
            align === "end" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface DropdownItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  active?: boolean;
  tone?: "default" | "danger";
}

export function DropdownItem({
  icon,
  active,
  tone = "default",
  className,
  children,
  ...rest
}: DropdownItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      data-dropdown-close
      className={cn(
        "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-left transition-colors",
        tone === "danger"
          ? "text-danger hover:bg-danger-soft"
          : active
          ? "bg-accent/10 text-accent"
          : "text-text-soft hover:bg-text-muted/[0.06] hover:text-text",
        className,
      )}
      {...rest}
    >
      {icon && <span className="w-4 h-4 inline-flex items-center justify-center shrink-0 opacity-80">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {active && <span className="w-1.5 h-1.5 rounded-full bg-accent" aria-hidden />}
    </button>
  );
}

export function DropdownSeparator() {
  return <div role="separator" className="my-1.5 border-t border-border" />;
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pt-1.5 pb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-text-faint">
      {children}
    </div>
  );
}
