/** Fresh evidence is required; old rows never prove today's capture works. */
export function isFreshEvidence(timestamp: string | null | undefined, maxAgeMs: number, now = Date.now()): boolean {
  if (!timestamp) return false;
  const age = now - Date.parse(timestamp);
  return Number.isFinite(age) && age >= -5_000 && age <= maxAgeMs;
}

export const CAMERA_FRESH_MS = 90_000;
export const INGEST_FRESH_MS = 30 * 60_000;
