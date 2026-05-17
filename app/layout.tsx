import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ThemeProvider } from "@/lib/theme/client";
import { getServerTheme } from "@/lib/theme/server";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { VitalsReporter } from "@/components/vitals-reporter";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mongolz.vercel.app"),
  title: { default: "MONGOLZ Security", template: "%s · MONGOLZ Security" },
  description:
    "Multi-authority masking + reveal · intelligent network camera & integrated control server. Capstone 2026-01-CD-03-07.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MONGOLZ" },
  openGraph: {
    type: "website",
    siteName: "MONGOLZ Security",
    title: "MONGOLZ Security",
    description:
      "Multi-authority masking + reveal · intelligent network camera & integrated control server.",
    url: "https://mongolz.vercel.app",
    locale: "mn_MN",
    alternateLocale: ["en_US", "ko_KR"],
  },
  twitter: {
    card: "summary_large_image",
    title: "MONGOLZ Security",
    description:
      "Multi-authority masking + reveal · intelligent network camera & integrated control server.",
  },
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
        <ServiceWorkerRegister />
        <VitalsReporter />
      </body>
    </html>
  );
}
