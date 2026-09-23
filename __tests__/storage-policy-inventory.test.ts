/**
 * Storage bucket policy inventory (2026-09-08 audit, finding 4.2).
 *
 * Migration 20260908111000_storage_bucket_policies.sql replaced the blanket
 * admin `FOR ALL` policy on storage.objects with per-bucket policies. That
 * migration is only correct as long as the *code* keeps reaching each bucket
 * the way the policies assume:
 *
 *   faces / revealed  — service-role client only (the /api gateways check
 *                       authority and write an audit row). A restrictive
 *                       policy fences both buckets off from `authenticated`.
 *   recordings        — user-scoped SELECT is allowed, but only for the baked
 *                       playback artifact (`recordings.storage_path`).
 *   suspects,
 *   alert-screenshots — user-scoped, admin-gated pages.
 *
 * These tests are a change-detector, not a proof: they fail when someone adds
 * a storage call site the policies do not cover (the feature would break in
 * production with a silent null signed URL), or when a later migration
 * re-opens a bucket. Both failures should send the reader back to the
 * migration header before they edit the allow-list below.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const CODE_DIRS = ["app", "lib", "components", "scripts"];
const CODE_EXT = new Set([".ts", ".tsx", ".mts", ".mjs", ".js"]);

/** iCloud Drive leaves " 2.ts" / " 2" copies next to synced files. */
const ICLOUD_DUPE = /\s\d+(\.[a-z]+)?$/i;

const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const POLICY_MIGRATION = "20260908111000_storage_bucket_policies.sql";

/** Buckets that still have a policy for the `authenticated` role. */
const USER_SCOPED_BUCKETS = new Set(["recordings", "suspects", "alert-screenshots"]);

/**
 * Every `<client>.storage.from(<bucket>)` in shipped code, as
 * `<file>::<receiver>::<bucket>`. Receivers named in SERVICE_CLIENTS (or
 * assigned from createServiceClient in the same file) bypass RLS.
 *
 * Adding a row here is a decision, not a formality: a user-scoped receiver on
 * a bucket outside USER_SCOPED_BUCKETS needs a new policy in a new migration.
 */
const EXPECTED_SITES = [
  // user-scoped (requireAdmin pages, except playback which is admin|viewer)
  "app/(app)/playback/[id]/page.tsx::supabase::recordings",
  "app/(app)/suspects/page.tsx::supabase::suspects",
  "app/(app)/suspects/[id]/page.tsx::supabase::suspects",
  "app/(app)/suspects/[id]/page.tsx::supabase::alert-screenshots",
  "app/(app)/suspects/actions.ts::supabase::suspects",
  // service-role gateways (authority checked in the route, audit row written)
  "app/api/faces/[id]/secure-crop/route.ts::svc::faces",
  "app/api/reveal/[jobId]/output/route.ts::svc::revealed",
  // suspect delete removes the photo after the service-role row delete
  // (admin + step-up + audit in deleteSuspectAction)
  "app/(app)/suspects/actions.ts::svc::suspects",
  // sch-receipts (20260917110000) has no storage.objects policy at all: the
  // public form mints a signed upload URL and verifies/removes the object,
  // the organiser console deletes it with the last row of a submission, and
  // the admin-gated viewer route streams it after writing SCH_RECEIPT_VIEWED.
  "app/sch/actions.ts::svc::<dynamic:SCH_RECEIPT_BUCKET>",
  "app/(app)/sch/admin/actions.ts::svc::<dynamic:SCH_RECEIPT_BUCKET>",
  "app/api/sch/receipt/[id]/route.ts::svc::<dynamic:SCH_RECEIPT_BUCKET>",
  // service client injected by the caller (cron + /retention action)
  "lib/retention.ts::svc::<dynamic:bucket>",
  // offline recovery CLI constructs this client from SUPABASE_SERVICE_ROLE_KEY
  "scripts/create-recovery-bundle.ts::svc::<dynamic:bucket>",
  "scripts/restore-recovery-bundle.ts::restoreSvc::<dynamic:bucket>",
];

/**
 * Files that receive an already-constructed service client as a parameter, so
 * the `createServiceClient(` assignment lives in the caller instead.
 */
const INJECTED_SERVICE_CLIENTS: Record<string, string[]> = {
  // runRetentionSweep(svc) — both callers pass createServiceClient()
  // (app/api/cron/retention-sweep/route.ts, app/(app)/retention/actions.ts).
  "lib/retention.ts": ["svc"],
  // authorizeRevealJob() returns { job, svc } with svc = createServiceClient()
  // (lib/reveal-job-access.ts:19).
  "app/api/reveal/[jobId]/output/route.ts": ["svc"],
  // create-recovery-bundle validates and requires the service-role env key
  // immediately before constructing this client.
  "scripts/create-recovery-bundle.ts": ["svc"],
  "scripts/restore-recovery-bundle.ts": ["restoreSvc"],
};

type Site = { file: string; receiver: string; bucket: string; service: boolean };

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (ICLOUD_DUPE.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (CODE_EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const SITE_RE =
  /(\w+)\s*\.\s*storage\s*\.\s*from\(\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*\)/g;
const SERVICE_ASSIGN_RE = /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?createServiceClient\(/g;

function collectSites(): Site[] {
  const sites: Site[] = [];
  for (const dir of CODE_DIRS) {
    for (const full of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, full).split(path.sep).join("/");
      const source = fs.readFileSync(full, "utf8");
      if (!source.includes(".storage")) continue;

      const serviceReceivers = new Set(INJECTED_SERVICE_CLIENTS[rel] ?? []);
      for (const m of source.matchAll(SERVICE_ASSIGN_RE)) serviceReceivers.add(m[1]);

      for (const m of source.matchAll(SITE_RE)) {
        const receiver = m[1];
        const bucket = m[2] ?? m[3] ?? `<dynamic:${m[4]}>`;
        sites.push({ file: rel, receiver, bucket, service: serviceReceivers.has(receiver) });
      }
    }
  }
  return sites;
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

const sites = collectSites();

describe("storage call-site inventory", () => {
  it("matches the buckets the RLS policies were written for", () => {
    const found = new Set(sites.map((s) => `${s.file}::${s.receiver}::${s.bucket}`));
    expect([...found].sort()).toEqual([...EXPECTED_SITES].sort());
  });

  it("never reaches faces or revealed with a user-scoped client", () => {
    const offenders = sites
      .filter((s) => !s.service && ["faces", "revealed"].includes(s.bucket))
      .map((s) => `${s.file} (${s.receiver}.storage.from("${s.bucket}"))`);
    // A user-scoped read of these buckets is exactly the hole 20260908111000
    // closed: it would step around the crop/reveal authority gate and leave
    // no audit row. The restrictive policy makes it fail at runtime too.
    expect(offenders).toEqual([]);
  });

  it("only uses a user-scoped client on buckets that still have a policy", () => {
    const offenders = sites
      .filter((s) => !s.service && !USER_SCOPED_BUCKETS.has(s.bucket))
      .map((s) => `${s.file} → ${s.bucket}`);
    expect(offenders).toEqual([]);
  });

  it("keeps bucket access out of client components", () => {
    const offenders: string[] = [];
    for (const dir of CODE_DIRS) {
      for (const full of walk(path.join(ROOT, dir))) {
        const source = fs.readFileSync(full, "utf8");
        const isClient = /^\s*(["'])use client\1/m.test(source.slice(0, 400));
        if (isClient && /\.\s*storage\s*\./.test(source)) {
          offenders.push(path.relative(ROOT, full).split(path.sep).join("/"));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never hand-builds a Storage object URL", () => {
    const offenders: string[] = [];
    for (const dir of CODE_DIRS) {
      for (const full of walk(path.join(ROOT, dir))) {
        const source = fs.readFileSync(full, "utf8");
        if (source.includes("/storage/v1/object")) {
          offenders.push(path.relative(ROOT, full).split(path.sep).join("/"));
        }
      }
    }
    // Face crops render through /api/faces/[id]/secure-crop; a hand-built
    // bucket URL would bypass both the authority gate and the audit ledger.
    expect(offenders).toEqual([]);
  });
});

describe("storage.objects policy migrations", () => {
  const migrationPath = path.join(MIGRATIONS_DIR, POLICY_MIGRATION);

  it("ships the per-bucket migration with the faces fence", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    const body = stripSqlComments(sql).toLowerCase();
    expect(body).toContain('drop policy if exists "storage: admin all-buckets all"');
    expect(body).toMatch(/as restrictive for all[\s\S]*bucket_id <> 'faces'/);
  });

  it("has no later migration that re-opens a bucket", () => {
    const later = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{14}_[^ ]+\.sql$/.test(f) && f > POLICY_MIGRATION);

    const offenders: string[] = [];
    for (const file of later) {
      const body = stripSqlComments(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
      for (const statement of body.split(";")) {
        if (!/create\s+policy/i.test(statement)) continue;
        if (!/on\s+storage\.objects/i.test(statement)) continue;
        if (/as\s+restrictive/i.test(statement)) continue; // a fence, not a grant
        // A permissive grant must name the bucket it is for. An unscoped
        // policy is the blanket grant coming back under a new name.
        if (!/bucket_id\s*(=|in|<>)/i.test(statement)) {
          offenders.push(`${file}: ${statement.trim().split("\n")[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
