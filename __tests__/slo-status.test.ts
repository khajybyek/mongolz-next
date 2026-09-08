/** @jest-environment node */
/**
 * /api/slo-status — "no data" must never read as compliance.
 *
 * The endpoint used to compute `ratio = samples === 0 ? 1 : passing / samples`
 * and publish `100.0% (0 samples) · ok: true` for every SLO on a system that
 * had never run a reveal or fired an alert. These tests pin the three answers
 * the probe must be able to give — met, breached, no data — plus the error
 * case, and the HTTP status each maps to.
 */
import {
  MIN_SAMPLES,
  erroredSlo,
  ratioSlo,
  summarise,
  thresholdSlo,
  zeroToleranceSlo,
} from "@/app/api/slo-status/slo";

const REVEAL = {
  id: "reveal_turnaround",
  name: "Reveal turnaround < 5 min",
  target: "≥ 90% of completed reveals",
};

describe("ratioSlo", () => {
  it("reports no_data (not compliance) for an empty sample set", () => {
    const slo = ratioSlo({ ...REVEAL, samples: 0, passing: 0, minRatio: 0.9 });
    expect(slo.state).toBe("no_data");
    expect(slo.ok).toBe(false);
    expect(slo.evidence).toBe("none");
    expect(slo.observed).toBeNull();
  });

  it("reports no_data while the sample set is below the significance floor", () => {
    const samples = MIN_SAMPLES - 1;
    const slo = ratioSlo({ ...REVEAL, samples, passing: samples, minRatio: 0.9 });
    expect(slo.state).toBe("no_data");
    expect(slo.evidence).toBe("insufficient");
    // A 1-of-1 success must not be published as "100.0%".
    expect(slo.observed).toBeNull();
  });

  it("reports met once enough samples clear the target", () => {
    const slo = ratioSlo({ ...REVEAL, samples: 10, passing: 10, minRatio: 0.9 });
    expect(slo.state).toBe("met");
    expect(slo.ok).toBe(true);
    expect(slo.evidence).toBe("sufficient");
    expect(slo.observed).toBe("100.0%");
  });

  it("reports breached when the ratio misses the target", () => {
    const slo = ratioSlo({ ...REVEAL, samples: 10, passing: 8, minRatio: 0.9 });
    expect(slo.state).toBe("breached");
    expect(slo.ok).toBe(false);
    expect(slo.observed).toBe("80.0%");
  });

  it("treats the target as inclusive", () => {
    expect(ratioSlo({ ...REVEAL, samples: 10, passing: 9, minRatio: 0.9 }).state).toBe("met");
  });

  it("never publishes the raw sample count", () => {
    const slo = ratioSlo({ ...REVEAL, samples: 137, passing: 130, minRatio: 0.9 });
    expect(JSON.stringify(slo)).not.toContain("137");
  });
});

describe("thresholdSlo", () => {
  const LCP = { id: "playback_lcp", name: "Playback LCP", target: "p75 ≤ 4000 ms" };

  it("reports no_data when the rollup is empty", () => {
    const slo = thresholdSlo({ ...LCP, value: null, max: 4000, unit: "ms" });
    expect(slo.state).toBe("no_data");
    expect(slo.ok).toBe(false);
  });

  it("reports met at or under the maximum and breached above it", () => {
    expect(thresholdSlo({ ...LCP, value: 4000, max: 4000, unit: "ms" }).state).toBe("met");
    expect(thresholdSlo({ ...LCP, value: 4001, max: 4000, unit: "ms" }).observed).toBe("4001 ms");
    expect(thresholdSlo({ ...LCP, value: 4001, max: 4000, unit: "ms" }).state).toBe("breached");
  });

  it("rejects a non-finite measurement rather than trusting it", () => {
    expect(thresholdSlo({ ...LCP, value: Number.NaN, max: 4000, unit: "ms" }).state).toBe("no_data");
  });
});

describe("zeroToleranceSlo", () => {
  const AUDIT = { id: "audit_chain", name: "Audit chain integrity", target: "0 broken rows" };

  it("is met only at exactly zero", () => {
    expect(zeroToleranceSlo({ ...AUDIT, count: 0 }).state).toBe("met");
    expect(zeroToleranceSlo({ ...AUDIT, count: 1 }).state).toBe("breached");
  });

  it("is an error — never met — when the check could not run", () => {
    const slo = zeroToleranceSlo({ ...AUDIT, count: null });
    expect(slo.state).toBe("error");
    expect(slo.ok).toBe(false);
  });

  it("does not publish how many rows are broken", () => {
    expect(zeroToleranceSlo({ ...AUDIT, count: 12 }).observed).toBe("≥1");
  });
});

describe("summarise", () => {
  const met = ratioSlo({ ...REVEAL, samples: 10, passing: 10, minRatio: 0.9 });
  const breached = ratioSlo({ ...REVEAL, samples: 10, passing: 1, minRatio: 0.9 });
  const noData = ratioSlo({ ...REVEAL, samples: 0, passing: 0, minRatio: 0.9 });
  const errored = erroredSlo(REVEAL.id, REVEAL.name, REVEAL.target);

  it("is ok + 200 only when everything was measured and met", () => {
    expect(summarise([met, met])).toMatchObject({ status: "ok", httpStatus: 200 });
  });

  it("is partial + 200 when evidence is missing but nothing is breached", () => {
    const s = summarise([met, noData]);
    expect(s.status).toBe("partial");
    // "We cannot tell yet" is honest, but it is not an outage — do not page.
    expect(s.httpStatus).toBe(200);
    expect(s.counts).toMatchObject({ met: 1, no_data: 1, breached: 0, error: 0 });
  });

  it("is degraded + 503 on a breach", () => {
    expect(summarise([met, breached])).toMatchObject({ status: "degraded", httpStatus: 503 });
  });

  it("is degraded + 503 when a probe failed", () => {
    expect(summarise([met, errored])).toMatchObject({ status: "degraded", httpStatus: 503 });
  });

  it("does not report an empty SLO table as healthy", () => {
    expect(summarise([]).status).toBe("degraded");
  });
});

/* ------------------------------------------------------------------ *
 * Route level: the same three answers, end to end over mocked data.
 * ------------------------------------------------------------------ */

type QueryResult = { data: unknown; error: unknown };

const dbState: {
  auditChain: QueryResult;
  revealJobs: QueryResult;
  alerts: QueryResult;
  webVitals: QueryResult;
} = {
  auditChain: { data: [], error: null },
  revealJobs: { data: [], error: null },
  alerts: { data: [], error: null },
  webVitals: { data: null, error: null },
};

/** Minimal thenable PostgREST-style builder: every filter returns itself. */
function builder(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lt", "in", "not", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = async () => result;
  chain.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

jest.mock("next/cache", () => ({
  // The route wraps its probe in unstable_cache; run it straight through.
  unstable_cache: (fn: () => unknown) => fn,
}));

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    rpc: async () => dbState.auditChain,
    from: (table: string) => {
      if (table === "reveal_jobs") return builder(dbState.revealJobs);
      if (table === "alerts") return builder(dbState.alerts);
      if (table === "web_vitals_p75") return builder(dbState.webVitals);
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require("@/app/api/slo-status/route") as { GET: () => Promise<Response> };

type Body = {
  status: string;
  counts: Record<string, number>;
  slos: Array<{ id: string; state: string; ok: boolean; observed: string | null }>;
};

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

describe("GET /api/slo-status", () => {
  beforeEach(() => {
    dbState.auditChain = { data: [], error: null };
    dbState.revealJobs = { data: [], error: null };
    dbState.alerts = { data: [], error: null };
    dbState.webVitals = { data: null, error: null };
  });

  it("answers 200 partial — not 100% green — when there is nothing to measure", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;

    expect(body.status).toBe("partial");
    const measurable = body.slos.filter((s) => s.id !== "audit_chain");
    expect(measurable.every((s) => s.state === "no_data")).toBe(true);
    expect(measurable.every((s) => s.ok === false)).toBe(true);
    // The exact regression: a fabricated "100.0%" with zero samples.
    expect(JSON.stringify(body)).not.toContain("100.0%");
    expect(JSON.stringify(body)).not.toContain("samples");
  });

  it("answers 200 ok once every SLO has enough evidence and meets its target", async () => {
    dbState.revealJobs = {
      data: Array.from({ length: 6 }, () => ({
        status: "completed",
        approved_at: minutesAgo(10),
        completed_at: minutesAgo(9),
      })),
      error: null,
    };
    dbState.alerts = {
      data: Array.from({ length: 6 }, () => ({
        created_at: minutesAgo(10),
        face_id: "f",
        faces: { detected_at: minutesAgo(10) },
      })),
      error: null,
    };
    dbState.webVitals = { data: { metric: "LCP", page: "/playback", p75: 1800 }, error: null };

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.status).toBe("ok");
    expect(body.counts.met).toBe(4);
    expect(body.slos.every((s) => s.ok)).toBe(true);
  });

  it("answers 503 degraded when an SLO is breached", async () => {
    dbState.revealJobs = {
      data: Array.from({ length: 6 }, () => ({
        status: "completed",
        approved_at: minutesAgo(60),
        completed_at: minutesAgo(10), // 50 min — way past the 5 min target
      })),
      error: null,
    };

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as Body;
    expect(body.status).toBe("degraded");
    expect(body.slos.find((s) => s.id === "reveal_turnaround")).toMatchObject({
      state: "breached",
      ok: false,
      observed: "0.0%",
    });
  });

  it("answers 503 degraded when the audit-chain check itself fails", async () => {
    dbState.auditChain = { data: null, error: { message: "boom" } };

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as Body;
    expect(body.slos.find((s) => s.id === "audit_chain")).toMatchObject({ state: "error", ok: false });
  });
});
