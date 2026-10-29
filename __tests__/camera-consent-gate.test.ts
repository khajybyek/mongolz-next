/**
 * The per-camera consent gate (cameras.consent_required) is a privacy
 * control, so its admin toggle is asymmetric:
 *  - ON (tightening) needs no second factor. ML is asked to pin the camera
 *    private and drain the running capture first; the DB flag is then set
 *    with a compare-and-set and a fresh ML policy read confirms it. If ML
 *    cannot be reached the stricter flag is still saved (ML reads it on its
 *    next refresh or restart) and the admin is told enforcement is unconfirmed.
 *  - OFF (loosening) needs a TOTP step-up, stamps privacy_loosened_at and
 *    notifies the other admins.
 */
import { buildReauthCookieValue } from "@/lib/auth/step-up";

const ADMIN = "11111111-2222-4333-8444-555555555555";
const CAM = "22222222-3333-4444-8555-666666666666";

const state = {
  reauthCookie: undefined as string | undefined,
  consent: false,
  holdFails: false,
  refreshFails: false,
  refreshConfirms: true,
  flipDuringHold: false,
};
const calls: string[] = [];
const updates: Array<{ values: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
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
  protectCameraUrlForStorage: (url: string) => url,
  unwrapCameraUrlForRuntime: (url: string) => url,
}));
jest.mock("@/lib/ml-client", () => ({
  mlTestCamera: jest.fn(),
  mlStopCamera: jest.fn(),
  mlHoldCameraPrivacy: jest.fn(async () => {
    calls.push("ml:hold");
    if (state.flipDuringHold) state.consent = true;
    if (state.holdFails) throw new Error("ML unreachable");
  }),
  mlRefreshCameraPrivacy: jest.fn(async () => {
    calls.push("ml:refresh");
    if (state.refreshFails) throw new Error("ML unreachable");
    return {
      privacy_mode: state.consent ? "private" : "standard",
      privacy_source: state.consent ? "consent" : "schedule",
      consent_confirmed: state.consent && state.refreshConfirms,
    };
  }),
}));
jest.mock("@/lib/supabase/auth", () => ({
  requireAdmin: jest.fn(async () => ({
    user: { id: ADMIN, email: "admin@test" },
    profile: { id: ADMIN, role: "admin", totp_enabled: true, is_super_admin: false },
  })),
}));
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === "audit_log") {
        return { insert: async () => { calls.push("db:audit"); return { error: null }; } };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              calls.push("db:read");
              return { data: { consent_required: state.consent }, error: null };
            },
          }),
        }),
        update: (values: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = [];
          const chain = {
            eq: (col: string, val: unknown) => { filters.push([col, val]); return chain; },
            select: async () => {
              calls.push("db:update");
              updates.push({ values, filters });
              const stale = filters.some(([c, v]) => c === "consent_required" && v !== state.consent);
              if (stale) return { data: [], error: null };
              state.consent = values.consent_required as boolean;
              return { data: [{ id: CAM }], error: null };
            },
          };
          return chain;
        },
      };
    },
  }),
}));

import { toggleConsentAction } from "@/app/(app)/cameras/actions";

const form = (required: boolean) => {
  const f = new FormData();
  f.set("id", CAM);
  f.set("required", String(required));
  return f;
};
const totp = () => buildReauthCookieValue(ADMIN, new Date(Date.now() + 15 * 60_000), "totp");

beforeAll(() => {
  process.env.REAUTH_COOKIE_SECRET = "camera-consent-gate-test-secret"; // pragma: allowlist secret
});
beforeEach(() => {
  Object.assign(state, { reauthCookie: undefined, consent: false, holdFails: false, refreshFails: false, refreshConfirms: true, flipDuringHold: false });
  calls.length = 0;
  updates.length = 0;
  events.length = 0;
});

describe("turning the gate ON", () => {
  it("holds the camera private in ML before the DB write, then confirms with a fresh read", async () => {
    expect(await toggleConsentAction(form(true))).toEqual({ ok: true });
    expect(calls).toEqual(["db:read", "ml:hold", "db:update", "ml:refresh", "db:audit"]);
    expect(updates[0]).toEqual({
      values: { consent_required: true },
      filters: [["id", CAM], ["consent_required", false]],
    });
    expect(events).toEqual([]);
  });

  it("needs no second factor", async () => {
    state.reauthCookie = undefined;
    expect(await toggleConsentAction(form(true))).toEqual({ ok: true });
  });

  it("still saves the stricter flag when ML cannot be reached, and says enforcement is unconfirmed", async () => {
    state.holdFails = true;
    state.refreshFails = true;
    const res = await toggleConsentAction(form(true));
    expect(state.consent).toBe(true);
    expect(res).toEqual({ error: expect.stringContaining("could not be confirmed") });
    expect(calls).toEqual(["db:read", "ml:hold", "db:update", "ml:refresh", "db:audit"]);
  });

  it("reports an unconfirmed gate when ML's fresh read does not show consent", async () => {
    state.refreshConfirms = false;
    expect(await toggleConsentAction(form(true))).toEqual({ error: expect.stringContaining("could not be confirmed") });
  });

  it("re-submitting ON only re-confirms with ML and writes nothing", async () => {
    state.consent = true;
    expect(await toggleConsentAction(form(true))).toEqual({ ok: true });
    expect(calls).toEqual(["db:read", "ml:refresh"]);
  });
});

describe("turning the gate OFF", () => {
  beforeEach(() => {
    state.consent = true;
  });

  it("refuses without a fresh TOTP step-up and writes nothing", async () => {
    expect(await toggleConsentAction(form(false))).toEqual({ error: "REAUTH_REQUIRED" });
    expect(updates).toEqual([]);
    expect(state.consent).toBe(true);
  });

  it("a password-minted step-up is not enough", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, new Date(Date.now() + 15 * 60_000), "password");
    expect(await toggleConsentAction(form(false))).toEqual({ error: "REAUTH_REQUIRED" });
    expect(updates).toEqual([]);
  });

  it("with TOTP it clears the flag, stamps privacy_loosened_at and notifies the other admins", async () => {
    state.reauthCookie = totp();
    expect(await toggleConsentAction(form(false))).toEqual({ ok: true });
    expect(calls).not.toContain("ml:hold");
    expect(updates[0]!.values).toMatchObject({ consent_required: false, privacy_loosened_at: expect.any(String) });
    expect(updates[0]!.filters).toEqual([["id", CAM], ["consent_required", true]]);
    expect(events.map((e) => e.action)).toEqual(["CAMERA_CONSENT_TOGGLE"]);
  });
});

it("a concurrent change makes the compare-and-set miss instead of overwriting it", async () => {
  // Our read sees OFF; another admin turns it ON while ML is draining.
  state.flipDuringHold = true;
  const res = await toggleConsentAction(form(true));
  expect(res).toEqual({ error: expect.stringContaining("reload and try again") });
  expect(updates).toHaveLength(1);
  expect(updates[0]!.filters).toEqual([["id", CAM], ["consent_required", false]]);
  expect(calls).not.toContain("db:audit");
});

it("rejects an id that is not a UUID", async () => {
  const f = new FormData();
  f.set("id", "../cameras");
  f.set("required", "true");
  expect(await toggleConsentAction(f)).toEqual({ error: "missing id" });
  expect(calls).toEqual([]);
});
