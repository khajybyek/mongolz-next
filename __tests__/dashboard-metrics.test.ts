/** @jest-environment node */
/**
 * The shaping behind every operator-facing figure (audit 2026-09-08, #16).
 *
 * Three separate bugs are pinned here:
 *   1. a failed or RLS-denied read rendering as a confident `0`,
 *   2. a capped sample rendering as a total,
 *   3. day buckets cut in UTC underneath KST labels.
 */
import {
  anyDenied,
  anyErrored,
  bucketByKstDay,
  deltaPct,
  formatMetric,
  isDeniedError,
  isMissingFunctionError,
  kstDayKey,
  kstDayKeys,
  kstStartOfDayBeforeISO,
  kstStartOfDayISO,
  metricNumber,
  metricRows,
  readMfaOk,
  readScope,
  rpcRow,
  rpcRows,
  shapeCount,
  shapeRows,
  type RpcCapableClient,
} from "@/lib/metrics";

describe("shapeCount — an unreadable number is never a zero", () => {
  it("returns the value when the read succeeded", () => {
    const m = shapeCount({ count: 42, error: null }, true);
    expect(m).toEqual({ state: "ok", value: 42 });
    expect(formatMetric(m, "en-US")).toBe("42");
    expect(metricNumber(m)).toBe(42);
  });

  it("keeps a genuine zero as a zero when the caller may read the table", () => {
    expect(shapeCount({ count: 0, error: null }, true)).toEqual({ state: "ok", value: 0 });
  });

  it("does NOT render an errored count as zero", () => {
    const m = shapeCount({ count: null, error: { code: "08006", message: "connection failure" } }, true);
    expect(m.state).toBe("error");
    expect(metricNumber(m)).toBeNull();
    expect(formatMetric(m)).toBe("—");
  });

  it("does NOT render a denied count as zero — RLS answers with an empty set, not an error", () => {
    // This is the viewer-on-/dashboard case: `faces` is admin-only, so the
    // count comes back 0 with no error at all.
    const m = shapeCount({ count: 0, error: null }, false);
    expect(m).toEqual({ state: "denied" });
    expect(formatMetric(m)).toBe("—");
  });

  it("treats an explicit 42501 refusal as denied, not as a failure", () => {
    const m = shapeCount({ count: null, error: { code: "42501", message: "forbidden: admin only" } }, true);
    expect(m).toEqual({ state: "denied" });
  });

  it("treats a missing count header as an error rather than zero", () => {
    expect(shapeCount({ count: null, error: null }, true).state).toBe("error");
  });

  it("lets real rows override a stale access map (a positive count proves the read)", () => {
    // If the policies are widened without updating readScope(), the figure
    // must under-claim access, never fabricate a zero.
    expect(shapeCount({ count: 7, error: null }, false)).toEqual({ state: "ok", value: 7 });
  });

  it("anyErrored / anyDenied drive the page-level banner", () => {
    const ok = shapeCount({ count: 1, error: null }, true);
    const denied = shapeCount({ count: 0, error: null }, false);
    const failed = shapeCount({ count: null, error: null }, true);
    expect(anyErrored(ok, denied)).toBe(false);
    expect(anyErrored(ok, failed)).toBe(true);
    expect(anyDenied(ok, denied)).toBe(true);
    expect(anyDenied(ok, failed)).toBe(false);
  });
});

describe("shapeRows — a page of rows is not a population", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

  it("flags a result that fills the cap as capped", () => {
    const m = shapeRows({ data: rows(500), error: null }, true, { limit: 500 });
    expect(m).toMatchObject({ state: "ok", capped: true });
    expect(metricRows(m)).toHaveLength(500);
  });

  it("does not flag a short result", () => {
    expect(shapeRows({ data: rows(499), error: null }, true, { limit: 500 })).toMatchObject({
      state: "ok",
      capped: false,
    });
  });

  it("reports denied instead of an empty list when the table is closed", () => {
    expect(shapeRows({ data: [], error: null }, false, { limit: 8 })).toEqual({ state: "denied" });
  });

  it("reports an empty-but-readable table as an empty list", () => {
    expect(shapeRows({ data: [], error: null }, true)).toEqual({ state: "ok", rows: [], capped: false });
  });

  it("never lets a filled calendar stand in for access (rowsProveAccess: false)", () => {
    // alerts_daily_kst returns 14 zero-filled days even when RLS withheld
    // every underlying row — those rows must not read as "access granted".
    const calendar = [
      { day_kst: "2026-09-08", n_total: 0 },
      { day_kst: "2026-09-09", n_total: 0 },
    ];
    expect(shapeRows({ data: calendar, error: null }, false, { rowsProveAccess: false })).toEqual({
      state: "denied",
    });
    expect(shapeRows({ data: calendar, error: null }, true, { rowsProveAccess: false })).toMatchObject({
      state: "ok",
    });
  });

  it("surfaces a query failure as an error state", () => {
    expect(shapeRows({ data: null, error: { message: "boom" } }, true).state).toBe("error");
  });
});

describe("error classification", () => {
  it("recognises refusals", () => {
    expect(isDeniedError({ code: "42501", message: "permission denied for table faces" })).toBe(true);
    expect(isDeniedError({ message: "forbidden: second factor required" })).toBe(true);
    expect(isDeniedError({ code: "08006", message: "connection failure" })).toBe(false);
    expect(isDeniedError(null)).toBe(false);
  });

  it("recognises a missing aggregate (migration not applied yet)", () => {
    expect(isMissingFunctionError({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(isMissingFunctionError({ code: "42883", message: "function does not exist" })).toBe(true);
    // A refusal is not a deploy gap.
    expect(isMissingFunctionError({ code: "42501", message: "forbidden" })).toBe(false);
  });
});

describe("readScope — the app-tier mirror of the SELECT policies", () => {
  it("gives an admin every reporting table", () => {
    expect(readScope("admin", true)).toEqual({
      faces: true,
      suspects: true,
      alerts: true,
      recordings: true,
      cameras: true,
      audit_log: true,
    });
  });

  it("closes the admin-only tables to a viewer (the fabricated-zero case)", () => {
    const s = readScope("viewer", true);
    expect(s.faces).toBe(false);
    expect(s.suspects).toBe(false);
    expect(s.alerts).toBe(false);
    // A viewer operates cameras and recordings, scoped by camera permissions.
    expect(s.cameras).toBe(true);
    expect(s.recordings).toBe(true);
  });

  it("gives an auditor the audit log only", () => {
    const s = readScope("auditor", true);
    expect(s.audit_log).toBe(true);
    expect(s.faces).toBe(false);
    expect(s.cameras).toBe(false);
  });

  it("closes everything when the session never proved the second factor", () => {
    // 20260908110000 attaches mfa_ok() as a restrictive policy: the admin's
    // reads come back empty, and empty must not print as zero.
    expect(readScope("admin", false)).toEqual({
      faces: false,
      suspects: false,
      alerts: false,
      recordings: false,
      cameras: false,
      audit_log: false,
    });
  });

  it("closes everything for an unknown role", () => {
    expect(Object.values(readScope(null, true)).every((v) => v === false)).toBe(true);
  });
});

describe("readMfaOk — fails open exactly like private.mfa_ok()", () => {
  const client = (reply: unknown): RpcCapableClient => ({
    rpc: async () => reply as { data: unknown; error: null },
  });

  it("reads mfa_ok: false from a single-row reply", async () => {
    await expect(readMfaOk(client({ data: { mfa_ok: false }, error: null }))).resolves.toBe(false);
  });

  it("reads a SETOF-shaped reply", async () => {
    await expect(readMfaOk(client({ data: [{ mfa_ok: false }], error: null }))).resolves.toBe(false);
  });

  it("accepts a proven session", async () => {
    await expect(readMfaOk(client({ data: { mfa_ok: true }, error: null }))).resolves.toBe(true);
  });

  it("fails open when the diagnostic is missing or broken", async () => {
    await expect(readMfaOk(client({ data: null, error: { code: "PGRST202" } }))).resolves.toBe(true);
    await expect(readMfaOk(client({ data: "nonsense", error: null }))).resolves.toBe(true);
    const thrower: RpcCapableClient = {
      rpc: async () => {
        throw new Error("network");
      },
    };
    await expect(readMfaOk(thrower)).resolves.toBe(true);
  });
});

describe("rpcRows / rpcRow", () => {
  it("normalises a single object into a one-row list", async () => {
    const c: RpcCapableClient = { rpc: async () => ({ data: { n_total: 3 }, error: null }) };
    await expect(rpcRows(c, "alerts_severity_kst")).resolves.toEqual({ data: [{ n_total: 3 }], error: null });
    await expect(rpcRow(c, "alerts_severity_kst")).resolves.toEqual({ data: { n_total: 3 }, error: null });
  });

  it("turns a throw into an error reply instead of a rejected page render", async () => {
    const c: RpcCapableClient = {
      rpc: async () => {
        throw new Error("socket hang up");
      },
    };
    const res = await rpcRows(c, "alerts_daily_kst", { p_days: 14 });
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe("socket hang up");
  });
});

describe("Asia/Seoul bucketing", () => {
  // 16:00Z is 01:00 the next morning in Seoul. Every timestamp on screen is
  // rendered in KST, so this instant belongs to the NEXT day's bucket.
  const lateUtc = "2026-09-08T16:00:00Z";

  it("puts an 01:00 KST event in the KST day, not the UTC one", () => {
    expect(kstDayKey(lateUtc)).toBe("2026-09-09");
    expect(new Date(lateUtc).toISOString().slice(0, 10)).toBe("2026-09-08"); // the old, wrong bucket
  });

  it("keeps the last minute before KST midnight in the previous day", () => {
    expect(kstDayKey("2026-09-08T14:59:59Z")).toBe("2026-09-08");
    expect(kstDayKey("2026-09-08T15:00:00Z")).toBe("2026-09-09");
  });

  it("start of day is 15:00Z the day before", () => {
    expect(kstStartOfDayISO(new Date(lateUtc))).toBe("2026-09-08T15:00:00.000Z");
    expect(kstStartOfDayBeforeISO(6, new Date(lateUtc))).toBe("2026-09-02T15:00:00.000Z");
  });

  it("returns an ascending, gap-free run of KST day keys", () => {
    expect(kstDayKeys(3, new Date("2026-09-09T05:00:00Z"))).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
    ]);
  });

  it("buckets a KST-boundary event into the right day", () => {
    const buckets = bucketByKstDay([lateUtc], 2, new Date("2026-09-09T05:00:00Z"));
    expect(buckets).toEqual([
      { day: "2026-09-08", count: 0 },
      { day: "2026-09-09", count: 1 },
    ]);
  });

  it("fills empty days with zero and ignores rows outside the window", () => {
    const buckets = bucketByKstDay(
      ["2026-09-09T00:30:00Z", "2026-08-01T00:00:00Z"],
      2,
      new Date("2026-09-09T05:00:00Z"),
    );
    expect(buckets.map((b) => b.count)).toEqual([0, 1]);
  });

  it("ignores an unparseable timestamp instead of counting it somewhere", () => {
    const buckets = bucketByKstDay(["not-a-date"], 1, new Date("2026-09-09T05:00:00Z"));
    expect(buckets).toEqual([{ day: "2026-09-09", count: 0 }]);
  });
});

describe("deltaPct", () => {
  it("computes a percentage against the previous window", () => {
    expect(deltaPct(12, 10)).toBe(20);
    expect(deltaPct(8, 10)).toBe(-20);
  });

  it("reports no baseline rather than an infinite jump", () => {
    expect(deltaPct(5, 0)).toBeNull();
    expect(deltaPct(0, 0)).toBe(0);
  });
});
