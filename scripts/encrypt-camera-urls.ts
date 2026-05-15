/**
 * One-time backfill: encrypt any plaintext `cameras.url` values.
 *
 * Idempotent — rows that already carry the `enc:` prefix are skipped.
 *
 * Required env (load from .env.production or pass inline):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - CAMERA_URL_KEY (32-byte base64)
 *
 * Run:
 *   npx tsx scripts/encrypt-camera-urls.ts
 */

import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";

if (existsSync(".env.production.tmp")) loadEnv({ path: ".env.production.tmp" });
else if (existsSync(".env.local")) loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { encryptCameraUrl, isEncrypted } from "../lib/camera-crypto";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE env vars missing");
  if (!process.env.CAMERA_URL_KEY) throw new Error("CAMERA_URL_KEY missing");

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

  for (const cam of cameras) {
    if (!cam.url || isEncrypted(cam.url)) {
      skipped++;
      continue;
    }

    const encrypted = encryptCameraUrl(cam.url);
    const { error: upErr } = await supabase
      .from("cameras")
      .update({ url: encrypted })
      .eq("id", cam.id);

    if (upErr) {
      console.error(`Failed to update ${cam.name} (${cam.id}):`, upErr.message);
      continue;
    }

    console.log(`Encrypted: ${cam.name} (${cam.id})`);
    migrated++;
  }

  console.log(`\nDone. Migrated: ${migrated}, already-encrypted: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
