"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Crown, LogOut, X } from "lucide-react";
import { MongolzLogo } from "./logo";
import { useShell } from "./shell-context";
import { cn } from "@/lib/utils";
import { useModalFocus } from "@/lib/use-modal-focus";
import { isActivePath, visibleNavGroups, type Role } from "@/lib/nav";
import type { Lang } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";

const COLLAPSE_STORAGE_KEY = "mongolz-sidebar-collapsed";
const DEFAULT_COLLAPSED: Record<string, boolean> = {
  search: true, analytics: true, admin: true, ml: true, other: true,
};

interface SidebarProps {
  lang: Lang;
  role: Role;
  email: string;
  isSuperAdmin?: boolean;
}

export function Sidebar({ lang, role, email, isSuperAdmin = false }: SidebarProps) {
  const pathname = usePathname();
  const { mobileNavOpen, setMobileNavOpen } = useShell();
  const groups = useMemo(() => visibleNavGroups(role), [role]);
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalFocus({ open: mobileNavOpen, onClose: () => setMobileNavOpen(false), ref: drawerRef, initialFocusRef: closeRef });

  const activeGroupId = useMemo(() => {
    for (const group of groups) {
      if (group.items.some((it) => isActivePath(pathname, it.href))) return group.id;
    }
    return null;
  }, [pathname, groups]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(DEFAULT_COLLAPSED);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setCollapsed({ ...DEFAULT_COLLAPSED, ...Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "boolean")) });
        }
      }
    } catch {
      /* ignore corrupt state */
    }
  }, []);

  useEffect(() => {
    if (activeGroupId) setCollapsed((previous) => ({ ...previous, [activeGroupId]: false }));
  }, [activeGroupId]);

  function toggleGroup(id: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* quota exceeded — ignore */
      }
      return next;
    });
  }

  // Close the drawer after navigating on a phone.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    function onResize() {
      if (desktop.matches) setMobileNavOpen(false);
    }
    desktop.addEventListener("change", onResize);
    return () => desktop.removeEventListener("change", onResize);
  }, [setMobileNavOpen]);

  const roleLabel = isSuperAdmin
    ? "Super admin"
    : role === "admin"
    ? t("role_admin", lang)
    : role === "auditor"
    ? t("role_auditor", lang)
    : t("role_viewer", lang);

  const navContent = (surface: "mobile" | "desktop") => (
    <>
      <div className="px-5 h-16 flex items-center border-b border-border shrink-0">
        <Link href={(role === "auditor" ? "/audit" : "/dashboard") as never} onClick={() => setMobileNavOpen(false)} className="flex min-h-11 items-center gap-3 rounded-lg">
          <MongolzLogo size={34} />
          <div className="leading-none">
            <div className="text-sm font-bold tracking-[0.08em] text-text">MONGOLZ</div>
            <div className="text-[10px] text-text-muted uppercase tracking-[0.2em] font-medium mt-1.5">
              Security
            </div>
          </div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-1" aria-label={t("open_menu", lang)}>
        {groups.map((group) => {
          const userCollapsed = collapsed[group.id] === true;
          const containsActive = group.id === activeGroupId;
          const open = !userCollapsed;
          const GroupIcon = group.icon;
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={open}
                aria-controls={`sidebar-${surface}-group-${group.id}`}
                className={cn(
                  "w-full min-h-11 flex items-center gap-2.5 px-3 py-2 text-2xs uppercase tracking-[0.1em] font-semibold transition-colors rounded-lg hover:bg-text-muted/[0.05]",
                  containsActive ? "text-text-soft" : "text-text-muted hover:text-text",
                )}
              >
                <GroupIcon className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden />
                <span className="flex-1 text-left truncate">{t(group.labelKey, lang)}</span>
                {!open && containsActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-hidden />
                )}
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 shrink-0 transition-transform opacity-60 motion-reduce:transition-none",
                    open ? "" : "-rotate-90",
                  )}
                  aria-hidden
                />
              </button>
              <div id={`sidebar-${surface}-group-${group.id}`} hidden={!open && !containsActive} className="space-y-0.5 pb-1">
                {group.items.filter((item) => open || isActivePath(pathname, item.href)).map((item) => {
                  const active = isActivePath(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href as never}
                      onClick={() => setMobileNavOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex min-h-11 items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 group",
                        active
                          ? "bg-accent/[0.11] text-accent font-semibold shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.14)]"
                          : "text-text-soft hover:bg-text-muted/[0.05] hover:text-text",
                      )}
                    >
                      {active && (
                        <span
                          className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-accent"
                          aria-hidden
                        />
                      )}
                      <Icon
                        className={cn(
                          "w-[18px] h-[18px] shrink-0",
                          active ? "text-accent" : "text-text-muted group-hover:text-text-soft",
                        )}
                      />
                      <span className="truncate" title={t(item.labelKey, lang)}>{t(item.labelKey, lang)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-border shrink-0">
        <div className="flex items-center gap-2.5 rounded-xl bg-text-muted/[0.03] p-2">
          <div className="relative shrink-0">
            <div className="w-8 h-8 rounded-full bg-accent/15 text-accent border border-accent/20 inline-flex items-center justify-center text-xs font-semibold uppercase">
              {(email ?? "?").charAt(0)}
            </div>
            {isSuperAdmin && (
              <Crown
                className="absolute -top-1 -right-1 w-3 h-3 text-accent"
                aria-label="Super admin"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-text truncate">{email}</div>
            <div
              className={cn(
                "text-2xs mt-0.5 truncate",
                isSuperAdmin || role === "admin"
                  ? "text-accent"
                  : role === "auditor"
                  ? "text-warning"
                  : "text-text-muted",
              )}
            >
              {roleLabel}
            </div>
          </div>
          <form action="/auth/logout" method="post" className="shrink-0">
            <button
              type="submit"
              className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger-soft transition-colors"
              title={t("logout", lang)}
              aria-label={t("logout", lang)}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile drawer (overlay + slide-in panel) */}
      {mobileNavOpen && (
        <>
          <div
            data-modal-backdrop
            className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
          />
          <aside
            ref={drawerRef}
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            className="md:hidden fixed inset-y-0 left-0 z-50 w-80 max-w-[calc(100vw-2rem)] flex flex-col bg-surface border-r border-border-strong shadow-overlay animate-slide-in-left outline-none"
            aria-label={t("open_menu", lang)}
          >
            <button
              ref={closeRef}
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label={t("close_menu", lang)}
              className="absolute top-2.5 right-3 w-11 h-11 inline-flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-text-muted/[0.08] transition-colors z-10"
            >
              <X className="w-5 h-5" />
            </button>
            {navContent("mobile")}
          </aside>
        </>
      )}

      {/* Desktop sidebar (≥768px) — sticky full-height; the inner <nav>
          scrolls on its own when the menu is taller than the viewport. */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-surface sticky top-0 self-start h-dvh max-h-dvh">
        {navContent("desktop")}
      </aside>
    </>
  );
}
