/**
 * Adding a camera needs the TOTP step-up and tells the other admins.
 *
 * A new cameras row starts from the column defaults (enabled, privacy_default
 * = standard, no schedule windows). Without the second factor a stolen admin
 * session could register a second row for the same feed as a `private` camera
 * (its source URL is visible on /cameras) and get full recognition on it —
 * defeating the step-up that loosening a schedule requires (ADR 0012).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildReauthCookieValue } from "@/lib/auth/step-up";

const ADMIN = "11111111-2222-4333-8444-555555555555";

const state = { reauthCookie: undefined as string | undefined };
const ops: Array<{ table: string; op: string; values?: unknown }> = [];
const events: Array<{ action: string; detail?: string | null }> = [];

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => {
      if (name === "mongolz-reauth" && state.reauthCookie) return { value: state.reauthCookie };
      if (name === "mongolz-lang") return { value: "en" };
      return undefined;
    },
  }),
}));
jest.mock("@/lib/notify", () => ({
  scheduleSecurityEvent: (e: { action: string; detail?: string | null }) => {
    events.push(e);
  },
}));
jest.mock("@/lib/camera-crypto", () => ({
  protectCameraUrlForStorage: (url: string) => `enc:${url}`,
  unwrapCameraUrlForRuntime: (url: string) => url.replace(/^enc:/, ""),
}));
jest.mock("@/lib/ml-client", () => ({ mlTestCamera: jest.fn(), mlStopCamera: jest.fn() }));
jest.mock("@/lib/supabase/auth", () => ({
  requireAdmin: jest.fn(async () => ({
    user: { id: ADMIN, email: "admin@test" },
    profile: { id: ADMIN, role: "admin", totp_enabled: true, is_super_admin: false },
  })),
}));
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      insert: async (values: unknown) => {
        ops.push({ table, op: "insert", values });
        return { data: null, error: null };
      },
    }),
  }),
}));

import { addCameraAction } from "@/app/(app)/cameras/actions";

const form = () => {
  const f = new FormData();
  f.set("name", "Lobby (copy)");
  f.set("url", "demo://lobby");
  f.set("cam_type", "demo");
  return f;
};

beforeAll(() => {
  process.env.REAUTH_COOKIE_SECRET = "camera-add-step-up-test-secret"; // pragma: allowlist secret
});
beforeEach(() => {
  ops.length = 0;
  events.length = 0;
  state.reauthCookie = undefined;
});

it("refuses without a fresh TOTP step-up and writes nothing", async () => {
  expect(await addCameraAction(form())).toEqual({ error: "REAUTH_REQUIRED" });
  expect(ops).toEqual([]);
  expect(events).toEqual([]);
});

it("a password-minted step-up is not enough", async () => {
  state.reauthCookie = buildReauthCookieValue(ADMIN, new Date(Date.now() + 15 * 60_000), "password");
  expect(await addCameraAction(form())).toEqual({ error: "REAUTH_REQUIRED" });
  expect(ops.filter((o) => o.table === "cameras")).toEqual([]);
});

it("with TOTP it inserts through the service role, audits and notifies the other admins", async () => {
  state.reauthCookie = buildReauthCookieValue(ADMIN, new Date(Date.now() + 15 * 60_000), "totp");
  expect(await addCameraAction(form())).toEqual({ ok: true });
  expect(ops.map((o) => o.table)).toEqual(["cameras", "audit_log"]);
  expect(ops[0]!.values).toMatchObject({ name: "Lobby (copy)", url: "enc:demo://lobby", cam_type: "demo" });
  expect(events.map((e) => e.action)).toEqual(["CAMERA_ADD"]);
});

it("the add dialog routes REAUTH_REQUIRED through the TOTP prompt and retries the same submission", () => {
  const src = readFileSync(join(process.cwd(), "components", "camera-edit-dialog.tsx"), "utf8");
  expect(src).toContain('fd.has("id") ? await updateCameraAction(fd) : await addCameraAction(fd)');
  expect(src).toMatch(/if \(res\.error === "REAUTH_REQUIRED"\) \{\s*pendingEdit\.current = fd;\s*setNeedsTotp\(true\);/);
});
