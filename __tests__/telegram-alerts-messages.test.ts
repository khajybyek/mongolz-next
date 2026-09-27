/**
 * private.uptime_collect() (pg_cron) posts {kind, checked_at} to the
 * telegram-alerts edge function. buildMessage() routes only the kinds it lists
 * to the uptime renderer; anything else falls through to the suspect-alert
 * branch and arrives as an empty "Security Alert". This ties the kind strings
 * in the latest uptime migration to the renderer so a rename on either side
 * fails here instead of in the ops chat.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  UPTIME_KINDS,
  buildMessage,
  type Payload,
} from "@/supabase/functions/telegram-alerts/messages";

const MIGRATIONS = path.join(__dirname, "..", "supabase", "migrations");

/** The newest migration that (re)defines private.uptime_collect(). */
function latestCollectorSql(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse();
  for (const f of files) {
    const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
    if (/create\s+or\s+replace\s+function\s+private\.uptime_collect\s*\(/i.test(sql)) return sql;
  }
  throw new Error("no migration defines private.uptime_collect()");
}

/** Kind literals the collector can post ('web_down', 'ml_recovered', …). */
function collectorKinds(sql: string): string[] {
  const body = sql.slice(sql.search(/create\s+or\s+replace\s+function\s+private\.uptime_collect/i));
  const kinds = new Set<string>();
  for (const m of body.matchAll(/'((?:web|db|ml)_(?:down|recovered))'/g)) kinds.add(m[1]);
  return [...kinds].sort();
}

const AT = "2026-09-27T01:00:00Z";
const defaultAlert = buildMessage({ kind: "alert", created_at: AT } as unknown as Payload);

describe("telegram-alerts uptime kinds", () => {
  it("renders exactly the kinds private.uptime_collect() posts", () => {
    expect(collectorKinds(latestCollectorSql())).toEqual([...UPTIME_KINDS].sort());
  });

  it.each(UPTIME_KINDS)("%s renders an uptime message, not the suspect-alert fallback", (kind) => {
    const text = buildMessage({ kind, checked_at: AT });
    expect(text).not.toBe(defaultAlert);
    expect(text).not.toContain("Security Alert");
    const component = { web: "Web app", db: "Database", ml: "ML service" }[kind.split("_")[0]];
    expect(text).toContain(`*${component} ${kind.endsWith("_down") ? "DOWN" : "recovered"}*`);
    expect(text).toContain("2026");
  });

  it("an unknown kind still falls back to the suspect-alert branch", () => {
    expect(buildMessage({ kind: "web_dwn", created_at: AT, checked_at: AT } as unknown as Payload)).toBe(defaultAlert);
  });
});
