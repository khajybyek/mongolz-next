import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { Gamepad2, Users } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { getServerLang } from "@/lib/i18n/server";
import { HeaderOffset } from "./header-offset";
import { schCopy } from "./sch-copy";

/**
 * Public chrome shared by `/sch` and `/sch/teams`: the product header with
 * the language + theme controls, a two-link nav and a quiet footer. The
 * organiser console lives under `(app)/sch/admin` and uses the app shell.
 */
export default async function SchLayout({ children }: { children: React.ReactNode }) {
  const lang = await getServerLang();
  const c = schCopy(lang);

  return (
    <div className="relative flex min-h-svh flex-col bg-gradient-hero">
      {/* The header's live height feeds `--sch-header-h` (see header-offset.tsx) so in-page anchors clear it on phones too. */}
      <header id="sch-header" className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur-xl">
        <HeaderOffset headerId="sch-header" />
        <div className="page-safe-gutter mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] sm:gap-y-2 sm:py-3 sm:pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
          <Link href={"/sch" as Route} className="flex min-h-11 items-center gap-3 rounded-lg" aria-label={c.brand}>
            {/* University mark: blue on transparent, so it sits on a white plate in the dark theme. */}
            <span className="inline-flex items-center rounded-lg bg-white px-2 py-1 dark:ring-1 dark:ring-white/10">
              <Image
                src="/sch/sch-logo.png"
                alt="순천향대학교 · Soon Chun Hyang University"
                width={1000}
                height={199}
                priority
                className="h-8 w-auto sm:h-9"
              />
            </span>
            <span className="hidden flex-col leading-tight min-[420px]:flex">
              <span className="text-sm font-bold tracking-[0.08em]">{c.brand}</span>
              <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-text-muted">Chuseok 2026</span>
            </span>
          </Link>

          <nav aria-label={c.brand} className="order-3 flex w-full items-center gap-1 border-t border-border pt-1.5 sm:order-none sm:w-auto sm:border-0 sm:pt-0">
            <Link href={"/sch" as Route} className="btn-ghost btn-sm">
              <Gamepad2 className="h-3.5 w-3.5" aria-hidden />
              {c.navRegister}
            </Link>
            <Link href={"/sch/teams" as Route} className="btn-ghost btn-sm">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {c.navTeams}
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <LanguageSwitcher current={lang} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="main-content" className="page-safe-gutter relative z-10 mx-auto w-full max-w-6xl flex-1 pb-[calc(3rem+env(safe-area-inset-bottom,0px))]">
        {children}
      </main>

      <footer className="page-safe-gutter mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 border-t border-border py-[max(1.25rem,env(safe-area-inset-bottom,0px))] text-[11px] leading-5 text-text-muted sm:flex-row">
        <span className="font-medium tracking-wide">{c.brand} · Chuseok 2026</span>
        <Link href="/" className="link">{c.backHome}</Link>
      </footer>
    </div>
  );
}
