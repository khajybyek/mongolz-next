import {
  PRODUCTION_SECRETS,
  isProductionRuntime,
  missingProductionSecrets,
} from "@/lib/env-check";

function allSet(): Record<string, string | undefined> {
  return Object.fromEntries(PRODUCTION_SECRETS.map((s) => [s.name, `value-of-${s.name}`]));
}

describe("PRODUCTION_SECRETS", () => {
  it("covers the fail-closed signing secrets and service credentials", () => {
    const names = PRODUCTION_SECRETS.map((s) => s.name);
    for (const expected of [
      "REAUTH_COOKIE_SECRET",
      "SESSION_PIN_SECRET",
      "STREAM_TICKET_SECRET",
      "CAMERA_URL_KEY",
      "ML_SERVICE_TOKEN",
      "SUPABASE_SERVICE_ROLE_KEY",
      "CRON_SECRET",
    ]) {
      expect(names).toContain(expected);
    }
    for (const s of PRODUCTION_SECRETS) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.purpose.length).toBeGreaterThan(0);
    }
  });
});

describe("missingProductionSecrets", () => {
  it("returns [] when every production secret is set", () => {
    expect(missingProductionSecrets(allSet())).toEqual([]);
  });

  it("reports unset, empty and whitespace-only values as missing", () => {
    const env = allSet();
    delete env.CRON_SECRET;
    env.REAUTH_COOKIE_SECRET = "";
    env.STREAM_TICKET_SECRET = "   \t";
    expect(missingProductionSecrets(env).sort()).toEqual(
      ["CRON_SECRET", "REAUTH_COOKIE_SECRET", "STREAM_TICKET_SECRET"].sort(),
    );
  });

  it("lists every secret, in catalogue order, when the env is empty", () => {
    expect(missingProductionSecrets({})).toEqual(PRODUCTION_SECRETS.map((s) => s.name));
  });

  it("never includes secret values — only names", () => {
    const env = allSet();
    env.SESSION_PIN_SECRET = "";
    const out = JSON.stringify(missingProductionSecrets(env));
    expect(out).toContain("SESSION_PIN_SECRET");
    for (const v of Object.values(env)) {
      if (v) expect(out).not.toContain(v);
    }
    expect(out).not.toContain("value-of-");
  });

  it("reads process.env by default", () => {
    const saved = { ...process.env };
    try {
      for (const s of PRODUCTION_SECRETS) process.env[s.name] = "x";
      expect(missingProductionSecrets()).toEqual([]);
      delete process.env.CAMERA_URL_KEY;
      expect(missingProductionSecrets()).toEqual(["CAMERA_URL_KEY"]);
    } finally {
      process.env = { ...saved };
    }
  });
});

describe("isProductionRuntime", () => {
  it("is true for VERCEL_ENV=production", () => {
    expect(isProductionRuntime({ VERCEL_ENV: "production", NODE_ENV: "development" })).toBe(true);
  });

  it("is true for NODE_ENV=production", () => {
    expect(isProductionRuntime({ NODE_ENV: "production" })).toBe(true);
  });

  it("is false for development, preview and an empty env", () => {
    expect(isProductionRuntime({ NODE_ENV: "development" })).toBe(false);
    expect(isProductionRuntime({ VERCEL_ENV: "preview", NODE_ENV: "development" })).toBe(false);
    expect(isProductionRuntime({ NODE_ENV: "test" })).toBe(false);
    expect(isProductionRuntime({})).toBe(false);
  });

  it("reads process.env by default", () => {
    const saved = { ...process.env };
    try {
      process.env.VERCEL_ENV = "production";
      expect(isProductionRuntime()).toBe(true);
      delete process.env.VERCEL_ENV;
      Reflect.set(process.env, "NODE_ENV", "test");
      expect(isProductionRuntime()).toBe(false);
    } finally {
      process.env = { ...saved };
    }
  });
});
