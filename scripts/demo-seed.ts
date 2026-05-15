/**
 * Demo seeder — populate the DB with realistic fake data for capstone defense.
 *
 * Idempotent: re-running won't duplicate rows. Uses `demo:` prefix on names so
 * `demo-unseed.ts` (or a SQL one-liner) can wipe just the demo data.
 *
 * Required env:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - CAMERA_URL_KEY (so camera URLs are encrypted)
 *
 * Run:
 *   npx tsx scripts/demo-seed.ts
 *   npx tsx scripts/demo-seed.ts --wipe   # remove demo rows only
 */

import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";

if (existsSync(".env.production.tmp")) loadEnv({ path: ".env.production.tmp" });
else if (existsSync(".env.local")) loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { encryptCameraUrl } from "../lib/camera-crypto";

const DEMO_PREFIX = "demo:";

interface SeedCamera {
  name: string;
  cam_type: "rtsp" | "http" | "usb" | "webcam";
  url: string;
}

const DEMO_CAMERAS: SeedCamera[] = [
  { name: `${DEMO_PREFIX}Front Door (RTSP)`, cam_type: "rtsp", url: "rtsp://demo:demo@192.168.1.10:554/stream1" },
  { name: `${DEMO_PREFIX}Lobby (RTSP)`, cam_type: "rtsp", url: "rtsp://demo:demo@192.168.1.11:554/stream1" },
  { name: `${DEMO_PREFIX}Parking Lot (HTTP)`, cam_type: "http", url: "http://192.168.1.20:8080/video" },
  { name: `${DEMO_PREFIX}Reception (USB)`, cam_type: "usb", url: "0" },
];

const DEMO_SUSPECTS = [
  { name: `${DEMO_PREFIX}John Doe (FBI Most Wanted)`, notes: "Demo data — wanted for armed robbery" },
  { name: `${DEMO_PREFIX}Jane Smith (Interpol)`, notes: "Demo data — international fraud" },
  { name: `${DEMO_PREFIX}Anonymous (Internal Watch)`, notes: "Demo data — internal threat" },
];

function randomEmbedding(seed: number): number[] {
  // Deterministic pseudo-random 512-dim unit vector for repeatability.
  const out = new Float64Array(512);
  let state = seed;
  for (let i = 0; i < 512; i++) {
    state = (state * 9301 + 49297) % 233280;
    out[i] = state / 233280 - 0.5;
  }
  let norm = 0;
  for (let i = 0; i < 512; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < 512; i++) out[i] /= norm;
  return Array.from(out);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE env vars missing");
  if (!process.env.CAMERA_URL_KEY) throw new Error("CAMERA_URL_KEY missing");

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const wipe = process.argv.includes("--wipe");

  if (wipe) {
    console.log("Wiping demo data...");
    await supabase.from("alerts").delete().ilike("suspect_name", `${DEMO_PREFIX}%`);
    await supabase.from("faces").delete().ilike("filename", `${DEMO_PREFIX}%`);
    await supabase.from("suspects").delete().ilike("name", `${DEMO_PREFIX}%`);
    await supabase.from("cameras").delete().ilike("name", `${DEMO_PREFIX}%`);
    console.log("Done wiping.");
    return;
  }

  // Cameras
  for (const cam of DEMO_CAMERAS) {
    const { data: existing } = await supabase
      .from("cameras")
      .select("id")
      .eq("name", cam.name)
      .maybeSingle();
    if (existing) {
      console.log(`exists: ${cam.name}`);
      continue;
    }
    const { error } = await supabase.from("cameras").insert({
      name: cam.name,
      cam_type: cam.cam_type,
      url: encryptCameraUrl(cam.url),
      enabled: true,
    });
    if (error) console.error(`insert camera ${cam.name}: ${error.message}`);
    else console.log(`+ camera ${cam.name}`);
  }

  // Suspects (with fake embeddings — these won't match real faces)
  let seedIdx = 1000;
  for (const s of DEMO_SUSPECTS) {
    const { data: existing } = await supabase
      .from("suspects")
      .select("id")
      .eq("name", s.name)
      .maybeSingle();
    if (existing) {
      console.log(`exists: ${s.name}`);
      continue;
    }
    const { error } = await supabase.from("suspects").insert({
      name: s.name,
      notes: s.notes,
      image_path: `${DEMO_PREFIX}placeholder.jpg`,
      embedding: randomEmbedding(seedIdx++),
    });
    if (error) console.error(`insert suspect ${s.name}: ${error.message}`);
    else console.log(`+ suspect ${s.name}`);
  }

  // Synthetic alerts (last 24h, varied similarity)
  const { data: suspects } = await supabase
    .from("suspects")
    .select("id, name")
    .ilike("name", `${DEMO_PREFIX}%`);
  const { data: cameras } = await supabase
    .from("cameras")
    .select("id, name")
    .ilike("name", `${DEMO_PREFIX}%`);

  if (suspects?.length && cameras?.length) {
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 12; i++) {
      const s = suspects[i % suspects.length];
      const c = cameras[i % cameras.length];
      rows.push({
        suspect_id: s.id,
        suspect_name: s.name,
        camera_id: c.id,
        camera_name: c.name,
        similarity: 0.45 + Math.random() * 0.5,
        created_at: new Date(now - i * 3600_000).toISOString(),
      });
    }

    // Idempotency: only insert if no demo alerts exist yet today
    const { count } = await supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .ilike("suspect_name", `${DEMO_PREFIX}%`)
      .gte("created_at", new Date(now - 24 * 3600_000).toISOString());

    if ((count ?? 0) > 0) {
      console.log(`alerts: ${count} demo alerts already exist (skip)`);
    } else {
      const { error } = await supabase.from("alerts").insert(rows);
      if (error) console.error(`insert alerts: ${error.message}`);
      else console.log(`+ ${rows.length} demo alerts`);
    }
  }

  console.log("\nDemo seed complete.");
  console.log(`To wipe later: npx tsx scripts/demo-seed.ts --wipe`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
