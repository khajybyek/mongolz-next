import type { Metadata } from "next";
import { LangProvider } from "@/lib/i18n/client";
import { getServerLang } from "@/lib/i18n/server";

/**
 * /wall has its own layout — no sidebar, no top bar, no chrome.
 * Designed for an always-on monitor/TV in a control room.
 */
export const metadata: Metadata = {
  title: "Live Wall · MONGOLZ Security",
  robots: { index: false, follow: false },
};

export default async function WallLayout({ children }: { children: React.ReactNode }) {
  const lang = await getServerLang();
  return (
    <LangProvider initial={lang}>
      <div className="min-h-screen bg-bg text-text">{children}</div>
    </LangProvider>
  );
}
