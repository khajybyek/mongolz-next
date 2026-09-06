/**
 * cameras.url at-rest encryption maintenance.
 *
 *   npx tsx scripts/encrypt-camera-urls.ts              # seal plaintext rows (one-time backfill)
 *   npx tsx scripts/encrypt-camera-urls.ts --reencrypt  # after `rotate:keys --key=CAMERA_URL_KEY`:
 *                                                       # re-seal rows still under CAMERA_URL_KEY_PREV
 *
 * Idempotent — rows already sealed with the ACTIVE key are skipped. Run
 * `--reencrypt` until it reports 0 rows under the previous key, then finalize
 * the rotation (drop CAMERA_URL_KEY_PREV).
 *
 * Required env (load from .env.production or pass inline):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - CAMERA_URL_KEY (32-byte base64) [+ CAMERA_URL_KEY_PREV for --reencrypt]
 */

import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";

if (existsSync(".env.production.tmp")) loadEnv({ path: ".env.production.tmp" });
else if (existsSync(".env.local")) loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  decryptCameraUrl,
  encryptCameraUrl,
  isEncrypted,
  isSealedWithPrevKey,
} from "../lib/camera-crypto";

const REENCRYPT = process.argv.includes("--reencrypt");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE env vars missing");
  if (!process.env.CAMERA_URL_KEY) throw new Error("CAMERA_URL_KEY missing");
  if (REENCRYPT && !process.env.CAMERA_URL_KEY_PREV) {
    throw new Error("--reencrypt needs CAMERA_URL_KEY_PREV (the key being retired)");
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: cameras, error } = await supabase
    .from("cameras")
    .select("id, name, url")
    .not("url", "is", null);

  if (error) throw error;
  if (!cameras?.length) {
    console.log("No cameras found");
    return;
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const cam of cameras) {
    if (!cam.url) {
      skipped++;
      continue;
    }
    let plaintext: string;
    if (REENCRYPT) {
      if (!isEncrypted(cam.url) || !isSealedWithPrevKey(cam.url)) {
        skipped++;
        continue;
      }
      plaintext = decryptCameraUrl(cam.url); // succeeds via the PREV key
    } else {
      if (isEncrypted(cam.url)) {
        skipped++;
        continue;
      }
      plaintext = cam.url;
    }

    const sealed = encryptCameraUrl(plaintext);
    const { error: upErr } = await supabase.from("cameras").update({ url: sealed }).eq("id", cam.id);
    if (upErr) {
      failed++;
      console.error(`Failed to update ${cam.name} (${cam.id}):`, upErr.message);
      continue;
    }
    console.log(`${REENCRYPT ? "Re-sealed" : "Encrypted"}: ${cam.name} (${cam.id})`);
    migrated++;
  }

  console.log(`\nDone. ${REENCRYPT ? "Re-sealed" : "Migrated"}: ${migrated}, skipped: ${skipped}, failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
