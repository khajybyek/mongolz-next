"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { useShell } from "./shell-context";
import { cn } from "@/lib/utils";
import { isActivePath, mobileTabs, type Role } from "@/lib/nav";
import { t, type Lang } from "@/lib/i18n/translations";

/**
 * Bottom tab bar for phones: the four most-used destinations for the
 * current role plus a "More" button that opens the full navigation drawer.
 */
export function MobileTabbar({ role, lang }: { role: Role; lang: Lang }) {
  const pathname = usePathname();
  const { mobileNavOpen, setMobileNavOpen } = useShell();
  const [editing, setEditing] = useState(false);
  const tabs = mobileTabs(role);
  const moreActive = !tabs.some((tab) => isActivePath(pathname, tab.href));

  useEffect(() => {
    const isTextEntry = (node: Element | null) =>
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement ||
      (node instanceof HTMLInputElement &&
        !["button", "checkbox", "color", "file", "hidden", "radio", "range", "reset", "submit"].includes(node.type)) ||
      (node instanceof HTMLElement && node.isContentEditable);

    const sync = () => setEditing(isTextEntry(document.activeElement));
    // A focused input can be removed with its modal before Safari updates
    // `document.activeElement`, so clear immediately on focusout. A following
    // focusin will set the correct state when focus moves to another editor.
    const onFocusOut = () => setEditing(false);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <nav
      aria-label={t("nav_mobile_navigation", lang)}
      data-mobile-tabbar
      data-editing={editing ? "true" : "false"}
      className={cn(
        "lg:hidden fixed bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] left-[max(0.75rem,env(safe-area-inset-left,0px))] right-[max(0.75rem,env(safe-area-inset-right,0px))] z-30 rounded-2xl border border-border-strong bg-surface/95 shadow-[0_8px_32px_rgb(0_0_0/0.16)] backdrop-blur-xl transition-[transform,opacity] duration-200 motion-reduce:transition-none",
        editing && "translate-y-[calc(100%+4rem)] opacity-0 pointer-events-none",
      )}
    >
      <ul
        className="grid h-[68px] gap-1 p-1.5"
        style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => {
          const active = isActivePath(pathname, tab.href);
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="min-w-0">
              <Link
                href={tab.href as never}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "h-full flex flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium transition-colors",
                  active ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-text-muted/[0.05] hover:text-text",
                )}
                title={t(tab.labelKey, lang)}
              >
                <span
                  className={cn(
                    "inline-flex items-center justify-center w-11 h-6 rounded-lg transition-colors",
                  )}
                >
                  <Icon className="w-[19px] h-[19px]" strokeWidth={active ? 2.2 : 1.7} aria-hidden />
                </span>
                <span className="truncate max-w-full px-1">{t(tab.shortLabelKey ?? tab.labelKey, lang)}</span>
              </Link>
            </li>
          );
        })}
        <li className="min-w-0">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-expanded={mobileNavOpen}
            aria-controls={mobileNavOpen ? "mobile-navigation" : undefined}
            className={cn("w-full h-full flex flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium transition-colors", moreActive || mobileNavOpen ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-text-muted/[0.05] hover:text-text")}
          >
            <span className="inline-flex items-center justify-center w-11 h-6 rounded-lg">
              <MoreHorizontal className="w-[18px] h-[18px]" aria-hidden />
            </span>
            <span className="truncate max-w-full px-1">{t("nav_more", lang)}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
