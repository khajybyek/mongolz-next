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
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
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
