import { NextRequest } from "next/server";
import { authorizeCron } from "@/lib/auth/cron";

function req(bearer?: string) {
  return new NextRequest("http://localhost/api/cron/x", {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

describe("authorizeCron", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("accepts either configured secret", () => {
    process.env.CRON_SECRET = "cron-secret"; // pragma: allowlist secret
    process.env.MONITORING_CRON_SECRET = "monitor-secret"; // pragma: allowlist secret
    expect(authorizeCron(req("cron-secret"))).toBe(true);
    expect(authorizeCron(req("monitor-secret"))).toBe(true);
    expect(authorizeCron(req("wrong"))).toBe(false);
    expect(authorizeCron(req())).toBe(false);
  });

  it("fails closed in production when nothing is configured", () => {
    delete process.env.CRON_SECRET;
    delete process.env.MONITORING_CRON_SECRET;
    process.env.VERCEL_ENV = "production";
    expect(authorizeCron(req("anything"))).toBe(false);
  });

  it("is permissive only outside production when unset", () => {
    delete process.env.CRON_SECRET;
    delete process.env.MONITORING_CRON_SECRET;
    delete process.env.VERCEL_ENV;
    Reflect.set(process.env, "NODE_ENV", "test");
    expect(authorizeCron(req())).toBe(true);
  });
});
