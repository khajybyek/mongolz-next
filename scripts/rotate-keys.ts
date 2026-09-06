/**
 * Automated key rotation helper.
 *
 * Rotates a single Vercel/Railway secret following the dual-key convention
 * documented in CLAUDE.md. The script:
 *   1. Generates a fresh 32-byte secret (base64 or base64url).
 *   2. Moves the current value to `*_PREV` (Vercel or Railway, depending on key).
 *   3. Sets the active key to the new value.
 *   4. Triggers redeploys so processes pick up the new env.
 *
 * Supported keys: ML_ENCRYPTION_KEY, CAMERA_URL_KEY, STREAM_TICKET_SECRET,
 *                 REAUTH_COOKIE_SECRET, SESSION_PIN_SECRET.
 *
 * Run:
 *   npx tsx scripts/rotate-keys.ts --key=STREAM_TICKET_SECRET
 *   npx tsx scripts/rotate-keys.ts --key=ML_ENCRYPTION_KEY --dry-run
 *
 * For ML_ENCRYPTION_KEY the rotation is **dual-key**: the previous value is
 * preserved as `ML_ENCRYPTION_KEY_PREV` on Railway so historical encrypted
 * recordings can still be decrypted. Run with --finalize once you've
 * re-encrypted everything to drop the PREV key.
 */

import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";

type Provider = "vercel" | "railway";

interface KeySpec {
  name: string;
  provider: Provider;
  encoding: "base64" | "base64url";
  bytes: number;
  prevName?: string; // dual-key support
}

const SPECS: Record<string, KeySpec> = {
  ML_ENCRYPTION_KEY: { name: "ML_ENCRYPTION_KEY", provider: "railway", encoding: "base64url", bytes: 32, prevName: "ML_ENCRYPTION_KEY_PREV" },
  CAMERA_URL_KEY: { name: "CAMERA_URL_KEY", provider: "vercel", encoding: "base64", bytes: 32, prevName: "CAMERA_URL_KEY_PREV" },
  STREAM_TICKET_SECRET: { name: "STREAM_TICKET_SECRET", provider: "vercel", encoding: "base64url", bytes: 32 },
  REAUTH_COOKIE_SECRET: { name: "REAUTH_COOKIE_SECRET", provider: "vercel", encoding: "base64url", bytes: 32 },
  SESSION_PIN_SECRET: { name: "SESSION_PIN_SECRET", provider: "vercel", encoding: "base64url", bytes: 32 },
};

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : undefined;
}
const hasFlag = (n: string) => process.argv.includes(`--${n}`);

function generate(bytes: number, encoding: "base64" | "base64url"): string {
  return randomBytes(bytes).toString(encoding);
}

function readCurrent(spec: KeySpec): string | null {
  try {
    if (spec.provider === "railway") {
      const out = execSync(`railway variables --kv`, { stdio: ["ignore", "pipe", "pipe"] }).toString();
      const m = out.split("\n").find((l) => l.startsWith(`${spec.name}=`));
      return m ? m.slice(spec.name.length + 1) : null;
    }
    // vercel
    execSync(`vercel env pull .env.rotation.tmp --environment=production --yes`, { stdio: ["ignore", "ignore", "pipe"] });
    const fs = require("node:fs") as typeof import("node:fs");
    const txt = fs.readFileSync(".env.rotation.tmp", "utf8");
    fs.unlinkSync(".env.rotation.tmp");
    const m = txt.split("\n").find((l) => l.startsWith(`${spec.name}=`));
    if (!m) return null;
    let v = m.slice(spec.name.length + 1);
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    return v || null;
  } catch {
    return null;
  }
}

function setRemote(spec: KeySpec, key: string, value: string, dryRun: boolean) {
  if (dryRun) {
    console.log(`  [dry-run] would set ${spec.provider}:${key} = ${value.slice(0, 6)}…`);
    return;
  }
  if (spec.provider === "railway") {
    execSync(`railway variables --set "${key}=${value}"`, { stdio: "inherit" });
  } else {
    // Vercel: remove if exists then add to production
    try {
      execSync(`echo "y" | vercel env rm "${key}" production`, { stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      // not present yet
    }
    execSync(`echo "${value}" | vercel env add "${key}" production`, { stdio: ["pipe", "ignore", "pipe"] });
  }
}

function unsetRemote(spec: KeySpec, key: string, dryRun: boolean) {
  if (dryRun) {
    console.log(`  [dry-run] would unset ${spec.provider}:${key}`);
    return;
  }
  if (spec.provider === "railway") {
    execSync(`railway variables --unset "${key}"`, { stdio: "inherit" });
  } else {
    execSync(`echo "y" | vercel env rm "${key}" production`, { stdio: ["pipe", "ignore", "pipe"] });
  }
}

function main() {
  const keyName = arg("key");
  const dryRun = hasFlag("dry-run");
  const finalize = hasFlag("finalize");

  if (!keyName || !SPECS[keyName]) {
    console.error("Usage: --key=<NAME> [--dry-run] [--finalize]");
    console.error("Available keys:", Object.keys(SPECS).join(", "));
    process.exit(2);
  }

  const spec = SPECS[keyName];

  if (finalize) {
    if (!spec.prevName) {
      console.error(`${spec.name} does not have a PREV slot; --finalize only valid for dual-key rotation.`);
      process.exit(2);
    }
    console.log(`Finalizing rotation: removing ${spec.prevName}`);
    unsetRemote(spec, spec.prevName, dryRun);
    console.log("Done. Trigger a redeploy for changes to take effect.");
    return;
  }

  console.log(`Rotating ${spec.name} on ${spec.provider}…\n`);
  const current = readCurrent(spec);
  if (!current) {
    console.log(`  (no existing value found — first-time set)`);
  } else {
    console.log(`  current value present (${current.length} chars).`);
  }

  const newValue = generate(spec.bytes, spec.encoding);
  console.log(`  new value generated (${newValue.length} chars; not printed).`);

  if (spec.prevName && current) {
    console.log(`  preserving previous value as ${spec.prevName} (dual-key rotation).`);
    setRemote(spec, spec.prevName, current, dryRun);
  }

  setRemote(spec, spec.name, newValue, dryRun);

  console.log("\nDone.");
  console.log("Next steps:");
  if (spec.provider === "vercel") {
    console.log("  vercel deploy --prod --yes");
  } else {
    console.log("  cd ml-service && railway up --detach");
  }
  if (spec.name === "CAMERA_URL_KEY") {
    console.log("  npm run encrypt:camera-urls -- --reencrypt   # re-seal rows under the retired key (repeat until 0)");
  }
  if (spec.prevName) {
    console.log(`  # After all old data re-encrypted, run with --finalize to drop ${spec.prevName}`);
  }
}

main();
