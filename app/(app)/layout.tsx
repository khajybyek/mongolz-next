import { Sidebar } from "@/components/sidebar";
import { AppHeader } from "@/components/app-header";
import { MobileTabbar } from "@/components/mobile-tabbar";
import { ShellProvider } from "@/components/shell-context";
import { ToastProvider } from "@/components/ui/toast";
import { RealtimeAlerts } from "@/components/realtime-alerts";
import { CommandPalette } from "@/components/command-palette";
import { VitalsReporter } from "@/components/vitals-reporter";
import { requireUser } from "@/lib/supabase/auth";
import { getServerLang } from "@/lib/i18n/server";
import { LangProvider } from "@/lib/i18n/client";
import { t } from "@/lib/i18n/translations";
import { isStaging, envLabel } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireUser();
  const lang = await getServerLang();
  const staging = isStaging();

  return (
    <LangProvider initial={lang}>
      <ShellProvider>
        <ToastProvider>
          <div className="md:flex min-h-dvh relative bg-bg-secondary">
            {staging && (
              <div className="fixed top-0 left-0 right-0 z-40 bg-warning-soft border-b border-warning/30 text-warning text-2xs font-medium text-center py-1 pointer-events-none backdrop-blur">
                ⚠ {envLabel().toUpperCase()} {t("staging_not_production", lang)}
              </div>
            )}
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded focus:bg-accent focus:text-bg focus:text-sm focus:font-medium"
            >
              {t("skip_to_content", lang)}
            </a>

            <Sidebar
              lang={lang}
              role={profile.role}
              email={user.email}
              isSuperAdmin={profile.is_super_admin}
            />

            <div className="flex-1 min-w-0 flex flex-col">
              <AppHeader
                lang={lang}
                role={profile.role}
                email={user.email}
                isSuperAdmin={profile.is_super_admin}
              />
              <main id="main" tabIndex={-1} className="flex-1 min-w-0 overflow-x-hidden pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
                <div className="px-4 md:px-6 xl:px-9 py-6 lg:py-8 max-w-[1440px] mx-auto animate-fade-in">
                  {children}
                </div>
              </main>
            </div>

            <MobileTabbar role={profile.role} lang={lang} />

            {/* Real-time alerts (admin only — RLS-restricted on alerts table) */}
            {profile.role === "admin" && (
              <RealtimeAlerts
                labels={{
                  matchLabel: t("rt_match_label", lang),
                  seeAll: t("rt_see_all", lang),
                  dismiss: t("rt_dismiss", lang),
                  ack: t("rt_ack", lang),
                  ackFailed: t("rt_ack_failed", lang),
                }}
              />
            )}
            <CommandPalette role={profile.role} />
            {/* Web-vitals beacon needs a session (/api/vitals is auth-gated), so it
                lives inside the shell instead of the public root layout. */}
            <VitalsReporter />
          </div>
        </ToastProvider>
      </ShellProvider>
    </LangProvider>
  );
}
