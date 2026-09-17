import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { getServerLang } from "@/lib/i18n/server";
import { HeaderOffset } from "./header-offset";
import { SchNav } from "./sch-nav";
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
        <div className="page-safe-gutter mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-2 py-2 sm:justify-between pt-[calc(0.5rem+env(safe-area-inset-top,0px))] sm:py-3 sm:pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
          <Link href={"/sch" as Route} className="order-1 mr-auto flex min-h-11 items-center gap-3 rounded-lg sm:mr-0" aria-label={c.brand}>
            {/* Both marks sit directly on the header — no plate — side by side. */}
            <span className="inline-flex items-center gap-2 sm:gap-3">
              <Image
                src="/sch/sch-logo.png"
                alt="순천향대학교 · Soon Chun Hyang University"
                width={1000}
                height={199}
                priority
                className="h-5 w-auto min-[380px]:h-6 sm:h-9"
              />
              <Image
                src="/sch/smis-logo.png"
                alt="SMIS"
                width={512}
                height={512}
                priority
                className="h-6 w-6 min-[380px]:h-8 min-[380px]:w-8 sm:h-11 sm:w-11"
              />
            </span>
            <span className="hidden flex-col leading-tight md:flex">
              <span className="text-sm font-bold tracking-[0.08em]">{c.brand}</span>
              <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-text-muted">Chuseok 2026</span>
            </span>
          </Link>

          {/* Phones: the nav takes its own centred row under the mark; wider screens keep one row. */}
          <div className="order-3 flex w-full justify-center sm:order-2 sm:w-auto">
            <SchNav register={c.navRegister} teams={c.navTeams} label={c.brand} />
          </div>

          <div className="order-2 flex shrink-0 items-center gap-1.5 sm:order-3 sm:gap-2">
            {/* Narrower language buttons on phones so the mark, languages and theme share one row. */}
            <LanguageSwitcher current={lang} className="[&_button]:min-w-9 [&_button]:px-1.5 min-[380px]:[&_button]:min-w-10 min-[380px]:[&_button]:px-2 sm:[&_button]:min-w-11 sm:[&_button]:px-2.5" />
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
