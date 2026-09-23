import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MONGOLZ Security",
    short_name: "MONGOLZ",
    description: "AI-based CCTV face recognition with privacy-preserving surveillance",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a1e",
    theme_color: "#00d4ff",
    categories: ["security", "productivity", "business"],
    // `sizes` must match the real pixels: /icon.png is 64x64, and a manifest
    // without a genuine >=192px icon is not installable. The 192/512 files
    // are rendered from public/logo.png (1254px), not upscaled.
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      {
        name: "Сэрэмжлүүлэг",
        short_name: "Alerts",
        url: "/alerts",
        description: "Сүүлийн match-ууд",
      },
      {
        name: "Live бичлэг",
        short_name: "Live",
        url: "/live",
        description: "Камер watch",
      },
      {
        name: "Хяналтын самбар",
        short_name: "Dashboard",
        url: "/dashboard",
        description: "Stats",
      },
    ],
  };
}
