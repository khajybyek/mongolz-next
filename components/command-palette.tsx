"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  Video,
  PlayCircle,
  UserSearch,
  Bell,
  BarChart3,
  Sparkles,
  Users,
  Cctv,
  ScrollText,
  UserCog,
  BellRing,
  Webhook,
  GraduationCap,
  Gauge,
  BookOpen,
  Settings,
  ShieldCheck,
  CalendarClock,
  Database,
  Archive,
  type LucideIcon,
} from "lucide-react";
import { useT } from "@/lib/i18n/client";

interface Entry {
  href: string;
  icon: LucideIcon;
  label: string;
  hint?: string;
  keywords?: string[];
}

export function CommandPalette({ role }: { role: "admin" | "viewer" | "auditor" }) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const all: Entry[] = [
      { href: "/dashboard", icon: LayoutDashboard, label: t("nav_dashboard") },
      { href: "/live", icon: Video, label: t("nav_live") },
      { href: "/playback", icon: PlayCircle, label: t("nav_playback") },
      { href: "/analytics", icon: BarChart3, label: t("nav_analytics") },
      { href: "/audit", icon: ScrollText, label: t("nav_audit") },
      { href: "/demo", icon: Sparkles, label: t("nav_demo"), keywords: ["pitch", "defense"] },
      { href: "/compare", icon: Sparkles, label: t("nav_compare"), keywords: ["mask", "blur", "algorithm"] },
      { href: "/suspects", icon: UserSearch, label: t("nav_suspects") },
      { href: "/alerts", icon: Bell, label: t("nav_alerts") },
      { href: "/alerts-live", icon: Bell, label: t("nav_alerts_live"), keywords: ["realtime", "live"] },
      { href: "/alert-rules", icon: BellRing, label: t("nav_alert_rules") },
      { href: "/ai", icon: Sparkles, label: t("nav_ai") },
      { href: "/faces", icon: Users, label: t("nav_faces") },
      { href: "/cameras", icon: Cctv, label: t("nav_cameras") },
      { href: "/users", icon: UserCog, label: t("nav_users") },
      { href: "/webhooks", icon: Webhook, label: t("nav_webhooks") },
      { href: "/reveal-approvals", icon: ShieldCheck, label: t("nav_reveal_approvals"), keywords: ["unblur"] },
      { href: "/retention", icon: CalendarClock, label: t("nav_retention") },
      { href: "/active-learning", icon: GraduationCap, label: t("nav_active_learning"), keywords: ["label", "feedback", "threshold"] },
      { href: "/benchmarks", icon: Gauge, label: t("nav_benchmarks") },
      { href: "/db-monitor", icon: Database, label: t("nav_db_monitor") },
      { href: "/backup", icon: Archive, label: t("nav_backup") },
      { href: "/docs", icon: BookOpen, label: t("nav_docs") },
      { href: "/settings", icon: Settings, label: t("nav_settings") },
    ];
    return all.filter((e) => {
      if (role === "admin") return true;
      if (role === "auditor") return e.href === "/audit";
      // viewer
      const viewerAllowed = [
        "/dashboard",
        "/live",
        "/playback",
        "/analytics",
        "/settings",
      ];
      return viewerAllowed.includes(e.href);
    });
  }, [role, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const hay = [e.label, e.href, ...(e.keywords ?? [])].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((p) => !p);
        return;
      }
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(filtered.length - 1, a + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = filtered[active];
        if (hit) {
          setOpen(false);
          router.push(hit.href as never);
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, filtered, active, router]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("cmdk_title")}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 animate-fade-in"
    >
      <div
        className="backdrop"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div className="relative w-full max-w-xl bg-surface-elevated border border-border-strong rounded-2xl shadow-overlay overflow-hidden animate-scale-in">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("cmdk_placeholder")}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-text-muted"
          />
          <kbd className="text-2xs px-1.5 py-0.5 rounded bg-white/[0.06] text-text-muted border border-border font-mono">
            ESC
          </kbd>
        </div>
        <ul
          ref={listRef}
          className="max-h-[55vh] overflow-y-auto py-1"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-xs text-text-muted">
              {t("cmdk_empty")}
            </li>
          ) : (
            filtered.map((e, i) => {
              const Icon = e.icon;
              const isActive = i === active;
              return (
                <li
                  key={e.href}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    setOpen(false);
                    router.push(e.href as never);
                  }}
                  className={`px-4 py-2.5 flex items-center gap-3 text-sm cursor-pointer transition-colors ${
                    isActive
                      ? "bg-accent/10 text-accent"
                      : "text-text-soft hover:bg-white/[0.04]"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1 truncate">{e.label}</span>
                  <code className="text-2xs text-text-faint font-mono">{e.href}</code>
                </li>
              );
            })
          )}
        </ul>
        <div className="px-4 py-2 border-t border-border flex items-center justify-between text-2xs text-text-muted">
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-border font-mono">↑↓</kbd>
            {t("cmdk_navigate")}
            <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-border font-mono ml-2">↵</kbd>
            {t("cmdk_open")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-border font-mono">⌘K</kbd>
            {t("cmdk_toggle")}
          </span>
        </div>
      </div>
    </div>
  );
}
