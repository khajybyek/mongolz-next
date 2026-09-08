/**
 * Shaping for the public SLO probe.
 *
 * The bug this encodes against: every probe treated an empty sample set as
 * compliance (`ratio = samples === 0 ? 1 : …`) and published
 * `"100.0% (0 samples)" · ok: true`. A system that had done nothing at all —
 * or whose query silently returned nothing — reported four green SLOs.
 *
 * Zero samples is not compliance, and neither is a sample of one. An SLO here
 * is in exactly one of four states:
 *
 *   met       — measured, and the measurement clears the target.
 *   breached  — measured, and it does not.
 *   no_data   — nothing to measure, or too little to mean anything.
 *   error     — the measurement itself failed. Not knowing is a signal too.
 *
 * The endpoint is public, so what leaves this module is aggregate state only:
 * a ratio or a latency, never the underlying counts (how many reveals were
 * run, how many alerts fired — that is operational volume, not SLO state).
 */

export type SloState = "met" | "breached" | "no_data" | "error";

/** How much evidence stands behind `state`, without publishing the count. */
export type SloEvidence = "sufficient" | "insufficient" | "none";

export interface Slo {
  id: string;
  name: string;
  target: string;
  state: SloState;
  /** `state === "met"`. Kept so existing monitors that read `ok` still work. */
  ok: boolean;
  /** Aggregate observation, or null when there is nothing to report. */
  observed: string | null;
  evidence: SloEvidence;
}

/**
 * Fewer than this many samples in the window and the ratio is noise: a single
 * slow reveal out of two would read as a 50 % breach, and one fast one as
 * 100 % compliance. Below the floor we report `no_data`, not a verdict.
 */
export const MIN_SAMPLES = 5;

function slo(base: Omit<Slo, "ok">): Slo {
  return { ...base, ok: base.state === "met" };
}

/** An SLO expressed as "at least `minRatio` of samples pass". */
export function ratioSlo(args: {
  id: string;
  name: string;
  target: string;
  samples: number;
  passing: number;
  minRatio: number;
  minSamples?: number;
}): Slo {
  const { id, name, target, samples, passing, minRatio, minSamples = MIN_SAMPLES } = args;

  if (samples <= 0) {
    return slo({ id, name, target, state: "no_data", observed: null, evidence: "none" });
  }
  if (samples < minSamples) {
    return slo({ id, name, target, state: "no_data", observed: null, evidence: "insufficient" });
  }

  const ratio = passing / samples;
  return slo({
    id,
    name,
    target,
    state: ratio >= minRatio ? "met" : "breached",
    observed: `${(ratio * 100).toFixed(1)}%`,
    evidence: "sufficient",
  });
}

/** An SLO expressed as "this measurement must stay at or below `max`". */
export function thresholdSlo(args: {
  id: string;
  name: string;
  target: string;
  value: number | null;
  max: number;
  unit: string;
}): Slo {
  const { id, name, target, value, max, unit } = args;

  if (value === null || !Number.isFinite(value)) {
    return slo({ id, name, target, state: "no_data", observed: null, evidence: "none" });
  }

  return slo({
    id,
    name,
    target,
    state: value <= max ? "met" : "breached",
    observed: `${Math.round(value)} ${unit}`,
    evidence: "sufficient",
  });
}

/**
 * An SLO with zero tolerance (audit chain integrity). `count === null` means
 * the check could not run, which is `error` — never "met".
 *
 * The exact number of broken rows stays internal (`/audit`, `/health`); the
 * public answer is intact or not.
 */
export function zeroToleranceSlo(args: {
  id: string;
  name: string;
  target: string;
  count: number | null;
}): Slo {
  const { id, name, target, count } = args;

  if (count === null || !Number.isFinite(count) || count < 0) {
    return slo({ id, name, target, state: "error", observed: null, evidence: "none" });
  }

  return count === 0
    ? slo({ id, name, target, state: "met", observed: "0", evidence: "sufficient" })
    : slo({ id, name, target, state: "breached", observed: "≥1", evidence: "sufficient" });
}

/** The probe threw or the query failed — we do not know, and we say so. */
export function erroredSlo(id: string, name: string, target: string): Slo {
  return slo({ id, name, target, state: "error", observed: null, evidence: "none" });
}

export interface SloSummary {
  /**
   * ok       — every SLO measured and met.
   * partial  — nothing breached, but at least one SLO has no usable evidence.
   * degraded — at least one SLO is breached, or could not be measured.
   */
  status: "ok" | "partial" | "degraded";
  /** 503 only for `degraded`: "we cannot tell yet" must not page an on-call. */
  httpStatus: 200 | 503;
  counts: Record<SloState, number>;
}

export function summarise(slos: readonly Slo[]): SloSummary {
  const counts: Record<SloState, number> = { met: 0, breached: 0, no_data: 0, error: 0 };
  for (const s of slos) counts[s.state] += 1;

  // No SLOs at all is the same failure as no samples: an empty table must
  // never render as a green service.
  const status: SloSummary["status"] =
    slos.length === 0 || counts.breached > 0 || counts.error > 0
      ? "degraded"
      : counts.no_data > 0
        ? "partial"
        : "ok";

  return { status, httpStatus: status === "degraded" ? 503 : 200, counts };
}
