/**
 * Who may run the SCH Esports console. Pure so both the page/API helpers and
 * the middleware share one rule, and so it can be unit-tested.
 *
 * - admin: as everywhere in the console, the second factor is mandatory.
 * - organiser: the tournament-only role. It reaches nothing but /sch/admin
 *   (and its own GDPR page), so it is allowed to work without TOTP — the
 *   trade-off the organisers asked for. Anyone else is refused.
 */
export type OrganiserVerdict = "ok" | "forbidden" | "totp_required";

export function schOrganiserVerdict(profile: { role: string; totp_enabled: boolean }): OrganiserVerdict {
  if (profile.role === "organiser") return "ok";
  if (profile.role === "admin") return profile.totp_enabled ? "ok" : "totp_required";
  return "forbidden";
}

export const ORGANISER_HOME = "/sch/admin";

/** Pages the organiser role may open; everything else bounces to its console. */
export function organiserPathAllowed(path: string): boolean {
  return (
    path === ORGANISER_HOME ||
    path.startsWith(`${ORGANISER_HOME}/`) ||
    path === "/my-data" ||
    path.startsWith("/my-data/")
  );
}
