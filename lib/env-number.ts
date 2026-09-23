/**
 * A threshold env var as a finite, strictly positive number — or the
 * fallback. `Number("")` is 0 and `Number("abc")` is NaN: an empty
 * ANOMALY_THRESHOLD used to make every |z| >= 0 bucket an anomaly, and a
 * NaN one silently disabled the check.
 */
export function positiveNumberEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
