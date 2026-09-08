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
    let request: AbortController | null = null;
    async function tick() {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const res = await fetch("/api/uptime", { cache: "no-store", signal: controller.signal });
        // A 503 is a valid degraded probe; other failures must not look healthy.
        if (res.status !== 200 && res.status !== 503) throw new Error("Status unavailable");
        const json = (await res.json()) as Partial<Uptime> | null;
        if (!json || (json.status !== "ok" && json.status !== "degraded") ||
          typeof json.checks?.ml?.ok !== "boolean" || typeof json.checks?.db?.ok !== "boolean") {
          throw new Error("Invalid status response");
        }
        if (!cancelled) {
          setData(json as Uptime);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setData(null);
          setFailed(true);
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      request?.abort();
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
        <span className={cn("w-1.5 h-1.5 rounded-full", dot(data?.checks?.ml?.ok))} aria-hidden />
        ML
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("w-1.5 h-1.5 rounded-full", dot(data?.checks?.db?.ok))} aria-hidden />
        DB
      </span>
    </>
  );

  const cls =
    "hidden xl:inline-flex shrink-0 items-center gap-3 h-11 px-3 rounded-lg border border-border text-2xs font-medium text-text-muted hover:text-text hover:bg-text-muted/[0.04] transition-colors";

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
      {/* A compact status indicator leaves room for the current page title. */}
      <span
        className="hidden lg:inline-flex xl:hidden shrink-0 items-center justify-center w-11 h-11"
        title={label}
        aria-label={label}
      >
        <span className={cn("w-2 h-2 rounded-full", overall)} aria-hidden />
      </span>
    </>
  );
}

const iconBtn =
  "inline-flex shrink-0 items-center justify-center w-11 h-11 rounded-xl text-text-muted hover:text-text hover:bg-text-muted/[0.06] transition-colors";

export function AppHeader({ lang, role, email, isSuperAdmin = false }: Props) {
  const pathname = usePathname();
  const { mobileNavOpen, setMobileNavOpen, setPaletteOpen } = useShell();
  const { theme, toggleTheme } = useTheme();
  const [langPending, setLangPending] = useState(false);

  const crumbs = buildCrumbs(pathname, lang);
  const current = crumbs[crumbs.length - 1]?.label ?? "";
  const CurrentIcon = findNavItem(pathname)?.item.icon;

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
    <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur-xl">
      <div className="h-16 md:h-[76px] px-3 md:px-6 lg:px-8 max-w-[1440px] mx-auto flex min-w-0 items-center gap-2 md:gap-3">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label={t("open_menu", lang)}
          aria-expanded={mobileNavOpen}
          aria-controls={mobileNavOpen ? "mobile-navigation" : undefined}
          className={cn(iconBtn, "md:hidden")}
        >
          <Menu className="w-5 h-5" />
        </button>
        <Link href={(role === "auditor" ? "/audit" : "/dashboard") as never} className="hidden sm:inline-flex md:hidden shrink-0 min-h-11 items-center rounded-lg" aria-label="MONGOLZ">
          <MongolzLogo size={26} />
        </Link>

        {CurrentIcon && <span className="hidden md:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-bg-secondary/60 text-text-muted"><CurrentIcon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden /></span>}
        <nav aria-label={t("nav_breadcrumb", lang)} className="hidden md:flex flex-1 items-center gap-1 text-[13px] min-w-0 overflow-hidden">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={`${c.href ?? c.label}-${i}`} className={cn("items-center gap-1 min-w-0", last ? "flex" : "hidden xl:flex shrink-[2]")}>
                {i > 0 && <ChevronRight className="hidden xl:block w-3.5 h-3.5 text-text-faint shrink-0" aria-hidden />}
                {c.href && !last ? (
                  <Link
                    href={c.href as never}
                    className="text-text-muted hover:text-text transition-colors truncate max-w-[10rem] py-3"
                    title={c.label}
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? "page" : undefined}
                    title={c.label}
                    className={cn("truncate max-w-[16rem]", last ? "text-text font-semibold" : "text-text-muted")}
                  >
                    {c.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
        <span className="md:hidden flex-1 min-w-0 text-sm font-semibold truncate" title={current}>{current}</span>

        <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-1.5">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden 2xl:inline-flex items-center gap-2 h-11 pl-3 pr-2 w-52 rounded-xl border border-border bg-bg-secondary/60 text-text-muted hover:text-text hover:border-border-strong transition-colors text-[13px]"
            aria-label={t("header_search_hint", lang)}
          >
            <Search className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left truncate">{t("header_search", lang)}</span>
            <kbd className="kbd">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className={cn(iconBtn, "2xl:hidden")}
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
            className={cn(iconBtn, "hidden lg:inline-flex")}
            aria-label={theme === "dark" ? t("theme_light", lang) : t("theme_dark", lang)}
            title={theme === "dark" ? t("theme_light", lang) : t("theme_dark", lang)}
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <div className="hidden lg:block">
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
            triggerClassName="relative inline-flex shrink-0 items-center justify-center w-11 h-11 rounded-xl bg-accent/10 text-accent border border-accent/20 text-sm font-semibold uppercase hover:bg-accent/20 transition-colors"
            trigger={
              <>
                {(email || "?").charAt(0)}
                {isSuperAdmin && (
                  <Crown
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 text-accent"
                    aria-hidden
                  />
                )}
              </>
            }
            panelClassName="min-w-[15rem] max-w-[calc(100vw-1.5rem)]"
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
                <span className="w-full min-h-11 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-soft hover:bg-text-muted/[0.06] hover:text-text transition-colors">
                  <Settings className="w-4 h-4 opacity-80" />
                  {t("nav_settings", lang)}
                </span>
              </Link>
            )}
            {role === "admin" && (
              <Link href={"/docs" as never} role="menuitem" data-dropdown-close className="block">
                <span className="w-full min-h-11 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-soft hover:bg-text-muted/[0.06] hover:text-text transition-colors">
                  <BookOpen className="w-4 h-4 opacity-80" />
                  {t("nav_docs", lang)}
                </span>
              </Link>
            )}
            {role !== "auditor" && (
              <Link href={"/privacy" as never} role="menuitem" data-dropdown-close className="block">
                <span className="w-full min-h-11 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-soft hover:bg-text-muted/[0.06] hover:text-text transition-colors">
                  <Activity className="w-4 h-4 opacity-80" />
                  {t("nav_privacy", lang)}
                </span>
              </Link>
            )}
            <div className="lg:hidden">
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
