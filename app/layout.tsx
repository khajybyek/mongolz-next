import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mn" className="dark">
      <body className="min-h-screen antialiased">
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
