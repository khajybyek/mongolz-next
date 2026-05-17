"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Video,
  Search,
  UserSearch,
  Users,
  Bell,
  BarChart3,
  Sparkles,
  ScrollText,
  Cctv,
  PlayCircle,
  Settings,
  Menu,
  X,
  BookOpen,
  UserCog,
  BellRing,
  Webhook,
  GraduationCap,
  Gauge,
  ShieldCheck,
  CalendarClock,
  Database,
  Archive,
  Crown,
  Footprints,
  Flame,
  Activity,
  Lock,
  TrendingUp,
  ChevronDown,
  Home,
  ScanFace,
  Wrench,
  FlaskConical,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { MongolzLogo } from "./logo";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeToggle } from "./theme-toggle";
import type { Lang } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";

type NavItem = {
  href: string;
  icon: LucideIcon;
  labelKey: Parameters<typeof t>[0];
  adminOnly?: boolean;
  auditorAllowed?: boolean;
};

type NavGroup = {
  id: string;
  labelKey: Parameters<typeof t>[0];
  icon: LucideIcon;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    labelKey: "nav_group_overview",
    icon: Home,
    items: [
      { href: "/dashboard", icon: LayoutDashboard, labelKey: "nav_dashboard" },
      { href: "/compare", icon: Sparkles, labelKey: "nav_compare", adminOnly: true },
    ],
  },
  {
    id: "live",
    labelKey: "nav_group_live",
    icon: Video,
    items: [
      { href: "/live", icon: Video, labelKey: "nav_live" },
      { href: "/live-rtc", icon: Video, labelKey: "nav_live_rtc", adminOnly: true },
      { href: "/playback", icon: PlayCircle, labelKey: "nav_playback" },
    ],
  },
  {
    id: "search",
    labelKey: "nav_group_search",
    icon: ScanFace,
    items: [
      { href: "/search", icon: Search, labelKey: "nav_search" },
      { href: "/suspects", icon: UserSearch, labelKey: "nav_suspects", adminOnly: true },
      { href: "/alerts", icon: Bell, labelKey: "nav_alerts", adminOnly: true },
      { href: "/alerts-live", icon: Bell, labelKey: "nav_alerts_live", adminOnly: true },
      { href: "/alert-rules", icon: BellRing, labelKey: "nav_alert_rules", adminOnly: true },
    ],
  },
  {
    id: "analytics",
    labelKey: "nav_group_analytics",
    icon: BarChart3,
    items: [
      { href: "/analytics", icon: BarChart3, labelKey: "nav_analytics" },
      { href: "/ai", icon: Sparkles, labelKey: "nav_ai", adminOnly: true },
      { href: "/faces", icon: Users, labelKey: "nav_faces", adminOnly: true },
    ],
  },
  {
    id: "admin",
    labelKey: "nav_group_admin",
    icon: Wrench,
    items: [
      { href: "/cameras", icon: Cctv, labelKey: "nav_cameras", adminOnly: true },
      { href: "/audit", icon: ScrollText, labelKey: "nav_audit", adminOnly: true, auditorAllowed: true },
      { href: "/users", icon: UserCog, labelKey: "nav_users", adminOnly: true },
      { href: "/webhooks", icon: Webhook, labelKey: "nav_webhooks", adminOnly: true },
      { href: "/reveal-approvals", icon: ShieldCheck, labelKey: "nav_reveal_approvals", adminOnly: true },
      { href: "/retention", icon: CalendarClock, labelKey: "nav_retention", adminOnly: true },
      { href: "/privacy-zones", icon: Lock, labelKey: "nav_zones", adminOnly: true },
    ],
  },
  {
    id: "ml",
    labelKey: "nav_group_ml",
    icon: FlaskConical,
    items: [
      { href: "/active-learning", icon: GraduationCap, labelKey: "nav_active_learning", adminOnly: true },
      { href: "/reid", icon: Footprints, labelKey: "nav_reid", adminOnly: true },
      { href: "/heatmap", icon: Flame, labelKey: "nav_heatmap", adminOnly: true },
      { href: "/perf-budget", icon: Activity, labelKey: "nav_perf", adminOnly: true },
      { href: "/anomaly", icon: TrendingUp, labelKey: "nav_anomaly", adminOnly: true },
      { href: "/ml-lab", icon: Sparkles, labelKey: "nav_ml_lab", adminOnly: true },
      { href: "/benchmarks", icon: Gauge, labelKey: "nav_benchmarks", adminOnly: true },
      { href: "/db-monitor", icon: Database, labelKey: "nav_db_monitor", adminOnly: true },
    ],
  },
  {
    id: "other",
    labelKey: "nav_group_other",
    icon: MoreHorizontal,
    items: [
      { href: "/backup", icon: Archive, labelKey: "nav_backup", adminOnly: true },
      { href: "/docs", icon: BookOpen, labelKey: "nav_docs", adminOnly: true },
      { href: "/settings", icon: Settings, labelKey: "nav_settings", adminOnly: true },
    ],
  },
];

const COLLAPSE_STORAGE_KEY = "mongolz-sidebar-collapsed";

interface SidebarProps {
  lang: Lang;
  role: "admin" | "viewer" | "auditor";
  email: string;
  isSuperAdmin?: boolean;
}

function isItemVisible(item: NavItem, role: SidebarProps["role"]): boolean {
  if (role === "admin") return true;
  if (role === "auditor") return item.auditorAllowed === true;
  return !item.adminOnly;
}

export function Sidebar({ lang, role, email, isSuperAdmin = false }: SidebarProps) {
  const pathname = usePathname();
  const visibleGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((i) => isItemVisible(i, role)),
      })).filter((group) => group.items.length > 0),
    [role],
  );

  const activeGroupId = useMemo(() => {
    for (const group of visibleGroups) {
      const hit = group.items.find(
        (it) => pathname === it.href || pathname.startsWith(it.href + "/"),
      );
      if (hit) return group.id;
    }
    return null;
  }, [pathname, visibleGroups]);

  const [mobileOpen, setMobileOpen] = useState(false);
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

  // Pathname өөрчлөгдөхөд drawer-ыг хаах (mobile дээр link дарсны дараа)
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Drawer нээлттэй үед body scroll lock
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const navContent = (
    <>
      <div className="px-5 py-5 border-b border-border">
        <Link href="/dashboard" className="flex items-center gap-2.5 group">
          <div className="relative">
            <div className="absolute inset-0 bg-accent/20 blur-md rounded-full opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
            <MongolzLogo size={36} className="relative" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-text">MONGOLZ</div>
            <div className="text-[10px] text-text-muted uppercase tracking-[0.18em] font-medium">
              Security
            </div>
          </div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {visibleGroups.map((group) => {
          // Default to open. Pre-hydration we always render open to avoid an
          // SSR/CSR mismatch; once hydrated we honour the user's localStorage
          // toggle even for the group containing the active route (otherwise
          // clicking the chevron looks broken).
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
                  containsActive
                    ? "text-text"
                    : "text-text-faint hover:text-text-soft",
                )}
              >
                <GroupIcon className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden />
                <span className="flex-1 text-left truncate">{t(group.labelKey, lang)}</span>
                {!open && containsActive && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
                    aria-label="contains active route"
                  />
                )}
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 shrink-0 transition-transform opacity-60",
                    open ? "" : "-rotate-90",
                  )}
                  aria-hidden
                />
              </button>
              <div
                id={`sidebar-group-${group.id}`}
                hidden={!open}
                className="mt-1 space-y-0.5"
              >
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href as never}
                      className={cn(
                        "relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 group",
                        active
                          ? "bg-accent/10 text-accent font-medium"
                          : "text-text-soft hover:bg-text-muted/[0.04] hover:text-text",
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
                          "w-4 h-4 shrink-0 transition-transform",
                          active ? "text-accent" : "text-text-muted group-hover:text-text-soft",
                          "group-hover:scale-110",
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

      <div className="px-4 py-4 border-t border-border space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <LanguageSwitcher current={lang} />
          </div>
          <ThemeToggle />
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg bg-text-muted/[0.02] border border-border p-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="relative shrink-0">
                <div className="w-7 h-7 rounded-full bg-accent/15 text-accent border border-accent/20 inline-flex items-center justify-center text-2xs font-semibold uppercase">
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
                <div className="text-2xs font-medium text-text truncate">{email}</div>
                <span
                  className={cn(
                    "badge mt-0.5",
                    isSuperAdmin
                      ? "badge-accent"
                      : role === "admin"
                      ? "badge-accent"
                      : role === "auditor"
                      ? "badge-warning"
                      : "badge-muted"
                  )}
                >
                  <span
                    className={cn(
                      "badge-dot",
                      isSuperAdmin || role === "admin"
                        ? "bg-accent"
                        : role === "auditor"
                        ? "bg-warning"
                        : "bg-text-muted"
                    )}
                  />
                  {isSuperAdmin
                    ? "Super admin"
                    : role === "admin"
                    ? t("role_admin", lang)
                    : role === "auditor"
                    ? t("role_auditor", lang)
                    : t("role_viewer", lang)}
                </span>
              </div>
            </div>
          </div>
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="text-xs text-text-muted hover:text-danger transition px-1.5 py-1 rounded hover:bg-text-muted/[0.04]"
              title={t("logout", lang)}
            >
              {t("logout", lang)}
            </button>
          </form>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile-only top bar — hamburger toggle */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-bg/80 backdrop-blur-md border-b border-border">
        <Link href="/dashboard" className="flex items-center gap-2">
          <MongolzLogo size={28} />
          <span className="text-sm font-bold tracking-tight">MONGOLZ</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={t("open_menu", lang)}
          className="w-10 h-10 inline-flex items-center justify-center rounded-lg bg-text-muted/[0.04] hover:bg-text-muted/[0.08] transition"
        >
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* Mobile drawer (overlay + slide-in panel) */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-md animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] flex flex-col bg-surface border-r border-border-strong shadow-overlay animate-slide-in-left">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label={t("close_menu", lang)}
              className="absolute top-3 right-3 w-9 h-9 inline-flex items-center justify-center rounded-lg bg-text-muted/[0.04] hover:bg-text-muted/[0.08] transition z-10"
            >
              <X className="w-5 h-5" />
            </button>
            {navContent}
          </aside>
        </>
      )}

      {/* Desktop sidebar (≥768px) */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-surface/50 backdrop-blur">
        {navContent}
      </aside>
    </>
  );
}
