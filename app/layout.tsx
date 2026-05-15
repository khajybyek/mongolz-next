import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MONGOLZ Security",
  description: "AI-Powered Surveillance — Face Recognition CCTV",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mn" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
