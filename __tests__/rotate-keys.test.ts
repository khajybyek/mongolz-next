/** @jest-environment node */
/**
 * The rotation script's job is to produce a value the CONSUMER can parse.
 * These tests run the generated values through the real parsers — including a
 * real CPython interpreter for `ML_ENCRYPTION_KEY`, because that is the one
 * that took the ML service down: `randomBytes(32).toString("base64url")` is
 * 43 unpadded characters and `base64.urlsafe_b64decode` raises on it.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextRequest } from "next/server";

import {
  SPECS,
  MANUAL_KEYS,
  generateSecret,
  padBase64,
  pythonUrlsafeB64Decode,
  readEnvValue,
  rotationAuditRow,
  validateSecret,
  verifyWithPython,
} from "@/scripts/rotate-keys";

const REPO = join(__dirname, "..");
const VENV_PYTHON = join(REPO, "ml-service", "venv.nosync", "bin", "python");

/**
 * Runs the *actual* `crypto_utils._parse_b64_key` when the ML venv is around
 * (it needs `cryptography`), otherwise falls back to a stock interpreter
 * applying the same `base64.urlsafe_b64decode` rule. Returns null when no
 * interpreter is available so CI without Python still runs the rest.
 */
function parseWithMlService(value: string): boolean | null {
  if (!existsSync(VENV_PYTHON)) return null;
  const program = [
    "import sys",
    `sys.path.insert(0, ${JSON.stringify(join(REPO, "ml-service"))})`,
    "from crypto_utils import _parse_b64_key",
    "raw = sys.stdin.read().strip()",
    "sys.exit(0 if _parse_b64_key(raw, 'ML_ENCRYPTION_KEY') is not None else 3)",
  ].join("\n");
  try {
    execFileSync(VENV_PYTHON, ["-c", program], { input: value, stdio: ["pipe", "ignore", "ignore"] });
    return true;
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 3) return false;
    return null; // interpreter unusable (missing deps) — not a verdict
  }
}

describe("generateSecret / validateSecret", () => {
  it("produces a value every spec's own consumer accepts", () => {
    for (const spec of Object.values(SPECS)) {
      const value = generateSecret(spec);
      const result = validateSecret(spec, value);
      expect({ key: spec.name, ok: result.ok, reason: result.reason }).toEqual({
        key: spec.name,
        ok: true,
        reason: undefined,
      });
      expect(result.checks.length).toBeGreaterThan(0);
    }
  });

  it("never emits the same value twice", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateSecret(SPECS.ML_ENCRYPTION_KEY)));
    expect(seen.size).toBe(50);
  });

  it("ML_ENCRYPTION_KEY comes out padded — CPython rejects the unpadded form", () => {
    const value = generateSecret(SPECS.ML_ENCRYPTION_KEY);
    expect(value).toHaveLength(44);
    expect(value.endsWith("=")).toBe(true);
    expect(pythonUrlsafeB64Decode(value)).toHaveLength(32);

    // The exact value the old script shipped.
    const legacy = randomBytes(32).toString("base64url");
    expect(legacy).toHaveLength(43);
    expect(pythonUrlsafeB64Decode(legacy)).toBeNull();

    const rejected = validateSecret(SPECS.ML_ENCRYPTION_KEY, legacy);
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toMatch(/padding|alphabet|raise/i);
  });

  it("round-trips ML_ENCRYPTION_KEY through the real Python parser", () => {
    const value = generateSecret(SPECS.ML_ENCRYPTION_KEY);
    const viaMl = parseWithMlService(value);
    if (viaMl !== null) {
      expect(viaMl).toBe(true);
      expect(parseWithMlService(randomBytes(32).toString("base64url"))).toBe(false);
      return;
    }
    const viaStock = verifyWithPython(value, 32);
    if (viaStock === "unavailable") {
      console.warn("no Python interpreter available — skipped the CPython round-trip");
      return;
    }
    expect(viaStock).toBe("ok");
    expect(verifyWithPython(randomBytes(32).toString("base64url"), 32)).toBe("rejected");
  });

  it("CAMERA_URL_KEY decodes to 32 bytes and survives a camera-crypto round-trip", () => {
    const value = generateSecret(SPECS.CAMERA_URL_KEY);
    expect(Buffer.from(value, "base64")).toHaveLength(32);
    const result = validateSecret(SPECS.CAMERA_URL_KEY, value);
    expect(result.ok).toBe(true);
    expect(result.checks.join(" ")).toMatch(/camera-crypto/);
    // A short key must be refused, not silently accepted by Buffer's laxness.
    expect(validateSecret(SPECS.CAMERA_URL_KEY, randomBytes(31).toString("base64")).ok).toBe(false);
  });

  it("STREAM_TICKET_SECRET issues a ticket that verifies, and leaves env untouched", () => {
    const before = process.env.STREAM_TICKET_SECRET;
    const result = validateSecret(SPECS.STREAM_TICKET_SECRET, generateSecret(SPECS.STREAM_TICKET_SECRET));
    expect(result.ok).toBe(true);
    expect(process.env.STREAM_TICKET_SECRET).toBe(before);
  });

  it("refuses weak or malformed values for the opaque HMAC keys", () => {
    expect(validateSecret(SPECS.SESSION_PIN_SECRET, "short").ok).toBe(false);
    expect(validateSecret(SPECS.REAUTH_COOKIE_SECRET, "has space in it").ok).toBe(false);
    expect(validateSecret(SPECS.REAUTH_COOKIE_SECRET, "").ok).toBe(false);
    expect(validateSecret(SPECS.REAUTH_COOKIE_SECRET, randomBytes(16).toString("base64url")).ok).toBe(false);
  });
});

describe("pythonUrlsafeB64Decode", () => {
  it("mirrors CPython, not Node's forgiving decoder", () => {
    const key = randomBytes(32);
    expect(pythonUrlsafeB64Decode(padBase64(key.toString("base64url")))).toEqual(key);
    expect(pythonUrlsafeB64Decode(key.toString("base64"))).toEqual(key);
    // Node accepts all of these; CPython does not.
    expect(pythonUrlsafeB64Decode(key.toString("base64url"))).toBeNull(); // no padding
    expect(pythonUrlsafeB64Decode("!!!!")).toBeNull(); // outside the alphabet
    expect(pythonUrlsafeB64Decode("")).toBeNull();
  });

  it("padBase64 only adds what is missing", () => {
    expect(padBase64("AAAA")).toBe("AAAA");
    expect(padBase64("AAA")).toBe("AAA=");
    expect(padBase64("AA")).toBe("AA==");
  });
});

describe("readEnvValue", () => {
  it("tells a withheld value apart from a missing one", () => {
    // What `vercel env pull` actually writes for a project variable — the
    // variable exists, the CLI just will not disclose it. Reading that as
    // "not set" is what let a dual-key rotation skip the PREV slot.
    expect(readEnvValue('CAMERA_URL_KEY=""\nOTHER="x"\n', "CAMERA_URL_KEY")).toEqual({
      value: null,
      reason: "not-disclosed",
    });
    expect(readEnvValue('OTHER="x"\n', "CAMERA_URL_KEY")).toEqual({ value: null, reason: "absent" });
  });

  it("unquotes both CLI dialects", () => {
    expect(readEnvValue('CAMERA_URL_KEY="abc="\n', "CAMERA_URL_KEY")).toEqual({ value: "abc=" });
    expect(readEnvValue("ML_ENCRYPTION_KEY=abc=\n", "ML_ENCRYPTION_KEY")).toEqual({ value: "abc=" });
    // A different variable that merely shares a prefix must not match.
    expect(readEnvValue("ML_ENCRYPTION_KEY_PREV=old\n", "ML_ENCRYPTION_KEY")).toEqual({
      value: null,
      reason: "absent",
    });
  });
});

describe("rotation provenance", () => {
  it("writes the audit action the rotation cron reads, with no secret in it", () => {
    const row = rotationAuditRow("ML_ENCRYPTION_KEY", "khajybyek", { mode: "script", provider: "railway" });
    expect(row.action).toBe("ML_ENCRYPTION_KEY_ROTATED");
    expect(row.user_email).toBe("khajybyek");
    const detail = JSON.parse(row.detail);
    expect(detail).toEqual({ mode: "script", provider: "railway", operator: "khajybyek" });
  });

  it("every key the rotation cron watches can be recorded by the script", () => {
    // The cron's POLICIES list is private to the route module (Next.js route
    // files may only export handlers), so read the names from the source.
    const source = readFileSync(join(REPO, "app/api/cron/key-rotation-check/route.ts"), "utf8");
    const policies = [...source.matchAll(/\{\s*name:\s*"([A-Z_]+)",\s*maxAgeDays/g)].map((m) => m[1]);
    expect(policies.length).toBeGreaterThanOrEqual(7);

    const recordable = new Set([...Object.keys(SPECS), ...Object.keys(MANUAL_KEYS)]);
    const unrecordable = policies.filter((name) => !recordable.has(name));
    // A watched key that nothing can record is a warning the operator can
    // never clear — the exact bug this batch fixed.
    expect(unrecordable).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// The other half of the contract: the weekly cron has to be
// satisfiable by the rows the script writes.
// ─────────────────────────────────────────────────────────────

const cron: {
  rotations: { data: Array<{ action: string; created_at: string }>; error: { message: string } | null };
  inception: { data: { created_at: string } | null; error: { message: string } | null };
  inserted: Array<Record<string, unknown>>;
} = { rotations: { data: [], error: null }, inception: { data: null, error: null }, inserted: [] };

jest.mock("@/lib/auth/cron", () => ({ authorizeCron: () => true }));

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => {
      let mode: "inception" | "rotations" = "inception";
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        order: () => b,
        limit: () => b,
        in: () => {
          mode = "rotations";
          return b;
        },
        maybeSingle: async () => cron.inception,
        insert: async (row: Record<string, unknown>) => {
          cron.inserted.push(row);
          return { error: null };
        },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(mode === "rotations" ? cron.rotations : cron.inception).then(res, rej),
      });
      return b;
    },
  }),
}));

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 3600_000).toISOString();
}

async function runCron() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GET } = require("@/app/api/cron/key-rotation-check/route") as {
    GET: (req: NextRequest) => Promise<Response>;
  };
  const res = await GET({ headers: new Headers() } as unknown as NextRequest);
  return { status: res.status, body: await res.json() };
}

describe("GET /api/cron/key-rotation-check", () => {
  beforeEach(() => {
    cron.rotations = { data: [], error: null };
    cron.inception = { data: null, error: null };
    cron.inserted = [];
  });

  it("does not cry wolf on a young deployment that has never rotated", async () => {
    cron.inception = { data: { created_at: daysAgo(10) }, error: null };
    const { body } = await runCron();
    expect(body.status).toBe("ok");
    expect(body.report.every((r: { basis: string; due: boolean }) => r.basis === "inception" && !r.due)).toBe(true);
    expect(cron.inserted).toEqual([]);
  });

  it("reports a key as due once the deployment outlives its cadence, with the command that clears it", async () => {
    cron.inception = { data: { created_at: daysAgo(400) }, error: null };
    const { body } = await runCron();
    expect(body.status).toBe("due");

    const ml = body.report.find((r: { name: string }) => r.name === "ML_ENCRYPTION_KEY");
    expect(ml).toMatchObject({ due: true, basis: "inception", age_days: 400 });
    expect(ml.remediation).toBe("npm run rotate:keys -- --key=ML_ENCRYPTION_KEY");

    const token = body.report.find((r: { name: string }) => r.name === "ML_SERVICE_TOKEN");
    expect(token.remediation).toMatch(/--mark-rotated/);

    expect(cron.inserted).toHaveLength(1);
    expect(cron.inserted[0].action).toBe("KEY_ROTATION_DUE");
  });

  it("clears the warning for a key the rotation script recorded", async () => {
    cron.inception = { data: { created_at: daysAgo(400) }, error: null };
    // Exactly the row scripts/rotate-keys.ts writes.
    cron.rotations = {
      data: [
        { action: "ML_ENCRYPTION_KEY_ROTATED", created_at: daysAgo(3) },
        { action: "ML_ENCRYPTION_KEY_ROTATED", created_at: daysAgo(300) },
      ],
      error: null,
    };
    const { body } = await runCron();
    const ml = body.report.find((r: { name: string }) => r.name === "ML_ENCRYPTION_KEY");
    expect(ml).toMatchObject({ due: false, basis: "rotation", age_days: 3 });
    expect(ml.last_rotated_at).toBe(cron.rotations.data[0].created_at);
  });

  it("reports an unreadable audit_log as an error, not as seven overdue keys", async () => {
    cron.rotations = { data: [], error: { message: "connection reset" } };
    const { status, body } = await runCron();
    expect(status).toBe(500);
    expect(body.error).toBe("audit_log unreadable");
    expect(cron.inserted).toEqual([]);
  });

  it("treats an empty audit_log as unknown, not overdue", async () => {
    const { body } = await runCron();
    expect(body.status).toBe("ok");
    expect(body.report.every((r: { basis: string; due: boolean }) => r.basis === "unknown" && !r.due)).toBe(true);
  });
});
