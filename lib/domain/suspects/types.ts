/**
 * Domain types for the Suspects bounded context.
 *
 * These mirror the DB columns but are intentionally framework-agnostic
 * — no Supabase row types leak in, so swapping the storage backend
 * (Supabase → Aurora, Supabase → SQLite-in-memory for tests, etc.)
 * doesn't touch domain code.
 */

export type PrivacyTier = "vip" | "standard" | "relaxed";

export interface Suspect {
  id: string;
  name: string;
  imagePath: string;
  notes: string | null;
  privacyTier: PrivacyTier;
  createdAt: string;
}

export interface NewSuspect {
  name: string;
  imagePath: string;
  notes?: string | null;
  privacyTier?: PrivacyTier;
}

/** Single point of truth for the privacy tier list — UI selectors and
 *  validators should import this rather than hard-coding strings. */
export const PRIVACY_TIERS: ReadonlyArray<PrivacyTier> = ["vip", "standard", "relaxed"] as const;

export function isPrivacyTier(value: unknown): value is PrivacyTier {
  return typeof value === "string" && (PRIVACY_TIERS as readonly string[]).includes(value);
}
