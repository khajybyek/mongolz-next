/**
 * Feature-flag registry for MONGOLZ Security.
 *
 * Implementation philosophy
 * -------------------------
 * A capstone project doesn't justify LaunchDarkly or Unleash. We just
 * need a single source of truth for which behaviour is on, where the
 * default is honest ("default" matches what the code does without an
 * override), and where the override surface is the cheapest thing that
 * works: an environment variable.
 *
 * Pro-grade upgrade path (post-capstone):
 *   * Move the registry into a Postgres table with admin UI.
 *   * Add per-user / per-role / percentage-rollout targeting.
 *   * Add a server-sent-events stream so flips propagate < 1 s.
 *
 * Every flag listed here is read by real code (grep `flag("`) — a flag that
 * nothing consults is worse than none, because operators believe they
 * flipped something. Privacy-zone enforcement lives in the ML service and is
 * deliberately NOT switchable from the web tier.
 *
 * Today it's good enough to:
 *   * Document every kill-switch in one place.
 *   * Read it from server components, API routes, and ML service via
 *     the same shape (one env var per flag, MONGOLZ_FF_ prefix).
 *   * Provide a typed accessor that fails closed if the flag name is
 *     ever typo'd.
 */

export const FLAGS = {
  /** Wall subdomain auto-rewrite (live.mongolz.dev → /wall). Disable
   *  here if the kiosk hosts misbehave without yanking middleware. */
  wall_subdomain: { default: true, env: "MONGOLZ_FF_WALL_SUBDOMAIN" },

  /** Step-up reauth gate on /faces. Disabling this returns the page to
   *  the previous behaviour (admin role check only). */
  faces_reauth_gate: { default: true, env: "MONGOLZ_FF_FACES_REAUTH" },

  /** Daily anomaly sweep cron. Disable when investigating false-positive
   *  alert storms so we stop minting new rows. */
  anomaly_cron: { default: true, env: "MONGOLZ_FF_ANOMALY_CRON" },

  /** Web push fan-out on new alert. Disable to silence push noise
   *  during off-hours / on-call rotation handoff. */
  push_alerts: { default: true, env: "MONGOLZ_FF_PUSH_ALERTS" },

  /** Session pin enforcement (IP/16 + UA HMAC, mandatory for TOTP users)
   *  in lib/supabase/auth.ts. False = accept any Supabase session — the
   *  emergency switch if a proxy change starts rotating client IPs. */
  session_pin_enforce: { default: true, env: "MONGOLZ_FF_SESSION_PIN" },
} as const;

export type FlagName = keyof typeof FLAGS;

const truthy = new Set(["1", "true", "yes", "on", "y"]);
const falsy = new Set(["0", "false", "no", "off", "n"]);

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const v = raw.toLowerCase().trim();
  if (truthy.has(v)) return true;
  if (falsy.has(v)) return false;
  return fallback;
}

/** Return the boolean state of a flag. Server-side only — relies on
 *  `process.env`. */
export function flag(name: FlagName): boolean {
  const def = FLAGS[name];
  return parseBool(process.env[def.env], def.default);
}

/** Snapshot of all flags (for the admin UI / debug page). */
export function allFlags(): Record<FlagName, { value: boolean; envVar: string; default: boolean }> {
  const out = {} as Record<FlagName, { value: boolean; envVar: string; default: boolean }>;
  for (const [name, def] of Object.entries(FLAGS) as [FlagName, (typeof FLAGS)[FlagName]][]) {
    out[name] = {
      value: parseBool(process.env[def.env], def.default),
      envVar: def.env,
      default: def.default,
    };
  }
  return out;
}
