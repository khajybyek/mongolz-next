/**
 * User үүсгэх script (admin эсвэл viewer).
 *
 * Ашиглах:
 *   npm run create-admin   # admin@mongolz.local / Mongolz!
 *   npm run create-viewer  # viewer@mongolz.local / viewer123 (зөвхөн blurred харах эрхтэй)
 *
 * Custom (env-ээр):
 *   ROLE=viewer USER_EMAIL=ivan@example.com USER_PASSWORD=secret npm run create-user
 *
 * .env.local дотор SUPABASE_SERVICE_ROLE_KEY байх ёстой.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// .env.local-г уншиx
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
    console.warn("⚠️  .env.local олдсонгүй — environment variables ашиглана");
  }
}

loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ROLE = (process.env.ROLE ?? "admin") as "admin" | "viewer" | "auditor";
if (ROLE !== "admin" && ROLE !== "viewer" && ROLE !== "auditor") {
  console.error("❌ ROLE нь 'admin' | 'viewer' | 'auditor' байх ёстой");
  process.exit(1);
}

// Default e-mails per role; the password is NEVER defaulted (a known
// default is a credential leak the moment the repo is readable).
const DEFAULTS = {
  admin: { email: "admin@mongolz.local", name: "Admin" },
  viewer: { email: "viewer@mongolz.local", name: "Viewer" },
  auditor: { email: "auditor@mongolz.local", name: "Auditor" },
}[ROLE];

const USER_EMAIL = process.env.USER_EMAIL ?? process.env.ADMIN_EMAIL ?? DEFAULTS.email;
const USER_PASSWORD = process.env.USER_PASSWORD ?? process.env.ADMIN_PASSWORD ?? "";
const FULL_NAME = process.env.FULL_NAME ?? DEFAULTS.name;

if (USER_PASSWORD.length < 12) {
  console.error("❌ USER_PASSWORD (≥12 тэмдэгт) заавал: USER_PASSWORD='…' npm run create-admin");
  process.exit(1);
}

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL болон SUPABASE_SERVICE_ROLE_KEY-ээ .env.local-д тохируул");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const icon = ROLE === "admin" ? "🛡️ " : "👁️ ";
  console.log(`${icon}${ROLE.toUpperCase()} user үүсгэж байна: ${USER_EMAIL}`);

  // 1. Auth user үүсгэх
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: USER_EMAIL,
    password: USER_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: FULL_NAME },
  });

  if (createErr) {
    if (createErr.message.includes("already") || createErr.code === "email_exists") {
      console.log("ℹ️  Энэ email-ээр user аль хэдийн байна, role-г шинэчилнэ...");
    } else {
      console.error("❌ Алдаа:", createErr.message);
      process.exit(1);
    }
  } else {
    console.log("✅ Auth user үүслээ:", created?.user?.id);
  }

  // 2. profile.role-г тавих
  const { data: users } = await supabase.auth.admin.listUsers();
  const user = users?.users.find((u) => u.email === USER_EMAIL);

  if (!user) {
    console.error("❌ User олдсонгүй");
    process.exit(1);
  }

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ role: ROLE, full_name: FULL_NAME })
    .eq("id", user.id);

  if (updateErr) {
    console.error("⚠️  Profile шинэчлэх алдаа:", updateErr.message);
    console.log("    SQL editor-аас гүйцээ:");
    console.log(`    update public.profiles set role='${ROLE}' where email='${USER_EMAIL}';`);
  } else {
    console.log(`✅ Profile.role = '${ROLE}' тавигдлаа`);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`🎉 ${ROLE === "admin" ? "Admin" : "Viewer"} бэлэн боллоо!`);
  console.log(`   Email:    ${USER_EMAIL}`);
  console.log("   Password: (hidden)");
  console.log("   URL:      http://localhost:3000/login");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((err) => {
  console.error("💥", err);
  process.exit(1);
});
