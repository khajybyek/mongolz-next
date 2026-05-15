"use client";

import { useEffect, useState } from "react";
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
  type LucideIcon,
} from "lucide-react";
import { MongolzLogo } from "./logo";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "./language-switcher";
import type { Lang } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";

type NavItem = {
  href: string;
  icon: LucideIcon;
  labelKey: Parameters<typeof t>[0];
  adminOnly?: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, labelKey: "nav_dashboard" },
  { href: "/live", icon: Video, labelKey: "nav_live" },
  { href: "/playback", icon: PlayCircle, labelKey: "nav_playback" },
  { href: "/search", icon: Search, labelKey: "nav_search" },
  { href: "/suspects", icon: UserSearch, labelKey: "nav_suspects", adminOnly: true },
  { href: "/alerts", icon: Bell, labelKey: "nav_alerts", adminOnly: true },
  { href: "/alert-rules", icon: BellRing, labelKey: "nav_alert_rules", adminOnly: true },
  { href: "/analytics", icon: BarChart3, labelKey: "nav_analytics" },
  { href: "/ai", icon: Sparkles, labelKey: "nav_ai", adminOnly: true },
  { href: "/faces", icon: Users, labelKey: "nav_faces", adminOnly: true },
  { href: "/cameras", icon: Cctv, labelKey: "nav_cameras", adminOnly: true },
  { href: "/audit", icon: ScrollText, labelKey: "nav_audit", adminOnly: true },
  { href: "/users", icon: UserCog, labelKey: "nav_users", adminOnly: true },
  { href: "/webhooks", icon: Webhook, labelKey: "nav_webhooks", adminOnly: true },
  { href: "/active-learning", icon: GraduationCap, labelKey: "nav_active_learning", adminOnly: true },
  { href: "/benchmarks", icon: Gauge, labelKey: "nav_benchmarks", adminOnly: true },
  { href: "/docs", icon: BookOpen, labelKey: "nav_docs", adminOnly: true },
  { href: "/settings", icon: Settings, labelKey: "nav_settings" },
];

interface SidebarProps {
  lang: Lang;
  role: "admin" | "viewer";
  email: string;
}

export function Sidebar({ lang, role, email }: SidebarProps) {
  const pathname = usePathname();
  const items = NAV.filter((n) => !n.adminOnly || role === "admin");
  const [mobileOpen, setMobileOpen] = useState(false);

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
      <div className="px-5 py-5 border-b border-white/5">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <MongolzLogo size={56} />
          <div>
            <div className="text-sm font-bold tracking-tight">MONGOLZ</div>
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Security</div>
          </div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href as never}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-neutral-300 hover:bg-white/5 hover:text-neutral-100"
              )}
            >
              <Icon className="w-4 h-4" />
              {t(item.labelKey, lang)}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-white/5 space-y-3">
        <LanguageSwitcher current={lang} />

        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium truncate">{email}</div>
            <span
              className={cn(
                "badge mt-1",
                role === "admin"
                  ? "bg-accent/15 text-accent"
                  : "bg-white/5 text-neutral-400"
              )}
            >
              {role === "admin" ? t("role_admin", lang) : t("role_viewer", lang)}
            </span>
          </div>
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="text-xs text-neutral-400 hover:text-danger transition"
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
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-bg/95 backdrop-blur border-b border-white/5">
        <Link href="/dashboard" className="flex items-center gap-2">
          <MongolzLogo size={44} />
          <span className="text-sm font-bold tracking-tight">MONGOLZ</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Цэс нээх"
          className="w-10 h-10 inline-flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 transition"
        >
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* Mobile drawer (overlay + slide-in panel) */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-in fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] flex flex-col bg-bg-secondary border-r border-white/10 shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Цэс хаах"
              className="absolute top-3 right-3 w-9 h-9 inline-flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 transition z-10"
            >
              <X className="w-5 h-5" />
            </button>
            {navContent}
          </aside>
        </>
      )}

      {/* Desktop sidebar (≥768px) */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-white/5 bg-bg-secondary/50 backdrop-blur">
        {navContent}
      </aside>
    </>
  );
}
