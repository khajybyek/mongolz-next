"use client";

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
  const tabs = mobileTabs(role);
  const moreActive = !tabs.some((tab) => isActivePath(pathname, tab.href));

  return (
    <nav
      aria-label={t("nav_more", lang)}
      className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-surface/95 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul
        className="grid h-16 px-1"
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
                  "h-full flex flex-col items-center justify-center gap-1 rounded-lg text-2xs font-medium transition-colors",
                  active ? "text-accent" : "text-text-muted hover:text-text",
                )}
              >
                <span
                  className={cn(
                    "inline-flex items-center justify-center w-11 h-7 rounded-lg transition-colors",
                    active && "bg-accent/10",
                  )}
                >
                  <Icon className="w-[18px] h-[18px]" aria-hidden />
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
            className={cn("w-full h-full flex flex-col items-center justify-center gap-1 rounded-lg text-2xs font-medium transition-colors", moreActive || mobileNavOpen ? "text-accent" : "text-text-muted hover:text-text")}
          >
            <span className={cn("inline-flex items-center justify-center w-11 h-7 rounded-lg", (moreActive || mobileNavOpen) && "bg-accent/10")}>
              <MoreHorizontal className="w-[18px] h-[18px]" aria-hidden />
            </span>
            <span className="truncate max-w-full px-1">{t("nav_more", lang)}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
