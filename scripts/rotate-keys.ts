/**
 * Key rotation helper — generates a value the CONSUMER can actually parse,
 * records the rotation in `audit_log`, and refuses every step that could
 * destroy data it cannot prove is recoverable.
 *
 *   npx tsx scripts/rotate-keys.ts --list
 *   npx tsx scripts/rotate-keys.ts --key=STREAM_TICKET_SECRET
 *   npx tsx scripts/rotate-keys.ts --key=ML_ENCRYPTION_KEY --dry-run
 *   npx tsx scripts/rotate-keys.ts --key=ML_SERVICE_TOKEN --mark-rotated
 *   CAMERA_URL_KEY_CURRENT='<from your vault>' \
 *     npx tsx scripts/rotate-keys.ts --key=CAMERA_URL_KEY
 *   npx tsx scripts/rotate-keys.ts --key=CAMERA_URL_KEY --finalize
 *
 * `<NAME>_CURRENT` supplies the outgoing value for a dual-key rotation. It is
 * mandatory on Vercel, which does not disclose stored values (`vercel env
 * pull` writes `NAME=""` for every project variable), and optional on Railway,
 * whose CLI does return them.
 *
 * Three things this script is careful about, each of which was a real bug:
 *
 * 1. **Encoding.** Every secret used to be `randomBytes(32).toString(<enc>)`,
 *    so `ML_ENCRYPTION_KEY` came out as 43 unpadded base64url characters.
 *    `crypto_utils._parse_b64_key` calls `base64.urlsafe_b64decode`, which
 *    raises `binascii.Error: Incorrect padding` on an unpadded string — the
 *    key parsed as `None`, `init_master_key()` raised, and the ML service
 *    stayed down until somebody hand-padded the value. Each spec now names
 *    the parser that has to accept the value, and `generateSecret()` is
 *    validated against that parser before anything is written anywhere.
 *
 * 2. **Finalisation.** `--finalize` drops `<NAME>_PREV`. For `CAMERA_URL_KEY`
 *    that is verifiable (the rows are in the database and
 *    `isSealedWithPrevKey` answers the question), so finalising is gated on a
 *    live count of rows still under the old key. For `ML_ENCRYPTION_KEY` it is
 *    NOT verifiable from here — the recordings and the sealed face crops are
 *    only decryptable inside the ML container — and dropping the PREV key
 *    would permanently destroy every artifact still sealed under it. So the
 *    script refuses, and says what has to exist first.
 *
 * 3. **Provenance.** `/api/cron/key-rotation-check` reads `<NAME>_ROTATED`
 *    audit rows. Nothing ever wrote one, so every key was reported overdue
 *    forever. A successful rotation (and `--mark-rotated`, for the keys that
 *    can only be rotated by hand) now writes that row with the service role.
 */

import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Provider = "vercel" | "railway";

/**
 * How the value has to be shaped so its consumer can read it.
 *
 *  - `base64-padded`     standard alphabet, `=` padding — Node `Buffer.from(v, "base64")`
 *  - `base64url-padded`  URL-safe alphabet, `=` padding — Python `base64.urlsafe_b64decode`
 *  - `base64url`         URL-safe, unpadded — opaque HMAC key, never decoded
 */
export type KeyFormat = "base64-padded" | "base64url-padded" | "base64url";

export interface KeySpec {
  name: string;
  provider: Provider;
  format: KeyFormat;
  bytes: number;
  /** Dual-key slot; absent when the secret has no historical artifacts. */
  prevName?: string;
  /** The parser that has to accept the generated value. */
  consumer: string;
  /** How `--finalize` may drop `prevName`, if at all. */
  finalize?: "verified-by-db" | "refuse";
}

export const SPECS: Record<string, KeySpec> = {
  ML_ENCRYPTION_KEY: {
    name: "ML_ENCRYPTION_KEY",
    provider: "railway",
    // Python: base64.urlsafe_b64decode() — needs the padding, rejects 43 chars.
    format: "base64url-padded",
    bytes: 32,
    prevName: "ML_ENCRYPTION_KEY_PREV",
    consumer: "ml-service/crypto_utils.py::_parse_b64_key (base64.urlsafe_b64decode → 32 bytes)",
    finalize: "refuse",
  },
  CAMERA_URL_KEY: {
    name: "CAMERA_URL_KEY",
    provider: "vercel",
    format: "base64-padded",
    bytes: 32,
    prevName: "CAMERA_URL_KEY_PREV",
    consumer: "lib/camera-crypto.ts::parseKey (Buffer.from(v, 'base64') → 32 bytes)",
    finalize: "verified-by-db",
  },
  STREAM_TICKET_SECRET: {
    name: "STREAM_TICKET_SECRET",
    provider: "vercel",
    format: "base64url",
    bytes: 32,
    consumer: "lib/stream-ticket.ts (HMAC-SHA256 key — opaque string, never decoded)",
  },
  REAUTH_COOKIE_SECRET: {
    name: "REAUTH_COOKIE_SECRET",
    provider: "vercel",
    format: "base64url",
    bytes: 32,
    consumer: "lib/auth/hmac.ts (HMAC-SHA256 key — opaque string, never decoded)",
  },
  SESSION_PIN_SECRET: {
    name: "SESSION_PIN_SECRET",
    provider: "vercel",
    format: "base64url",
    bytes: 32,
    consumer: "lib/auth/session-pin.ts (HMAC-SHA256 key — opaque string, never decoded)",
  },
};

/**
 * Keys the rotation cron tracks that this script must NOT rotate on its own:
 * `ML_SERVICE_TOKEN` lives on Railway *and* Vercel (rotating one side alone
 * takes recording and reveal down), and `SUPABASE_SERVICE_ROLE_KEY` can only
 * be reissued from the Supabase dashboard. Rotate them by hand following
 * docs/RUNBOOK.md §4, then record it with `--mark-rotated`.
 *
 * Keep this list and POLICIES in app/api/cron/key-rotation-check/route.ts in
 * step: a name the cron watches but neither list can record is a warning the
 * operator can never clear.
 */
export const MANUAL_KEYS: Record<string, string> = {
  ML_SERVICE_TOKEN: "set on Railway AND Vercel together, then redeploy both",
  SUPABASE_SERVICE_ROLE_KEY: "reissue in the Supabase dashboard, then update Vercel + Railway",
};

// ─────────────────────────────────────────────────────────────
// Generation + validation against the real consumer
// ─────────────────────────────────────────────────────────────

export function generateSecret(spec: KeySpec): string {
  const raw = randomBytes(spec.bytes);
  switch (spec.format) {
    case "base64-padded":
      return raw.toString("base64");
    case "base64url-padded":
      // Node's base64url is unpadded; Python's urlsafe_b64decode requires the
      // padding. Add it back rather than shipping a value that cannot be read.
      return padBase64(raw.toString("base64url"));
    case "base64url":
      return raw.toString("base64url");
  }
}

export function padBase64(value: string): string {
  const remainder = value.length % 4;
  return remainder === 0 ? value : value + "=".repeat(4 - remainder);
}

/**
 * Python's `base64.urlsafe_b64decode`, reimplemented exactly enough to predict
 * whether CPython would accept the string. Node's decoder is far more
 * forgiving (it ignores padding and silently drops junk characters), so
 * `Buffer.from(v, "base64").length === 32` is NOT the same question.
 * Returns the decoded bytes, or null when CPython would raise.
 */
export function pythonUrlsafeB64Decode(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0) return null; // binascii: Incorrect padding
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const expected = (value.length / 4) * 3 - padding;
  const decoded = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return decoded.length === expected ? decoded : null;
}

export interface ValidationResult {
  ok: boolean;
  /** What was actually checked, for the operator's log. */
  checks: string[];
  reason?: string;
}

/**
 * Round-trip the generated value through the code that will read it in
 * production. A generator bug must fail here, on the operator's machine,
 * before the value reaches Railway or Vercel.
 */
export function validateSecret(spec: KeySpec, value: string): ValidationResult {
  const checks: string[] = [];
  const fail = (reason: string): ValidationResult => ({ ok: false, checks, reason });

  if (!value || /\s/.test(value)) return fail("value is empty or contains whitespace");

  switch (spec.name) {
    case "ML_ENCRYPTION_KEY": {
      const decoded = pythonUrlsafeB64Decode(value);
      if (!decoded) return fail("base64.urlsafe_b64decode() would raise (padding/alphabet)");
      if (decoded.length !== spec.bytes) return fail(`decodes to ${decoded.length} bytes, expected ${spec.bytes}`);
      checks.push(`base64.urlsafe_b64decode → ${decoded.length} bytes (CPython rules)`);
      const viaPython = verifyWithPython(value, spec.bytes);
      checks.push(`python3 crypto_utils parse: ${viaPython}`);
      if (viaPython === "rejected") return fail("the real Python parser rejected the value");
      return { ok: true, checks };
    }

    case "CAMERA_URL_KEY": {
      const decoded = Buffer.from(value, "base64");
      if (decoded.length !== spec.bytes) return fail(`decodes to ${decoded.length} bytes, expected ${spec.bytes}`);
      // Real round-trip through lib/camera-crypto with the candidate key.
      const restore = { key: process.env.CAMERA_URL_KEY, prev: process.env.CAMERA_URL_KEY_PREV };
      try {
        process.env.CAMERA_URL_KEY = value;
        delete process.env.CAMERA_URL_KEY_PREV;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const cc = require("../lib/camera-crypto") as typeof import("../lib/camera-crypto");
        const probe = "rtsp://rotation-self-test/stream";
        if (cc.decryptCameraUrl(cc.encryptCameraUrl(probe)) !== probe) {
          return fail("camera-crypto encrypt→decrypt round-trip did not return the input");
        }
        checks.push("lib/camera-crypto encrypt→decrypt round-trip");
      } catch (e) {
        return fail(`camera-crypto rejected the key: ${(e as Error).message}`);
      } finally {
        if (restore.key === undefined) delete process.env.CAMERA_URL_KEY;
        else process.env.CAMERA_URL_KEY = restore.key;
        if (restore.prev !== undefined) process.env.CAMERA_URL_KEY_PREV = restore.prev;
      }
      return { ok: true, checks };
    }

    case "STREAM_TICKET_SECRET": {
      const restore = process.env.STREAM_TICKET_SECRET;
      try {
        process.env.STREAM_TICKET_SECRET = value;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const st = require("../lib/stream-ticket") as typeof import("../lib/stream-ticket");
        const camera = "00000000-0000-4000-8000-000000000000";
        const ticket = st.issueStreamTicket("rotation-self-test", camera);
        if (!st.verifyStreamTicket(ticket, camera).valid) {
          return fail("stream ticket issued with the new secret did not verify");
        }
        checks.push("lib/stream-ticket issue→verify round-trip");
      } catch (e) {
        return fail(`stream-ticket rejected the secret: ${(e as Error).message}`);
      } finally {
        if (restore === undefined) delete process.env.STREAM_TICKET_SECRET;
        else process.env.STREAM_TICKET_SECRET = restore;
      }
      return { ok: true, checks };
    }

    default: {
      // Opaque HMAC keys (REAUTH_COOKIE_SECRET, SESSION_PIN_SECRET): the only
      // requirement is that the string survives an env round-trip and carries
      // the intended entropy.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { hmacEqual, hmacSign } = require("../lib/auth/hmac") as typeof import("../lib/auth/hmac");
      const sig = hmacSign(value, "rotation-self-test", "payload");
      if (!hmacEqual(sig, hmacSign(value, "rotation-self-test", "payload"))) {
        return fail("HMAC sign/verify round-trip failed");
      }
      const bits = decodedEntropyBits(value);
      if (bits < spec.bytes * 8) return fail(`carries ${bits} bits of entropy, expected ${spec.bytes * 8}`);
      checks.push(`lib/auth/hmac sign→verify round-trip (${bits}-bit key)`);
      return { ok: true, checks };
    }
  }
}

function decodedEntropyBits(value: string): number {
  // Both padded and unpadded base64/base64url decode identically in Node.
  return Buffer.from(value, "base64url").length * 8;
}

/**
 * Best-effort check through a real CPython interpreter. The value goes in on
 * stdin, never argv (argv is world-readable in `ps`). Returns "unavailable"
 * when no interpreter is around — that is not a failure, the pure-TS check
 * above already encodes the same rule.
 */
export function verifyWithPython(value: string, expectedBytes: number): "ok" | "rejected" | "unavailable" {
  const program = [
    "import base64,sys",
    "raw=sys.stdin.read().strip()",
    "try:",
    "    k=base64.urlsafe_b64decode(raw)",
    "except Exception:",
    "    sys.exit(3)",
    `sys.exit(0 if len(k)==${expectedBytes} else 3)`,
  ].join("\n");

  for (const python of pythonCandidates()) {
    try {
      execFileSync(python, ["-c", program], { input: value, stdio: ["pipe", "ignore", "ignore"] });
      return "ok";
    } catch (e) {
      const status = (e as { status?: number; code?: string }).status;
      if (status === 3) return "rejected";
      // ENOENT / not executable → try the next candidate.
    }
  }
  return "unavailable";
}

function pythonCandidates(): string[] {
  const venv = join(process.cwd(), "ml-service", "venv.nosync", "bin", "python");
  return existsSync(venv) ? [venv, "python3"] : ["python3"];
}

// ─────────────────────────────────────────────────────────────
// Provider plumbing
// ─────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
}
const hasFlag = (n: string) => process.argv.includes(`--${n}`);

/** Railway CLI is linked from the service directory, not the repo root. */
function railwayCwd(): string {
  const dir = join(process.cwd(), "ml-service");
  return existsSync(dir) ? dir : process.cwd();
}

/**
 * "Here it is", "there is none", "I am not allowed to tell you" and "I could
 * not ask" are four different answers, and collapsing them into `null` is how
 * a dual-key rotation silently becomes a one-way one: the old code overwrote
 * the active key while writing nothing to `<NAME>_PREV`, so everything sealed
 * with the outgoing value became unreadable.
 *
 * `not-disclosed` is the normal case on Vercel: `vercel env pull` writes
 * `NAME=""` for every project-defined variable (verified against this project
 * — all 30 of them come back empty). The outgoing value therefore has to come
 * from the operator's own vault via `<NAME>_CURRENT`.
 */
type ReadResult =
  | { ok: true; value: string }
  | { ok: true; value: null; reason: "absent" | "not-disclosed" }
  | { ok: false; error: string };

/** CLI failures must never carry the command's arguments — one of them is the secret. */
function cliError(file: string, verb: string, e: unknown): string {
  const status = (e as { status?: number; code?: string }).status ?? (e as { code?: string }).code;
  return `${file} ${verb} failed (${status ?? "no exit status"})`;
}

/**
 * Find `NAME=value` in a `railway variables --kv` dump or a pulled `.env`,
 * telling "no such variable" apart from "declared but withheld" (Vercel writes
 * `NAME=""` for everything it will not disclose).
 */
export function readEnvValue(
  text: string,
  name: string,
): { value: string } | { value: null; reason: "absent" | "not-disclosed" } {
  const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
  if (!line) return { value: null, reason: "absent" };
  let v = line.slice(name.length + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v ? { value: v } : { value: null, reason: "not-disclosed" };
}

function readCurrent(spec: KeySpec): ReadResult {
  // The operator's own copy always wins: on Vercel it is the ONLY way to get
  // the outgoing value, and on Railway it lets a rotation proceed while the
  // CLI is unavailable. Passed as an env var, never as argv.
  const supplied = (process.env[`${spec.name}_CURRENT`] ?? "").trim();
  if (supplied) return { ok: true, value: supplied };

  try {
    if (spec.provider === "railway") {
      const out = execFileSync("railway", ["variables", "--kv"], {
        cwd: railwayCwd(),
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
      const found = readEnvValue(out, spec.name);
      return { ok: true, ...found } as ReadResult;
    }
    // Repo-local (matched by `.env*.tmp` in .gitignore) because the Vercel CLI
    // resolves the target against the linked project directory. Removed in the
    // finally: the previous version left a file full of production secrets
    // behind whenever the parse threw.
    const file = ".env.rotation.tmp";
    try {
      execFileSync("vercel", ["env", "pull", file, "--environment=production", "--yes"], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      // Vercel writes `NAME=""` rather than disclosing a stored value — the
      // variable exists, we simply cannot read it back.
      const found = readEnvValue(readFileSync(file, "utf8"), spec.name);
      return { ok: true, ...found } as ReadResult;
    } finally {
      rmSync(file, { force: true });
    }
  } catch (e) {
    return { ok: false, error: cliError(spec.provider, "env read", e) };
  }
}

/**
 * Values are passed as argv elements / stdin, never interpolated into a shell
 * string: a base64 value contains `+` and `/`, and one day it will contain
 * something a shell cares about.
 */
function setRemote(spec: KeySpec, key: string, value: string, dryRun: boolean) {
  if (dryRun) {
    console.log(`  [dry-run] would set ${spec.provider}:${key} (value not printed)`);
    return;
  }
  if (spec.provider === "railway") {
    try {
      execFileSync("railway", ["variables", "--set", `${key}=${value}`], {
        cwd: railwayCwd(),
        stdio: ["ignore", "ignore", "inherit"],
      });
    } catch (e) {
      // Node puts the whole argv in the error message — which here contains
      // the secret. Re-throw without it.
      throw new Error(cliError("railway", `variables --set ${key}`, e));
    }
  } else {
    try {
      execFileSync("vercel", ["env", "rm", key, "production", "--yes"], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch {
      // not present yet — fine, `env add` below creates it
    }
    try {
      execFileSync("vercel", ["env", "add", key, "production"], {
        input: `${value}\n`,
        stdio: ["pipe", "ignore", "pipe"],
      });
    } catch (e) {
      throw new Error(cliError("vercel", `env add ${key}`, e));
    }
  }
}

/**
 * Opt-in export of the freshly generated value, because a provider that never
 * discloses it (Vercel) otherwise makes the NEXT dual-key rotation impossible.
 * Owner-only mode, exclusive create — this file belongs in a vault, not on a
 * laptop, so the caller is told to move and delete it.
 */
function emitNewValue(path: string, spec: KeySpec, value: string, dryRun: boolean) {
  if (dryRun) {
    console.log(`  [dry-run] would write the new ${spec.name} to ${path} (mode 0600)`);
    return;
  }
  if (existsSync(path)) throw new Error(`--emit target ${path} already exists — refusing to overwrite it`);
  writeFileSync(path, `${spec.name}=${value}\n`, { mode: 0o600, flag: "wx" });
  console.log(`  new value written to ${path} (mode 0600) — move it into the vault and delete the file.`);
}

function unsetRemote(spec: KeySpec, key: string, dryRun: boolean) {
  if (dryRun) {
    console.log(`  [dry-run] would unset ${spec.provider}:${key}`);
    return;
  }
  if (spec.provider === "railway") {
    execFileSync("railway", ["variables", "--unset", key], {
      cwd: railwayCwd(),
      stdio: ["ignore", "ignore", "inherit"],
    });
  } else {
    execFileSync("vercel", ["env", "rm", key, "production", "--yes"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Audit provenance — what makes the rotation cron truthful
// ─────────────────────────────────────────────────────────────

function loadLocalEnv(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { config } = require("dotenv") as typeof import("dotenv");
  if (existsSync(".env.production.tmp")) config({ path: ".env.production.tmp" });
  else if (existsSync(".env.local")) config({ path: ".env.local" });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — " +
        "pull them first: vercel env pull .env.production.tmp --environment=production",
    );
  }
  // `.env.local` in this repo points at a local `supabase start` stack. Writing
  // the rotation record there would report success while the production cron
  // kept warning — the rotation would look done and stay overdue forever.
  if (/localhost|127\.0\.0\.1|\[::1\]/.test(url) && process.env.ALLOW_LOCAL_SUPABASE !== "1") {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL points at a local Supabase — the rotation would be recorded in the wrong " +
        "database. Run: vercel env pull .env.production.tmp --environment=production  (or set ALLOW_LOCAL_SUPABASE=1)",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function rotationAuditRow(name: string, operator: string, detail: Record<string, unknown>) {
  return {
    action: `${name}_ROTATED`,
    // Never the value, never its length — only what happened.
    detail: JSON.stringify({ ...detail, operator }),
    user_email: operator,
  };
}

async function recordRotation(name: string, operator: string, detail: Record<string, unknown>): Promise<void> {
  const sb = serviceClient();
  const { error } = await sb.from("audit_log").insert(rotationAuditRow(name, operator, detail));
  if (error) throw new Error(error.message);
}

function manualAuditSql(name: string, operator: string): string {
  return (
    `INSERT INTO audit_log (action, detail, user_email) VALUES ` +
    `('${name}_ROTATED', 'rotated manually — operator: ${operator}', '${operator}');`
  );
}

// ─────────────────────────────────────────────────────────────
// Finalisation gates
// ─────────────────────────────────────────────────────────────

/** Rows still sealed under CAMERA_URL_KEY_PREV. Throws if it cannot tell. */
async function camerasUnderPrevKey(): Promise<{ total: number; underPrev: number }> {
  if (!process.env.CAMERA_URL_KEY) throw new Error("CAMERA_URL_KEY not set locally — cannot verify");
  if (!process.env.CAMERA_URL_KEY_PREV) throw new Error("CAMERA_URL_KEY_PREV not set locally — cannot verify");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cc = require("../lib/camera-crypto") as typeof import("../lib/camera-crypto");
  const sb = serviceClient();
  const { data, error } = await sb.from("cameras").select("id, url").not("url", "is", null);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const underPrev = rows.filter((r) => r.url && cc.isSealedWithPrevKey(r.url)).length;
  return { total: rows.length, underPrev };
}

const ML_FINALIZE_REFUSAL = `
  --finalize is REFUSED for ML_ENCRYPTION_KEY.

  Dropping ML_ENCRYPTION_KEY_PREV permanently destroys every artifact still
  sealed under it: encrypted recordings (recordings.original_path /
  storage_path), the per-face envelopes of face-encrypted recordings
  (recordings.face_envelope_path, ADR 0013) and every sealed face crop and
  embedding written since Tier 2 — those have no plaintext copy anywhere.
  There is no way to tell from this script how many of those remain: the
  per-recording HKDF keys and the per-face hash-chain keys only exist inside
  the ML container.

  Before this gate can open, ALL of the following must exist:
    1. An ML maintenance endpoint that re-encrypts under the ACTIVE key —
       for each recording: decrypt with the key candidates, re-encrypt,
       verify the round-trip, replace the object, record progress so an
       interrupted run resumes; and the same for sealed face crops,
       embeddings and face-envelope blobs, which must keep their chain
       position.
    2. A read-only report from that endpoint saying ZERO artifacts still
       decrypt only under the PREV key.
    3. A verified backup taken AFTER the re-encryption pass
       (npm run backup:verify).

  Until then leave ML_ENCRYPTION_KEY_PREV in place. A retired key sitting in
  Railway's env costs nothing; the alternative is unrecoverable data loss.
  If the key is known to be compromised and you accept losing everything
  encrypted under it, that is a deliberate break-glass action — see
  docs/BREAK_GLASS.md §4, which is the only documented path.
`;

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────

function printKeys() {
  console.log("Rotatable by this script:");
  for (const s of Object.values(SPECS)) {
    console.log(`  ${s.name.padEnd(22)} ${s.provider.padEnd(8)} ${s.format}`);
    console.log(`  ${" ".repeat(22)} consumer: ${s.consumer}`);
  }
  console.log("\nRotate by hand, then record with --mark-rotated:");
  for (const [name, how] of Object.entries(MANUAL_KEYS)) {
    console.log(`  ${name.padEnd(26)} ${how}`);
  }
}

async function main() {
  const keyName = arg("key");
  const dryRun = hasFlag("dry-run");
  const finalize = hasFlag("finalize");
  const markOnly = hasFlag("mark-rotated");
  const operator = arg("operator") ?? process.env.ROTATION_OPERATOR ?? process.env.USER ?? "unknown-operator";

  if (hasFlag("list")) {
    printKeys();
    return;
  }

  if (!keyName || (!SPECS[keyName] && !MANUAL_KEYS[keyName])) {
    console.error(
      "Usage: --key=<NAME> [--dry-run] [--finalize] [--mark-rotated] [--emit=<file>] [--operator=<name>]",
    );
    console.error("       --list   # show every key and the parser its value must satisfy");
    printKeys();
    process.exit(2);
  }

  loadLocalEnv();

  // ── record-only: the key was rotated by hand (or in a dashboard) ──
  if (markOnly) {
    if (dryRun) {
      console.log(`[dry-run] would record ${keyName}_ROTATED (operator: ${operator})`);
      return;
    }
    try {
      await recordRotation(keyName, operator, { mode: "manual", provider: SPECS[keyName]?.provider ?? "external" });
      console.log(`Recorded ${keyName}_ROTATED. The weekly rotation cron will stop flagging it.`);
    } catch (e) {
      console.error(`Could not write the audit row: ${(e as Error).message}`);
      console.error(`Insert it by hand so the cron stays truthful:\n  ${manualAuditSql(keyName, operator)}`);
      process.exit(1);
    }
    return;
  }

  const spec = SPECS[keyName];
  if (!spec) {
    console.error(`${keyName} cannot be rotated by this script — ${MANUAL_KEYS[keyName]}.`);
    console.error(`Rotate it following docs/RUNBOOK.md §4, then: --key=${keyName} --mark-rotated`);
    process.exit(2);
  }

  // ── finalize: drop the PREV slot, but only when that is provably safe ──
  if (finalize) {
    if (!spec.prevName) {
      console.error(`${spec.name} has no PREV slot; --finalize only applies to dual-key rotation.`);
      process.exit(2);
    }
    if (spec.finalize !== "verified-by-db") {
      console.error(ML_FINALIZE_REFUSAL.replace("ML_ENCRYPTION_KEY", spec.name));
      process.exit(2);
    }

    let counts: { total: number; underPrev: number };
    try {
      counts = await camerasUnderPrevKey();
    } catch (e) {
      console.error(`--finalize REFUSED: cannot verify what is still under ${spec.prevName} — ${(e as Error).message}`);
      console.error("Pull production env first: vercel env pull .env.production.tmp --environment=production");
      process.exit(1);
      return;
    }

    if (counts.underPrev > 0) {
      console.error(
        `--finalize REFUSED: ${counts.underPrev} of ${counts.total} camera row(s) are still sealed with ${spec.prevName}.`,
      );
      console.error("Re-seal them first:  npm run encrypt:camera-urls -- --reencrypt   (repeat until it reports 0)");
      process.exit(1);
      return;
    }

    console.log(`Verified: 0 of ${counts.total} camera row(s) under ${spec.prevName}. Dropping it.`);
    unsetRemote(spec, spec.prevName, dryRun);
    if (!dryRun) {
      try {
        await recordRotation(`${spec.name}_FINALIZE`, operator, {
          mode: "finalize",
          dropped: spec.prevName,
          verified_rows: counts.total,
        });
      } catch (e) {
        console.error(`(audit row not written: ${(e as Error).message})`);
      }
    }
    console.log("Done. Redeploy so the running processes drop the retired key.");
    return;
  }

  // ── the rotation itself ──
  console.log(`Rotating ${spec.name} on ${spec.provider}…`);
  console.log(`  consumer: ${spec.consumer}\n`);

  const read = readCurrent(spec);

  // Only a dual-key secret cares about the outgoing value; for the others a
  // failed or redacted read costs nothing.
  if (spec.prevName && (!read.ok || (read.value === null && read.reason === "not-disclosed"))) {
    const why = read.ok ? `${spec.provider} does not disclose stored values` : read.error;
    console.error(`  ✗ cannot obtain the outgoing ${spec.name}: ${why}.`);
    console.error(`  Refusing to rotate: with no outgoing value there is no ${spec.prevName}, and everything`);
    console.error("  sealed with it becomes permanently unreadable.");
    console.error("");
    console.error("  Supply it from your vault (env var, never argv) and re-run:");
    console.error(`    ${spec.name}_CURRENT='<outgoing value>' npm run rotate:keys -- --key=${spec.name}`);
    if (spec.name === "CAMERA_URL_KEY") {
      console.error("  If the outgoing key is genuinely lost, do NOT rotate: re-enter each camera's URL on");
      console.error("  /cameras instead (they are re-sealed on save), then rotate from a known-good state.");
    }
    process.exit(1);
    return;
  }
  if (!read.ok) {
    console.log(`  ⚠ could not read the current value (${read.error}) — this key has nothing to preserve, continuing.`);
  }

  const current = read.ok ? read.value : null;
  console.log(
    current
      ? `  outgoing value in hand (${current.length} chars).`
      : read.ok && read.value === null && read.reason === "not-disclosed"
        ? `  (${spec.provider} does not disclose the stored value — nothing to preserve for this key)`
        : "  (no existing value — first-time set)",
  );

  if (current && spec.prevName) {
    // A mistyped or truncated `<NAME>_CURRENT` would fill the PREV slot with
    // something that decrypts nothing, which looks like a successful dual-key
    // rotation right up to the moment somebody needs the old data.
    const outgoing = validateSecret(spec, current);
    if (!outgoing.ok) {
      console.error(`  ✗ the outgoing ${spec.name} does not parse as a usable key: ${outgoing.reason}`);
      console.error(`  Refusing: copying it into ${spec.prevName} would preserve nothing.`);
      process.exit(1);
      return;
    }
  }

  const emitPath = arg("emit");
  if (spec.prevName && spec.provider === "vercel" && !emitPath && !dryRun) {
    // Vercel will not hand the value back, so this run is the only chance to
    // capture it. Without it the NEXT rotation cannot fill the PREV slot and
    // will (correctly) refuse — leaving re-keying by hand as the only way out.
    console.log(`  ⚠ ${spec.provider} never discloses a stored value. Without --emit=<file> you will not be able`);
    console.log(`    to supply ${spec.name}_CURRENT when this key is rotated again.`);
  }

  const newValue = generateSecret(spec);
  const validation = validateSecret(spec, newValue);
  for (const check of validation.checks) console.log(`  ✓ ${check}`);
  if (!validation.ok) {
    // A generator that produces an unparsable value must never reach the
    // provider: that is exactly how the ML service was taken down before.
    console.error(`\n  ✗ generated value is not usable by its consumer: ${validation.reason}`);
    console.error("  Nothing was changed. This is a bug in generateSecret() — fix it before rotating.");
    process.exit(1);
    return;
  }
  console.log(`  new value generated (${newValue.length} chars; not printed).`);

  if (spec.prevName && current) {
    if (current === newValue) {
      console.error("  ✗ generated value equals the current one — refusing (entropy source broken).");
      process.exit(1);
      return;
    }
    // A second rotation would overwrite the PREV slot — and there is only one.
    // ml-service/crypto_utils.master_key_candidates() tries the active key and
    // ML_ENCRYPTION_KEY_PREV, nothing else, so overwriting PREV destroys the
    // only key that can still read everything sealed before the first
    // rotation. Refuse unless the slot is empty or already holds this value.
    const existingPrev = readCurrent({ ...spec, name: spec.prevName } as KeySpec);
    if (existingPrev.ok && existingPrev.value && existingPrev.value !== current) {
      console.error(
        `  ✗ ${spec.prevName} already holds a different key. Overwriting it would make every artifact\n` +
          `    sealed before the previous rotation permanently unreadable — there is only one fallback slot.\n` +
          `    Re-encrypt everything under the active key first, clear ${spec.prevName}, then rotate again.`,
      );
      process.exit(2);
      return;
    }
    if (!existingPrev.ok) {
      console.error(
        `  ✗ could not read ${spec.prevName} (${existingPrev.error}), so a silent overwrite cannot be ruled out.\n` +
          `    Supply it as ${spec.prevName}_CURRENT=… (empty string if the slot is unset) and re-run.`,
      );
      process.exit(2);
      return;
    }
    console.log(`  preserving the outgoing value as ${spec.prevName} (dual-key rotation).`);
    setRemote(spec, spec.prevName, current, dryRun);
  }

  // Written before the provider call: a value installed but never captured is
  // worse than one captured and not installed.
  if (emitPath) emitNewValue(emitPath, spec, newValue, dryRun);

  setRemote(spec, spec.name, newValue, dryRun);

  if (!dryRun) {
    try {
      await recordRotation(spec.name, operator, {
        mode: "script",
        provider: spec.provider,
        format: spec.format,
        prev_preserved: Boolean(spec.prevName && current),
      });
      console.log(`  recorded ${spec.name}_ROTATED in audit_log.`);
    } catch (e) {
      console.error(`\n  ⚠ rotation SUCCEEDED but the audit row failed: ${(e as Error).message}`);
      console.error(`  The rotation cron will keep reporting ${spec.name} overdue until this row exists:`);
      console.error(`    ${manualAuditSql(spec.name, operator)}`);
      process.exitCode = 1;
    }
  }

  console.log("\nNext steps:");
  console.log(spec.provider === "vercel" ? "  vercel deploy --prod --yes" : "  cd ml-service && railway up --detach");
  if (spec.name === "CAMERA_URL_KEY") {
    console.log("  npm run encrypt:camera-urls -- --reencrypt   # re-seal rows under the retired key (repeat until 0)");
    console.log(`  npm run rotate:keys -- --key=${spec.name} --finalize   # verified drop of ${spec.prevName}`);
  }
  if (spec.name === "ML_ENCRYPTION_KEY") {
    console.log(`  KEEP ${spec.prevName}. Existing recordings and sealed face crops decrypt only with it;`);
    console.log("  --finalize is refused until a verified re-encryption pass exists (see docs/BREAK_GLASS.md §4).");
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
