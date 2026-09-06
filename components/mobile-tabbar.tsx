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
  const { setMobileNavOpen } = useShell();
  const tabs = mobileTabs(role);

  return (
    <nav
      aria-label={t("nav_more", lang)}
      className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-bg/85 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul
        className="grid h-14"
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
                  "h-full flex flex-col items-center justify-center gap-1 text-2xs font-medium transition-colors",
                  active ? "text-accent" : "text-text-muted hover:text-text",
                )}
              >
                <span
                  className={cn(
                    "inline-flex items-center justify-center w-9 h-6 rounded-full transition-colors",
                    active && "bg-accent/12",
                  )}
                >
                  <Icon className="w-[18px] h-[18px]" />
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
            className="w-full h-full flex flex-col items-center justify-center gap-1 text-2xs font-medium text-text-muted hover:text-text transition-colors"
          >
            <span className="inline-flex items-center justify-center w-9 h-6 rounded-full">
              <MoreHorizontal className="w-[18px] h-[18px]" />
            </span>
            <span className="truncate max-w-full px-1">{t("nav_more", lang)}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
