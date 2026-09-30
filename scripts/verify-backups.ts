/**
 * Backup verification — proves that encrypted recordings can be successfully
 * decrypted with the current `ML_ENCRYPTION_KEY`.
 *
 * Strategy:
 *   1. Sample N most-recent recordings from the DB.
 *   2. For each: download the encrypted blob from Supabase Storage,
 *      send it to the ML service `/reveal/verify-blob` (added in this script's
 *      sibling change), and confirm successful HKDF→AES-GCM decryption.
 *   3. Report pass/fail counts + any failures with recording IDs.
 *
 * Why: Encryption silently breaking (e.g. key rotated incorrectly) is a
 * disaster — recordings become irretrievable. Run this on a schedule.
 *
 * Run: npx tsx scripts/verify-backups.ts [N]
 */

import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";

if (existsSync(".env.production.tmp")) loadEnv({ path: ".env.production.tmp" });
else if (existsSync(".env.local")) loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const SAMPLE = Number(process.argv[2] ?? "5");
const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "";
const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE env missing");
  if (!ML_URL || !ML_TOKEN) throw new Error("ML_URL or ML_TOKEN missing");

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: recordings, error } = await sb
    .from("recordings")
    .select("id, filename, storage_path, original_path, encrypted, started_at")
    .eq("encrypted", true)
    .order("started_at", { ascending: false })
    .limit(SAMPLE);

  if (error) throw error;
  if (!recordings?.length) {
    console.log("No encrypted recordings to verify.");
    return;
  }

  console.log(`Verifying ${recordings.length} encrypted recording(s)…\n`);

  let pass = 0;
  const failures: Array<{ id: string; reason: string }> = [];

  for (const r of recordings) {
    try {
      const res = await fetch(`${ML_URL}/reveal/verify-blob`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ML_TOKEN}`,
          "Content-Type": "application/json",
        },
        // The ciphertext is `original_path`; for legacy (baked) rows storage_path
        // is the plaintext blurred MP4 and would always fail to decrypt. A
        // face-encrypted row (ADR 0013) has no original_path: its storage_path
        // is the masked video encrypted with the same per-recording key.
        body: JSON.stringify({ recording_id: r.id, storage_path: r.original_path ?? r.storage_path }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        failures.push({ id: r.id, reason: `${res.status}: ${body.slice(0, 100)}` });
        console.log(`  ✗ ${r.filename} (${r.id.slice(0, 8)}) — ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (data.ok) {
        pass++;
        console.log(`  ✓ ${r.filename} (${r.id.slice(0, 8)}) — ${data.bytes_decoded ?? "?"} bytes`);
      } else {
        failures.push({ id: r.id, reason: data.reason ?? "verify returned ok=false" });
        console.log(`  ✗ ${r.filename} (${r.id.slice(0, 8)}) — ${data.reason ?? "fail"}`);
      }
    } catch (e) {
      failures.push({ id: r.id, reason: e instanceof Error ? e.message : "unknown" });
      console.log(`  ✗ ${r.filename} (${r.id.slice(0, 8)}) — ${e instanceof Error ? e.message : "err"}`);
    }
  }

  console.log(`\n${pass}/${recordings.length} verified`);
  if (failures.length) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  - ${f.id}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
