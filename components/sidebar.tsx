"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Crown, LogOut, X } from "lucide-react";
import { MongolzLogo } from "./logo";
import { useShell } from "./shell-context";
import { cn } from "@/lib/utils";
import { isActivePath, visibleNavGroups, type Role } from "@/lib/nav";
import type { Lang } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";

const COLLAPSE_STORAGE_KEY = "mongolz-sidebar-collapsed";

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

  const activeGroupId = useMemo(() => {
    for (const group of groups) {
      if (group.items.some((it) => isActivePath(pathname, it.href))) return group.id;
    }
    return null;
  }, [pathname, groups]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    try {
      const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        if (parsed && typeof parsed === "object") setCollapsed(parsed);
      }
    } catch {
      /* ignore corrupt state */
    }
  }, []);

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

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileNavOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNavOpen, setMobileNavOpen]);

  const roleLabel = isSuperAdmin
    ? "Super admin"
    : role === "admin"
    ? t("role_admin", lang)
    : role === "auditor"
    ? t("role_auditor", lang)
    : t("role_viewer", lang);

  const navContent = (
    <>
      <div className="px-5 h-14 flex items-center border-b border-border shrink-0">
        <Link href={"/dashboard" as never} className="flex items-center gap-2.5 group">
          <div className="relative">
            <div
              className="absolute inset-0 bg-accent/25 blur-md rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              aria-hidden
            />
            <MongolzLogo size={32} className="relative" />
          </div>
          <div className="leading-none">
            <div className="text-sm font-bold tracking-tight text-text">MONGOLZ</div>
            <div className="text-[10px] text-text-muted uppercase tracking-[0.18em] font-medium mt-1">
              Security
            </div>
          </div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4" aria-label="Main">
        {groups.map((group) => {
          // Pre-hydration always render open to avoid an SSR/CSR mismatch;
          // afterwards honour the stored toggle even for the active group.
          const userCollapsed = hydrated && collapsed[group.id] === true;
          const containsActive = group.id === activeGroupId;
          const open = !userCollapsed;
          const GroupIcon = group.icon;
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={open}
                aria-controls={`sidebar-group-${group.id}`}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1 text-2xs uppercase tracking-[0.14em] font-semibold transition-colors rounded-md",
                  containsActive ? "text-text" : "text-text-faint hover:text-text-soft",
                )}
              >
                <GroupIcon className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden />
                <span className="flex-1 text-left truncate">{t(group.labelKey, lang)}</span>
                {!open && containsActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-hidden />
                )}
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 shrink-0 transition-transform opacity-60",
                    open ? "" : "-rotate-90",
                  )}
                  aria-hidden
                />
              </button>
              <div id={`sidebar-group-${group.id}`} hidden={!open} className="mt-1 space-y-0.5">
                {group.items.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href as never}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 group",
                        active
                          ? "bg-accent/10 text-accent font-medium"
                          : "text-text-soft hover:bg-text-muted/[0.05] hover:text-text",
                      )}
                    >
                      {active && (
                        <span
                          className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent"
                          aria-hidden
                        />
                      )}
                      <Icon
                        className={cn(
                          "w-4 h-4 shrink-0 transition-transform group-hover:scale-110",
                          active ? "text-accent" : "text-text-muted group-hover:text-text-soft",
                        )}
                      />
                      <span className="truncate">{t(item.labelKey, lang)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-border shrink-0">
        <div className="flex items-center gap-2.5 rounded-xl bg-text-muted/[0.03] border border-border p-2.5">
          <div className="relative shrink-0">
            <div className="w-8 h-8 rounded-full bg-accent/15 text-accent border border-accent/20 inline-flex items-center justify-center text-xs font-semibold uppercase">
              {(email ?? "?").charAt(0)}
            </div>
            {isSuperAdmin && (
              <Crown
                className="absolute -top-1 -right-1 w-3 h-3 text-accent drop-shadow-[0_0_4px_rgba(0,212,255,0.6)]"
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
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger-soft transition-colors"
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
            className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
          />
          <aside
            className="md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] flex flex-col bg-surface border-r border-border-strong shadow-overlay animate-slide-in-left"
            aria-label="Navigation"
          >
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label={t("close_menu", lang)}
              className="absolute top-2.5 right-3 w-9 h-9 inline-flex items-center justify-center rounded-lg bg-text-muted/[0.04] hover:bg-text-muted/[0.08] transition z-10"
            >
              <X className="w-5 h-5" />
            </button>
            {navContent}
          </aside>
        </>
      )}

      {/* Desktop sidebar (≥768px) — sticky full-height; the inner <nav>
          scrolls on its own when the menu is taller than the viewport. */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-surface/50 backdrop-blur sticky top-0 self-start h-screen max-h-screen">
        {navContent}
      </aside>
    </>
  );
}
