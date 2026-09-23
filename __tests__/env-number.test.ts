import { positiveNumberEnv } from "@/lib/env-number";
import { resolveThreshold } from "@/app/api/monitoring/error-rate/window";

describe("positiveNumberEnv (ANOMALY_THRESHOLD)", () => {
  it.each([undefined, "", "   ", "abc", "0", "-2", "NaN", "Infinity"])("%p falls back to the default", (raw) => {
    expect(positiveNumberEnv(raw, 3)).toBe(3);
  });

  it("keeps a real positive value", () => {
    expect(positiveNumberEnv("2.5", 3)).toBe(2.5);
  });
});

it("the documented SENTRY_ERROR_RATE_THRESHOLD example means a 10 % uplift", () => {
  // .env.example used to say 5 — which resolveThreshold reads as a 6x spike.
  expect(resolveThreshold("0.10")).toBeCloseTo(0.1);
});
