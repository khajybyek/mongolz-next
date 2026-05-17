import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ThemeProvider } from "@/lib/theme/client";
import { getServerTheme } from "@/lib/theme/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "MONGOLZ Security",
  description: "AI-Powered Surveillance — Face Recognition CCTV",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MONGOLZ" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a1e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await getServerTheme();
  return (
    <html lang="mn" data-theme={theme} className={theme === "dark" ? "dark" : undefined}>
      <body className="min-h-screen antialiased">
        <ThemeProvider initial={theme}>{children}</ThemeProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
