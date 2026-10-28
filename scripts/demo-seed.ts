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
import type { CameraType } from "../lib/database.types";

const DEMO_PREFIX = "demo:";

interface SeedCamera {
  name: string;
  cam_type: CameraType;
  url: string;
}

const DEMO_CAMERAS: SeedCamera[] = [
  { name: `${DEMO_PREFIX}Front Door (RTSP)`, cam_type: "rtsp", url: "rtsp://demo:demo@192.168.1.10:554/stream1" }, // pragma: allowlist secret
  { name: `${DEMO_PREFIX}Lobby (RTSP)`, cam_type: "rtsp", url: "rtsp://demo:demo@192.168.1.11:554/stream1" }, // pragma: allowlist secret
  { name: `${DEMO_PREFIX}Parking Lot (HTTP)`, cam_type: "http", url: "http://192.168.1.20:8080/video" },
  { name: `${DEMO_PREFIX}Reception (USB)`, cam_type: "usb", url: "0" },
  // Built-in ML sample sources — these actually stream (synthetic looping
  // video with faces), so /grid "Start all" works without any hardware.
  { name: `${DEMO_PREFIX} Lobby`, cam_type: "demo", url: "demo://lobby" },
  { name: `${DEMO_PREFIX} Gate A`, cam_type: "demo", url: "demo://gate" },
  { name: `${DEMO_PREFIX} Parking`, cam_type: "demo", url: "demo://parking" },
];

const DEMO_SUSPECTS = [
  { name: `${DEMO_PREFIX}John Doe (FBI Most Wanted)`, notes: "Demo data — wanted for armed robbery" },
  { name: `${DEMO_PREFIX}Jane Smith (Interpol)`, notes: "Demo data — international fraud" },
  { name: `${DEMO_PREFIX}Anonymous (Internal Watch)`, notes: "Demo data — internal threat" },
  { name: `${DEMO_PREFIX}M. Park (Stalker watchlist)`, notes: "Demo data — repeat-pattern visitor" },
  { name: `${DEMO_PREFIX}D. Erdene (Visitor blocked)`, notes: "Demo data — banned visitor" },
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

  // Synthetic alerts — 7 days, 100+ rows, realistic time-of-day distribution
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
    const SEVEN_DAYS_MS = 7 * 24 * 3600_000;
    const TOTAL_ALERTS = 120;

    // Hour-of-day weights (KST): higher during working hours, peaks at lunch + evening rush
    const HOUR_WEIGHTS = [
      0.4, 0.3, 0.3, 0.3, 0.3, 0.5,  // 00-05 quiet
      0.7, 0.9, 1.2, 1.5, 1.6, 1.7,  // 06-11 morning ramp
      2.0, 1.8, 1.5, 1.4, 1.3, 1.6,  // 12-17 lunch + afternoon
      1.9, 1.6, 1.3, 1.0, 0.8, 0.6,  // 18-23 evening + wind down
    ];
    const totalWeight = HOUR_WEIGHTS.reduce((a, b) => a + b, 0);

    function pickHour(): number {
      let r = Math.random() * totalWeight;
      for (let h = 0; h < 24; h++) {
        r -= HOUR_WEIGHTS[h];
        if (r <= 0) return h;
      }
      return 23;
    }

    // Day weights: weekdays slightly busier than weekends; today + yesterday hottest
    function dayBias(daysAgo: number): number {
      if (daysAgo <= 1) return 1.6;
      if (daysAgo === 2) return 1.3;
      if (daysAgo >= 6) return 0.6;
      const dow = new Date(now - daysAgo * 86_400_000).getDay();
      return dow === 0 || dow === 6 ? 0.7 : 1.0;
    }

    function pickDay(): number {
      const weights: number[] = [];
      for (let d = 0; d < 7; d++) weights.push(dayBias(d));
      const tot = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * tot;
      for (let d = 0; d < 7; d++) {
        r -= weights[d];
        if (r <= 0) return d;
      }
      return 0;
    }

    function pickSimilarity(): number {
      // 60% mid 0.45-0.70, 25% high 0.70-0.90, 15% very high 0.90-0.99
      const u = Math.random();
      if (u < 0.6) return 0.45 + Math.random() * 0.25;
      if (u < 0.85) return 0.70 + Math.random() * 0.20;
      return 0.90 + Math.random() * 0.09;
    }

    const susList = suspects;
    type Suspect = (typeof susList)[number];
    function pickSuspect(): Suspect {
      // Top 2 suspects get ~60% of alerts to create realistic "frequent visitor" feel
      const r = Math.random();
      if (r < 0.35) return susList[0]!;
      if (r < 0.6) return susList[1]!;
      return susList[Math.floor(Math.random() * susList.length)]!;
    }

    const rows = [];
    for (let i = 0; i < TOTAL_ALERTS; i++) {
      const s = pickSuspect();
      const c = cameras[Math.floor(Math.random() * cameras.length)];
      const daysAgo = pickDay();
      const hour = pickHour();
      const minute = Math.floor(Math.random() * 60);
      const sec = Math.floor(Math.random() * 60);
      const ts = new Date(now - daysAgo * 86_400_000);
      ts.setHours(hour, minute, sec, 0);
      // Skip future timestamps (today at a future hour)
      if (ts.getTime() > now) continue;
      rows.push({
        suspect_id: s.id,
        suspect_name: s.name,
        camera_id: c.id,
        camera_name: c.name,
        similarity: pickSimilarity(),
        created_at: ts.toISOString(),
      });
    }

    // Idempotency: only insert if no demo alerts exist yet in last 7 days
    const { count } = await supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .ilike("suspect_name", `${DEMO_PREFIX}%`)
      .gte("created_at", new Date(now - SEVEN_DAYS_MS).toISOString());

    if ((count ?? 0) >= 50) {
      console.log(`alerts: ${count} demo alerts already exist within 7d (skip — wipe to regenerate)`);
    } else {
      const { error } = await supabase.from("alerts").insert(rows);
      if (error) console.error(`insert alerts: ${error.message}`);
      else console.log(`+ ${rows.length} demo alerts (7-day spread)`);
    }
  }

  console.log("\nDemo seed complete.");
  console.log(`To wipe later: npx tsx scripts/demo-seed.ts --wipe`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
