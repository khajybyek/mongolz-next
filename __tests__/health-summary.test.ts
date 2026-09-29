/**
 * The /health headline must not say "All systems operational" while the ML
 * build ignores privacy schedules (ADR 0012) — the card that says so may be
 * below the fold.
 */
import { healthLevel, type ProbeStatus } from "@/lib/health-summary";

describe("healthLevel", () => {
  const allOk: ProbeStatus[] = ["ok", "ok", "ok", "ok", "ok"];

  it("is ok only when every probe is ok and enforcement is confirmed", () => {
    expect(healthLevel(allOk, "enforced")).toBe("ok");
    expect(healthLevel(allOk)).toBe("ok"); // no privacy input (older callers)
  });

  it("treats schedules that are not enforced as an error, even with every probe green", () => {
    expect(healthLevel(allOk, "not_enforced")).toBe("error");
  });

  it("says so before the client probes answer", () => {
    expect(healthLevel([], "not_enforced")).toBe("error");
    expect(healthLevel([], "enforced")).toBe("checking");
    expect(healthLevel([], "unreachable")).toBe("checking");
    expect(healthLevel([])).toBe("checking");
  });

  it("treats unreadable enforcement as degraded", () => {
    expect(healthLevel(allOk, "unreachable")).toBe("degraded");
  });

  it("keeps the probe rules: any error → error, any degraded → degraded", () => {
    expect(healthLevel(["ok", "error", "degraded"], "enforced")).toBe("error");
    expect(healthLevel(["ok", "degraded"], "enforced")).toBe("degraded");
    expect(healthLevel(["ok", "loading"], "enforced")).toBe("degraded");
  });
});
