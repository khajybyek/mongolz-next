"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Crown, LogOut, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { MongolzLogo } from "./logo";
import { useShell } from "./shell-context";
import { cn } from "@/lib/utils";
import { useModalFocus } from "@/lib/use-modal-focus";
import { isActivePath, visibleNavGroups, type NavItem, type Role } from "@/lib/nav";
import type { Lang } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";

const GROUP_STORAGE_KEY = "mongolz-sidebar-groups-v2";
const COMPACT_STORAGE_KEY = "mongolz-sidebar-compact";
const DEFAULT_COLLAPSED: Record<string, boolean> = {
  monitoring: true, investigation: true, admin: true, ml: true, resources: true,
};

interface SidebarProps {
  lang: Lang;
  role: Role;
  email: string;
  isSuperAdmin?: boolean;
}

export function Sidebar({ lang, role, email, isSuperAdmin = false }: SidebarProps) {
  const pathname = usePathname();
  const { mobileNavOpen, setMobileNavOpen, setPaletteOpen } = useShell();
  const groups = useMemo(() => visibleNavGroups(role), [role]);
  const [collapsed, setCollapsed] = useState(DEFAULT_COLLAPSED);
  const [compact, setCompact] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const compactToggleRef = useRef<HTMLButtonElement>(null);
  const previousPathnameRef = useRef(pathname);
  useModalFocus({ open: mobileNavOpen, onClose: () => setMobileNavOpen(false), ref: drawerRef, initialFocusRef: closeRef });

  const activeGroupId = useMemo(() => groups.find((group) =>
    group.items.some((item) => isActivePath(pathname, item.href)))?.id, [pathname, groups]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(GROUP_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setCollapsed({ ...DEFAULT_COLLAPSED, ...Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "boolean")) });
      }
      setCompact(localStorage.getItem(COMPACT_STORAGE_KEY) === "true");
    } catch { /* Storage is optional; navigation still works without it. */ }
  }, []);

  useEffect(() => {
    if (activeGroupId) setCollapsed((previous) => ({ ...previous, [activeGroupId]: false }));
  }, [activeGroupId, pathname]);

  useEffect(() => {
    // Close the drawer after a real navigation. Running this unconditionally
    // on mount can race a fast tap on the More button and immediately undo it.
    if (previousPathnameRef.current !== pathname) {
      previousPathnameRef.current = pathname;
      setMobileNavOpen(false);
    }
  }, [pathname, setMobileNavOpen]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    function onResize() { if (desktop.matches) setMobileNavOpen(false); }
    desktop.addEventListener("change", onResize);
    return () => desktop.removeEventListener("change", onResize);
  }, [setMobileNavOpen]);

  function setCompactMode(next: boolean, focusToggle = true) {
    setCompact(next);
    try { localStorage.setItem(COMPACT_STORAGE_KEY, String(next)); } catch { /* optional preference */ }
    if (focusToggle) requestAnimationFrame(() => compactToggleRef.current?.focus());
  }

  function toggleGroup(id: string, rail: boolean) {
    if (rail) setCompactMode(false, false);
    setCollapsed((previous) => {
      const next = { ...previous, [id]: rail ? false : !previous[id] };
      try { localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(next)); } catch { /* optional preference */ }
      return next;
    });
  }

  const roleLabel = isSuperAdmin ? "Super admin" : t(role === "admin" ? "role_admin" : role === "auditor" ? "role_auditor" : "role_viewer", lang);

  function navLink(item: NavItem, rail: boolean, nested = false) {
    const active = isActivePath(pathname, item.href);
    const Icon = item.icon;
    const label = t(item.labelKey, lang);
    return (
      <li key={item.href}>
        <Link
          href={item.href as never}
          onClick={() => setMobileNavOpen(false)}
          aria-current={active ? "page" : undefined}
          aria-label={rail ? label : undefined}
          title={label}
          className={cn(
            "group relative flex min-h-11 items-center rounded-xl transition-colors duration-150 motion-reduce:transition-none",
            rail ? "justify-center px-2" : "gap-2.5 px-3",
            nested ? "text-[13px]" : "text-sm",
            active ? "bg-accent/10 font-semibold text-accent ring-1 ring-inset ring-accent/15" : "font-medium text-text-soft hover:bg-text-muted/[0.06] hover:text-text",
          )}
        >
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", active && "bg-accent/10")}>
            <Icon className={cn("shrink-0", nested ? "h-4 w-4" : "h-[18px] w-[18px]", !active && "text-text-muted group-hover:text-text-soft")} strokeWidth={active ? 2 : 1.7} aria-hidden />
          </span>
          {!rail && <span className="min-w-0 flex-1 truncate">{label}</span>}
          {active && !rail && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
        </Link>
      </li>
    );
  }

  const navContent = (surface: "mobile" | "desktop") => {
    const rail = surface === "desktop" && compact;
    return (
      <>
        <div className={cn("flex h-[76px] shrink-0 items-center", rail ? "justify-center px-3" : "justify-between pl-5 pr-3")}>
          <Link href={(role === "auditor" ? "/audit" : "/dashboard") as never} onClick={() => setMobileNavOpen(false)} className="flex min-h-11 items-center gap-3 rounded-xl" aria-label="MONGOLZ">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-bg shadow-sm"><MongolzLogo size={27} /></span>
            {!rail && <span className="min-w-0"><span className="block text-[13px] font-bold tracking-[0.12em] text-text">MONGOLZ</span><span className="mt-0.5 block text-[11px] text-text-muted">aicctv.dev</span></span>}
          </Link>
          {surface === "desktop" && !rail && (
            <button ref={compactToggleRef} type="button" onClick={() => setCompactMode(true)} title={t("nav_collapse_sidebar", lang)} aria-label={t("nav_collapse_sidebar", lang)} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-text-muted/[0.06] hover:text-text">
              <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />
            </button>
          )}
        </div>

        <div className="shrink-0 px-3 pb-4">
          <button type="button" onClick={() => setPaletteOpen(true)} aria-label={t("header_search_hint", lang)} title={t("header_search_hint", lang)} className={cn("flex min-h-11 w-full items-center rounded-xl border border-border bg-bg-secondary/70 text-sm text-text-muted transition-colors hover:border-border-strong hover:bg-bg-secondary hover:text-text", rail ? "justify-center" : "gap-2.5 px-3")}>
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            {!rail && <><span className="min-w-0 flex-1 truncate text-left">{t("header_search", lang)}</span><kbd className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-faint">⌘K</kbd></>}
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 pb-4 [scrollbar-width:thin]" aria-label={t("nav_navigation", lang)}>
          {groups.map((group) => {
            const primary = group.id === "workspace";
            const containsActive = group.id === activeGroupId;
            const open = primary || (!rail && !collapsed[group.id]);
            const GroupIcon = group.icon;
            return (
              <div key={group.id} className={cn(primary ? "pb-3" : "", !primary && group === groups.find((g) => g.id !== "workspace") && "border-t border-border pt-3")}>
                {primary ? (
                  !rail && <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-faint">{t(group.labelKey, lang)}</div>
                ) : (
                  <button type="button" onClick={() => toggleGroup(group.id, rail)} aria-expanded={open} aria-controls={`sidebar-${surface}-group-${group.id}`} title={t(group.labelKey, lang)} aria-label={rail ? t(group.labelKey, lang) : undefined}
                    className={cn("flex min-h-11 w-full items-center rounded-xl text-[13px] font-medium transition-colors hover:bg-text-muted/[0.06] hover:text-text", rail ? "justify-center px-2" : "gap-2.5 px-3", containsActive ? "text-accent" : "text-text-muted")}>
                    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", rail && containsActive && "bg-accent/10")}><GroupIcon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden /></span>
                    {!rail && <><span className="min-w-0 flex-1 truncate text-left">{t(group.labelKey, lang)}</span><ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-text-faint transition-transform motion-reduce:transition-none", !open && "-rotate-90")} aria-hidden /></>}
                  </button>
                )}
                <div id={`sidebar-${surface}-group-${group.id}`} hidden={!open}>
                  <ul className={cn("space-y-1", !primary && "ml-[25px] mt-1 border-l border-border pl-2")}>{group.items.map((item) => navLink(item, rail, !primary))}</ul>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-border p-3">
          {rail && <button ref={compactToggleRef} type="button" onClick={() => setCompactMode(false)} title={t("nav_expand_sidebar", lang)} aria-label={t("nav_expand_sidebar", lang)} className="mb-2 flex h-11 w-full items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-text-muted/[0.06] hover:text-text"><PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden /></button>}
          <div className={cn("flex rounded-xl border border-border bg-bg-secondary/60", rail ? "flex-col items-center gap-1 py-2" : "items-center gap-2.5 py-2 pl-2.5 pr-1")}>
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-xs font-semibold uppercase text-accent" title={`${email} · ${roleLabel}`}>
              {(email || "?").charAt(0)}
              {isSuperAdmin && <Crown className="absolute -right-1 -top-1 h-3 w-3 text-accent" aria-hidden />}
            </div>
            <div className={rail ? "sr-only" : "min-w-0 flex-1"}><div className="truncate text-xs font-semibold text-text" title={email}>{email}</div><div className="mt-0.5 truncate text-[11px] text-text-muted">{roleLabel}</div></div>
            <form action="/auth/logout" method="post" className="shrink-0"><button type="submit" className="flex h-11 w-11 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-danger-soft hover:text-danger" title={t("logout", lang)} aria-label={t("logout", lang)}><LogOut className="h-4 w-4" aria-hidden /></button></form>
          </div>
        </div>
      </>
    );
  };

  return (
    <>
      {mobileNavOpen && (
        <>
          <div data-modal-backdrop className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden animate-fade-in" onClick={() => setMobileNavOpen(false)} aria-hidden />
          <aside ref={drawerRef} id="mobile-navigation" role="dialog" aria-modal="true" tabIndex={-1} className="fixed inset-y-0 left-0 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col border-r border-border bg-surface shadow-overlay outline-none lg:hidden animate-slide-in-left pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]" aria-label={t("nav_navigation", lang)}>
            <button ref={closeRef} type="button" onClick={() => setMobileNavOpen(false)} aria-label={t("close_menu", lang)} className="absolute right-3 top-[calc(1rem+env(safe-area-inset-top,0px))] z-10 flex h-11 w-11 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-text-muted/[0.06] hover:text-text"><X className="h-5 w-5" aria-hidden /></button>
            {navContent("mobile")}
          </aside>
        </>
      )}
      <aside data-sidebar={compact ? "compact" : "expanded"} className={cn("sticky top-0 hidden h-screen h-dvh max-h-screen max-h-dvh shrink-0 self-start flex-col border-r border-border bg-surface lg:flex", compact ? "w-[76px]" : "w-[272px]")}>
        {navContent("desktop")}
      </aside>
    </>
  );
}
