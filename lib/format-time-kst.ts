// "HH:mm:ss" in KST (Asia/Seoul), assembled from Intl parts with an explicit
// h23 cycle so the server render and the browser hydrate to the same string.
// `toLocaleTimeString("mn-MN")` does not: Node gives "14:07:09" while
// Chromium gives "2:07:09 PM", which is a hydration mismatch for any row that
// is rendered on the server (e.g. /alerts-live's seeded last-hour alerts).
const KST_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function formatTimeKst(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  const part: Record<string, string> = {};
  for (const p of KST_TIME.formatToParts(date)) part[p.type] = p.value;
  return `${part.hour}:${part.minute}:${part.second}`;
}
