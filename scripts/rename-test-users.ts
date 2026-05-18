/**
 * Rename the test users from @mongolz.local → @aicctv.dev and reset
 * their passwords to a known shared value. Idempotent: re-running with
 * the new emails already in place is a no-op.
 *
 *   npm run rename:test-users
 *
 * .env.local must hold SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnv() {
  try {
    const envPath = join(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (key && !process.env[key]) {
        process.env[key] = rest.join("=").trim();
      }
    }
  } catch {
    // ignore — env may already be exported.
  }
}
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const svc = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = process.env.NEW_PASSWORD ?? "aicctvdev";
const PAIRS: Array<{ from: string; to: string }> = [
  { from: "admin@mongolz.local", to: "admin@aicctv.dev" },
  { from: "viewer@mongolz.local", to: "viewer@aicctv.dev" },
  { from: "auditor@mongolz.local", to: "auditor@aicctv.dev" },
];

async function findUserId(email: string): Promise<string | null> {
  // listUsers paginates; we only have a handful so 1 page is enough.
  let page = 1;
  while (page <= 5) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) {
      if (u.email?.toLowerCase() === email.toLowerCase()) return u.id;
    }
    if (data.users.length < 200) break;
    page++;
  }
  return null;
}

async function ensure(pair: { from: string; to: string }) {
  // 1. Prefer the new email if it already exists (idempotent run).
  let id = await findUserId(pair.to);
  let action: "updated-password-only" | "renamed" | "missing" = "renamed";
  if (id) {
    action = "updated-password-only";
  } else {
    id = await findUserId(pair.from);
    if (!id) {
      console.log(`  ✗ ${pair.from} → not found, skipping`);
      action = "missing";
      return;
    }
  }

  const { error: authErr } = await svc.auth.admin.updateUserById(id, {
    email: pair.to,
    password: PASSWORD,
    email_confirm: true,
  });
  if (authErr) throw authErr;

  // 2. Mirror to profiles.email so logins / UI continue to show the new
  //    address even if the auth.users update is lazy-replicated.
  const { error: profErr } = await svc
    .from("profiles")
    .update({ email: pair.to })
    .eq("id", id);
  if (profErr) {
    console.log(`  ! profiles update failed for ${pair.to}: ${profErr.message}`);
  }

  console.log(`  ✓ ${pair.from} → ${pair.to} (password reset, ${action})`);
}

(async () => {
  console.log(`Renaming test users + resetting passwords to "${PASSWORD}"…\n`);
  for (const pair of PAIRS) {
    try {
      await ensure(pair);
    } catch (err) {
      console.error(`  ✗ ${pair.to}: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
  console.log("\nDone.");
})();
