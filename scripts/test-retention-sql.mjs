/** Run actual migration SQL in a fresh, in-memory PostgreSQL engine.
 * Usage: PGLITE_MODULE=/path/to/@electric-sql/pglite node scripts/test-retention-sql.mjs
 * No database URL is accepted; this cannot connect to a production database.
 * PGlite is single-connection: tests cover lease exclusion/reclaim, not parallel
 * PostgreSQL connection scheduling (SKIP LOCKED needs staging integration too).
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();
const file = (name) => new URL(`../${name}`, import.meta.url);
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const scalar = async (sql, params = []) => Object.values((await query(sql, params))[0])[0];
let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
try {
  await db.exec(await fs.readFile(file("supabase/tests/retention_deletion_queue.fixture.sql"), "utf8"));
  await db.exec(await fs.readFile(file("supabase/migrations/20260907101000_retention_deletion_queue.sql"), "utf8"));
  await db.exec(`
    insert into retention_policies values
      ('recordings',30,true,null,null),('faces',90,true,null,null),('alerts',365,true,null,null),
      ('audit_log',1,true,null,null),('reveal_jobs',365,true,null,null),('reveal_outputs',30,true,null,null);
    insert into recordings(id,started_at,storage_path,original_path) values
      ('00000000-0000-4000-8000-000000000001',now()-interval '40 days','old.mp4','old.enc'),
      ('00000000-0000-4000-8000-000000000002',now(),'recent.mp4','recent.enc');
    insert into faces(detected_at,image_path,crop_sealed) values
      (now()-interval '100 days','sealed.jpg',true),
      (now()-interval '100 days','plain.jpg',false),(now(),'recent.jpg',true);
    insert into reveal_jobs(recording_id,created_at,completed_at,output_path) values
      ('00000000-0000-4000-8000-000000000001',now(),now(),'cascade.mp4'),
      ('00000000-0000-4000-8000-000000000002',now()-interval '400 days',now()-interval '400 days','expired-job.mp4'),
      ('00000000-0000-4000-8000-000000000002',now()-interval '60 days',now()-interval '40 days','expired-output.mp4'),
      ('00000000-0000-4000-8000-000000000002',now(),now(),'recent-output.mp4');
    insert into alerts(created_at) values (now()-interval '400 days'),(now());
    insert into audit_log(action,created_at) values ('KEEP_ME',now()-interval '400 days');
  `);
  const result = await scalar("select sweep_retention()");
  check(result.reveal_outputs, 1, "expired output reference is cleared");
  check(result.recordings, 1, "expired recording retired");
  check(result.faces, 2, "both sealed and plaintext expired faces retired");
  check(result.alerts, 1, "alert retention preserved");
  check(result.reveal_jobs, 1, "job retention preserved");
  check(typeof result.audit_log_skipped, "string", "legal hold reported even if policy enabled");
  check(await scalar("select count(*)::integer from audit_log where action='KEEP_ME'"), 1, "ledger retained");
  check((await query("select object_path from retention_deletion_queue order by object_path")).map((r) => r.object_path),
    ["cascade.mp4","expired-job.mp4","expired-output.mp4","old.enc","old.mp4","plain.jpg","sealed.jpg.enc"],
    "OLD paths, originals and cascaded outputs all survive in the durable queue");
  check(await scalar("select count(*)::integer from reveal_jobs where output_path is null"), 1, "output job retained for accountability");
  check(await scalar("select count(*)::integer from reveal_jobs where output_path='recent-output.mp4'"), 1, "fresh output retained");
  await query("select sweep_retention()");
  check(await scalar("select count(*)::integer from retention_deletion_queue"), 7, "repeat sweep idempotent");

  const first = await query("select * from claim_retention_deletions(2)");
  const second = await query("select * from claim_retention_deletions(500)");
  check(first.length, 2, "claim limit");
  check(second.length, 5, "active claims excluded from another worker");
  check(await scalar("select count(*)::integer from claim_retention_deletions(500)"), 0, "no duplicate active claim");
  const ids = first.map((r) => r.id);
  check(await scalar("select settle_retention_deletions($1::uuid[],$2::uuid,null)", [ids, second[0].lease_token]), 0, "wrong lease cannot acknowledge");
  check(await scalar("select settle_retention_deletions($1::uuid[],$2::uuid,'Storage offline')", [ids, first[0].lease_token]), 2, "failed removal retained for retry");
  check(await scalar("select count(*)::integer from retention_deletion_queue where last_error='Storage offline' and available_at>now() and lease_token is null"), 2, "retry backoff and error persisted");
  await query("update retention_deletion_queue set available_at=now()-interval '1 second' where id=any($1::uuid[])", [ids]);
  const retry = await query("select * from claim_retention_deletions(500)");
  check(retry.length, 2, "failed Storage removals reclaimable");
  check(await scalar("select settle_retention_deletions($1::uuid[],$2::uuid,null)", [ids, first[0].lease_token]), 0, "stale worker cannot acknowledge reclaimed work");
  check(await scalar("select settle_retention_deletions($1::uuid[],$2::uuid,null)", [ids, retry[0].lease_token]), 2, "successful retry acknowledged");
  await query("update retention_deletion_queue set locked_until=now()-interval '1 second'");
  const abandoned = await query("select * from claim_retention_deletions(500)");
  check(abandoned.length, 5, "crashed worker lease expires");
  check(await scalar("select settle_retention_deletions($1::uuid[],$2::uuid,null)", [abandoned.map((r) => r.id), abandoned[0].lease_token]), 5, "remaining paths acknowledged");

  await db.exec("begin; delete from recordings;");
  check(await scalar("select count(*)::integer from retention_deletion_queue"), 3, "manual/cascade delete queues paths");
  await db.exec("rollback;");
  check(await scalar("select count(*)::integer from retention_deletion_queue"), 0, "rollback undoes both paths and row deletion");
  check(await scalar("select count(*)::integer from recordings"), 1, "owning row survived rollback");
  for (const role of ["anon", "authenticated"]) {
    check(await scalar("select has_table_privilege($1,'retention_deletion_queue','select')", [role]), false, `${role} cannot read queued private paths`);
    check(await scalar("select has_function_privilege($1,'claim_retention_deletions(integer)','execute')", [role]), false, `${role} cannot claim`);
    check(await scalar("select has_function_privilege($1,'settle_retention_deletions(uuid[],uuid,text)','execute')", [role]), false, `${role} cannot settle`);
  }
  console.log(`Retention migration: ${checks} PostgreSQL assertions passed (isolated PGlite).`);
} finally { await db.close(); }
