import { Sidebar } from "@/components/sidebar";
import { RealtimeAlerts } from "@/components/realtime-alerts";
import { requireUser } from "@/lib/supabase/auth";
import { getServerLang } from "@/lib/i18n/server";
import { isStaging, envLabel } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireUser();
  const lang = await getServerLang();

  const staging = isStaging();

  return (
    <div className="md:flex min-h-screen">
      {staging && (
        <div className="fixed top-0 left-0 right-0 z-40 bg-warning/15 border-b border-warning/30 text-warning text-xs font-medium text-center py-1 pointer-events-none">
          ⚠ {envLabel().toUpperCase()} ENVIRONMENT — production биш
        </div>
      )}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded focus:bg-accent focus:text-bg focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>
      <Sidebar lang={lang} role={profile.role} email={user.email} />
      <main id="main" tabIndex={-1} className="flex-1 min-w-0 overflow-x-hidden">
        <div className="px-4 md:px-6 py-6 max-w-7xl mx-auto">{children}</div>
      </main>
      {/* Real-time alerts (admin role-д л — RLS-ийг alerts table-аас идэвхтэй) */}
      {profile.role === "admin" && <RealtimeAlerts />}
    </div>
  );
}
