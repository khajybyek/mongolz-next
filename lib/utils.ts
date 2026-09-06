import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Assembled from parts instead of `toLocaleString("mn-MN")`: the mn-MN
// pattern differs between Node (server) and browsers, which produced React
// hydration mismatches in client components. Output is always
// "YYYY.MM.DD HH:mm" in KST (UTC+9).
const KST_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  const part: Record<string, string> = {};
  for (const p of KST_PARTS.formatToParts(date)) part[p.type] = p.value;
  return `${part.year}.${part.month}.${part.day} ${part.hour}:${part.minute}`;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
