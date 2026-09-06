"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BookOpen,
  ChevronRight,
  Crown,
  Languages,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { MongolzLogo } from "./logo";
import { useShell } from "./shell-context";
import { applyLanguage } from "./language-switcher";
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from "./ui/dropdown";
import { useTheme } from "@/lib/theme/client";
import { cn } from "@/lib/utils";
import { findNavItem, type Role } from "@/lib/nav";
import { LANGUAGES, t, type Lang } from "@/lib/i18n/translations";

interface Props {
  lang: Lang;
  role: Role;
  email: string;
  isSuperAdmin?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shortSegment(seg: string): string {
  let s = seg;
  try {
    s = decodeURIComponent(seg);
  } catch {
    /* keep raw */
  }
  if (UUID_RE.test(s)) return s.slice(0, 8) + "…";
  return s.length > 22 ? s.slice(0, 20) + "…" : s;
}

interface Crumb {
  label: string;
  href?: string;
}

function buildCrumbs(pathname: string, lang: Lang): Crumb[] {
  const hit = findNavItem(pathname);
  if (!hit) {
    const segments = pathname.split("/").filter(Boolean);
    return segments.map((seg, i) => ({
      label: shortSegment(seg),
      href: "/" + segments.slice(0, i + 1).join("/"),
    }));
  }
  const crumbs: Crumb[] = [
    { label: t(hit.group.labelKey, lang) },
    { label: t(hit.item.labelKey, lang), href: hit.item.href },
  ];
  const rest = pathname.slice(hit.item.href.length).split("/").filter(Boolean);
  rest.forEach((seg, i) => {
    crumbs.push({
      label: shortSegment(seg),
      href: hit.item.href + "/" + rest.slice(0, i + 1).join("/"),
    });
  });
  return crumbs;
}

type Uptime = {
  status: "ok" | "degraded";
  checks: { ml: { ok: boolean }; db: { ok: boolean } };
};

function HeaderStatus({ lang, role }: { lang: Lang; role: Role }) {
  const [data, setData] = useState<Uptime | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/uptime", { cache: "no-store" });
        const json = (await res.json()) as Uptime;
        if (!cancelled) {
          setData(json);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const label = failed
    ? t("live_status_failed", lang)
    : !data
    ? t("status_checking", lang)
    : data.status === "ok"
    ? t("status_all_ok", lang)
    : t("status_degraded", lang);

  const dot = (ok: boolean | undefined) =>
    ok === undefined ? "bg-text-faint" : ok ? "bg-success" : "bg-danger";

  const body = (
    <>
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("w-1.5 h-1.5 rounded-full", dot(data?.checks.ml.ok))} aria-hidden />
        ML
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("w-1.5 h-1.5 rounded-full", dot(data?.checks.db.ok))} aria-hidden />
        DB
      </span>
    </>
  );

  const cls =
    "hidden lg:inline-flex items-center gap-2.5 h-9 px-3 rounded-lg border border-border bg-surface-elevated/60 text-2xs font-medium text-text-muted hover:text-text hover:border-border-strong transition-colors";

  const overall = failed
    ? "bg-danger"
    : !data
    ? "bg-text-faint"
    : data.status === "ok"
    ? "bg-success"
    : "bg-warning";

  return (
    <>
      {role === "admin" ? (
        <Link href={"/health" as never} className={cls} title={label} aria-label={label}>
          {body}
        </Link>
      ) : (
        <span className={cls} title={label} aria-label={label}>
          {body}
        </span>
      )}
      {/* Compact single dot between md and lg */}
      <span
        className="hidden md:inline-flex lg:hidden items-center justify-center w-9 h-9 rounded-lg border border-border bg-surface-elevated/60"
        title={label}
        aria-label={label}
      >
        <span className={cn("w-2 h-2 rounded-full", overall, data?.status === "ok" && "animate-pulse")} aria-hidden />
      </span>
    </>
  );
}

const iconBtn =
  "inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border bg-surface-elevated/60 text-text-soft hover:text-text hover:border-border-strong transition-colors";

export function AppHeader({ lang, role, email, isSuperAdmin = false }: Props) {
  const pathname = usePathname();
  const { setMobileNavOpen, setPaletteOpen } = useShell();
  const { theme, toggleTheme } = useTheme();
  const [langPending, setLangPending] = useState(false);

  const crumbs = buildCrumbs(pathname, lang);
  const current = crumbs[crumbs.length - 1]?.label ?? "";

  async function switchLang(next: Lang) {
    if (next === lang || langPending) return;
    setLangPending(true);
    const ok = await applyLanguage(next);
    if (!ok) setLangPending(false);
  }

  const roleLabel = isSuperAdmin
    ? "Super admin"
    : role === "admin"
    ? t("role_admin", lang)
    : role === "auditor"
    ? t("role_auditor", lang)
    : t("role_viewer", lang);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/70 backdrop-blur-xl">
      <div className="h-14 px-4 md:px-6 lg:px-8 max-w-7xl mx-auto flex items-center gap-2 md:gap-3">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label={t("open_menu", lang)}
          className={cn(iconBtn, "md:hidden")}
        >
          <Menu className="w-5 h-5" />
        </button>
        <Link href={"/dashboard" as never} className="md:hidden inline-flex items-center" aria-label="MONGOLZ">
          <MongolzLogo size={26} />
        </Link>

        <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-1 text-sm min-w-0">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={`${c.href ?? c.label}-${i}`} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-text-faint shrink-0" aria-hidden />}
                {c.href && !last ? (
                  <Link
                    href={c.href as never}
                    className="text-text-muted hover:text-text transition-colors truncate max-w-[14rem]"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? "page" : undefined}
                    className={cn("truncate max-w-[16rem]", last ? "text-text font-semibold" : "text-text-muted")}
                  >
                    {c.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
        <span className="md:hidden text-sm font-semibold truncate">{current}</span>

        <div className="ml-auto flex items-center gap-1.5 md:gap-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden sm:inline-flex items-center gap-2 h-9 pl-3 pr-1.5 w-44 lg:w-60 rounded-lg border border-border bg-surface-elevated/60 text-text-muted hover:text-text hover:border-border-strong transition-colors text-sm"
            aria-label={t("header_search_hint", lang)}
          >
            <Search className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left truncate">{t("header_search", lang)}</span>
            <kbd className="kbd">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className={cn(iconBtn, "sm:hidden")}
            aria-label={t("header_search", lang)}
          >
            <Search className="w-4 h-4" />
          </button>

          <HeaderStatus lang={lang} role={role} />

          {/* Theme + language live in the account menu on phones (see below)
              so the 390px header keeps only the essentials. */}
          <button
            type="button"
            onClick={toggleTheme}
            className={cn(iconBtn, "hidden md:inline-flex")}
            aria-label={theme === "dark" ? t("theme_light", lang) : t("theme_dark", lang)}
            title={theme === "dark" ? t("theme_light", lang) : t("theme_dark", lang)}
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <div className="hidden md:block">
            <Dropdown
              ariaLabel={t("menu_language", lang)}
              triggerClassName={cn(iconBtn, "w-auto px-2.5 gap-1.5 text-xs font-semibold uppercase")}
              trigger={
                <>
                  <Languages className="w-4 h-4" />
                  <span>{lang}</span>
                </>
              }
            >
              <DropdownLabel>{t("menu_language", lang)}</DropdownLabel>
              {(Object.keys(LANGUAGES) as Lang[]).map((l) => (
                <DropdownItem
                  key={l}
                  active={l === lang}
                  disabled={langPending}
                  onClick={() => switchLang(l)}
                  icon={<span className="text-2xs font-bold uppercase">{l}</span>}
                >
                  {LANGUAGES[l]}
                </DropdownItem>
              ))}
            </Dropdown>
          </div>

          <Dropdown
            ariaLabel={t("menu_account", lang)}
            triggerClassName="relative inline-flex items-center justify-center w-9 h-9 rounded-full bg-accent/15 text-accent border border-accent/25 text-xs font-bold uppercase hover:bg-accent/25 transition-colors"
            trigger={
              <>
                {(email || "?").charAt(0)}
                {isSuperAdmin && (
                  <Crown
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 text-accent drop-shadow-[0_0_4px_rgba(0,212,255,0.6)]"
                    aria-hidden
                  />
                )}
              </>
            }
            panelClassName="min-w-[15rem]"
          >
            <div className="px-2.5 pt-2 pb-2.5">
              <div className="text-sm font-medium text-text truncate">{email}</div>
              <div className="mt-1 flex items-center gap-1.5 text-2xs text-text-muted">
                <ShieldCheck className="w-3 h-3" aria-hidden />
                {roleLabel}
              </div>
            </div>
            <DropdownSeparator />
            {role === "admin" && (
              <Link href={"/settings" as never} role="menuitem" data-dropdown-close className="block">
                <span className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-soft hover:bg-text-muted/[0.06] hover:text-text transition-colors">
                  <Settings className="w-4 h-4 opacity-80" />
                  {t("nav_settings", lang)}
                </span>
              </Link>
            )}
            {role === "admin" && (
              <Link href={"/docs" as never} role="menuitem" data-dropdown-close className="block">
                <span className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-soft hover:bg-text-muted/[0.06] hover:text-text transition-colors">
                  <BookOpen className="w-4 h-4 opacity-80" />
                  {t("nav_docs", lang)}
                </span>
              </Link>
            )}
            {role !== "auditor" && (
              <Link href={"/privacy" as never} role="menuitem" data-dropdown-close className="block">
                <span className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-soft hover:bg-text-muted/[0.06] hover:text-text transition-colors">
                  <Activity className="w-4 h-4 opacity-80" />
                  {t("nav_privacy", lang)}
                </span>
              </Link>
            )}
            <div className="md:hidden">
              <DropdownSeparator />
              <DropdownLabel>{t("menu_preferences", lang)}</DropdownLabel>
              <DropdownItem
                onClick={toggleTheme}
                icon={theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              >
                {theme === "dark" ? t("theme_light", lang) : t("theme_dark", lang)}
              </DropdownItem>
              {(Object.keys(LANGUAGES) as Lang[]).map((l) => (
                <DropdownItem
                  key={l}
                  active={l === lang}
                  disabled={langPending}
                  onClick={() => switchLang(l)}
                  icon={<span className="text-2xs font-bold uppercase">{l}</span>}
                >
                  {LANGUAGES[l]}
                </DropdownItem>
              ))}
            </div>
            <DropdownSeparator />
            <form action="/auth/logout" method="post">
              <DropdownItem type="submit" tone="danger" icon={<LogOut className="w-4 h-4" />}>
                {t("logout", lang)}
              </DropdownItem>
            </form>
          </Dropdown>
        </div>
      </div>
    </header>
  );
}
