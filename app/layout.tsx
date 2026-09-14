import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ThemeProvider } from "@/lib/theme/client";
import { getServerTheme } from "@/lib/theme/server";
import { getServerLang } from "@/lib/i18n/server";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

// Self-hosted at build time by next/font (no runtime request to Google, so
// the strict CSP `font-src 'self'` still holds). Cyrillic covers Mongolian.
const geist = Geist({
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--font-geist",
  display: "swap",
});
const geistMono = Geist_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://aicctv.dev"),
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
    url: "https://aicctv.dev",
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
  const lang = await getServerLang();
  const htmlLang = lang === "kr" ? "ko" : lang;
  return (
    <html
      lang={htmlLang}
      data-theme={theme}
      data-scroll-behavior="smooth"
      className={`${geist.variable} ${geistMono.variable}${theme === "dark" ? " dark" : ""}`}
    >
      <body className="min-h-dvh antialiased font-sans">
        <ThemeProvider initial={theme}>{children}</ThemeProvider>
        <SpeedInsights />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
