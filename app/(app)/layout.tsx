import { Sidebar } from "@/components/sidebar";
import { RealtimeAlerts } from "@/components/realtime-alerts";
import { requireUser } from "@/lib/supabase/auth";
import { getServerLang } from "@/lib/i18n/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireUser();
  const lang = await getServerLang();

  return (
    <div className="md:flex min-h-screen">
      <Sidebar lang={lang} role={profile.role} email={user.email} />
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <div className="px-4 md:px-6 py-6 max-w-7xl mx-auto">{children}</div>
      </main>
      {/* Real-time alerts (admin role-д л — RLS-ийг alerts table-аас идэвхтэй) */}
      {profile.role === "admin" && <RealtimeAlerts />}
    </div>
  );
}
