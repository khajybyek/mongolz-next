/**
 * Organiser role boundary — executable (lens 6 of the 2026-09-17 review).
 *
 * The organiser role (lib/sch/access.ts) exists so the SCH Esports
 * students can run /sch/admin without the admin role. Its contract: it
 * reaches nothing but /sch/admin (+ its own GDPR page) and may work
 * without a second factor. These tests drive the REAL auth helpers
 * (lib/supabase/auth.ts), the REAL middleware, the REAL nav model and
 * REAL admin server actions with a faked Supabase client whose profile
 * row says `role = "organiser"`. Only module boundaries are mocked:
 * next/navigation, next/headers, next/cache, both Supabase clients and
 * the ML client. Every `from(table)` call is recorded so a test can prove
 * an action refused the organiser before it touched any table other than
 * the profile read the session loader itself performs.
 */
import { NextRequest } from "next/server";
import {
  isAuthErr,
  requireAdmin,
  requireAdminApi,
  requireAdminOrAuditor,
  requireAdminOrAuditorApi,
  requireSchOrganiser,
  requireSchOrganiserApi,
  requireUser,
  requireUserApi,
} from "@/lib/supabase/auth";
import { updateSession } from "@/lib/supabase/middleware";
import { bindSessionPin } from "@/lib/auth/session-pin";
import { ORGANISER_HOME, organiserPathAllowed, schOrganiserVerdict } from "@/lib/sch/access";
import { NAV_GROUPS, mobileTabs, visibleNavGroups } from "@/lib/nav";

/* ───────────────────────── fixtures ───────────────────────── */

const ORGANISER_ID = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const CAMERA_ID = "b0000000-0000-4000-8000-000000000001";
const OTHER_USER = "c0000000-0000-4000-8000-000000000002";

const user = { id: ORGANISER_ID, email: "organiser@sch.test" };
const profile = {
  id: ORGANISER_ID,
  email: user.email,
  full_name: "SCH organiser",
  role: "organiser",
  totp_enabled: false,
  is_super_admin: false,
  created_at: "2026-09-17T00:00:00.000Z",
  updated_at: "2026-09-17T00:00:00.000Z",
};

/** Backs the next/headers cookie mock (the `mock` prefix lets the hoisted jest.mock factory reference it). */
const mockCookieJar = new Map<string, string>();

/** Every `from(table)` call on either client, in order. */
const touches: Array<{ client: "rls" | "service"; table: string; op: string }> = [];
const signOut = jest.fn();

/** Tables the session loader itself may read; anything else is "the database". */
function nonSessionTouches() {
  return touches.filter((t) => !(t.client === "rls" && t.table === "profiles" && t.op === "select"));
}

type Result = { data: unknown; error: null; count: null };

/** A chainable query recorder: every builder method returns itself; awaiting it yields the profile for `profiles`, nothing otherwise. */
function chain(client: "rls" | "service", table: string, op: string) {
  touches.push({ client, table, op });
  const result: Result = { data: table === "profiles" && op === "select" ? { ...profile } : null, error: null, count: null };
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "is", "order", "limit", "range", "gte", "lte", "not", "match"]) {
    q[m] = () => q;
  }
  q.single = async () => result;
  q.maybeSingle = async () => result;
  q.then = (onFulfilled?: (v: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return q;
}

function fromTable(client: "rls" | "service") {
  return (table: string) => ({
    select: () => chain(client, table, "select"),
    insert: () => chain(client, table, "insert"),
    upsert: () => chain(client, table, "upsert"),
    update: () => chain(client, table, "update"),
    delete: () => chain(client, table, "delete"),
  });
}

const rpc = jest.fn(async () => ({ data: null, error: null }));

/* ───────────────────────── module mocks ───────────────────────── */

jest.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`redirect:${url}`);
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "jest" }),
  // A real cookie jar: beforeAll binds a genuine session pin into it (the
  // organiser role REQUIRES one). No step-up cookie, no language cookie.
  cookies: async () => ({
    get: (name: string) => (mockCookieJar.has(name) ? { name, value: mockCookieJar.get(name)! } : undefined),
    getAll: () => [],
    set: (name: string, value: string) => void mockCookieJar.set(name, value),
    delete: (name: string) => void mockCookieJar.delete(name),
  }),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }), signOut },
    from: fromTable("rls"),
    rpc,
    storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
  }),
  createServiceClient: () => ({
    auth: { admin: { createUser: jest.fn(), deleteUser: jest.fn() } },
    from: fromTable("service"),
    rpc,
    storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
  }),
}));
// The middleware builds its own client straight from @supabase/ssr.
jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: fromTable("rls"),
  }),
}));
// Nothing here may ever reach the ML service.
jest.mock("@/lib/ml-client", () => ({
  mlStopCamera: jest.fn(async () => {
    throw new Error("ML must not be called");
  }),
  mlStartCamera: jest.fn(async () => {
    throw new Error("ML must not be called");
  }),
  mlTestCamera: jest.fn(async () => {
    throw new Error("ML must not be called");
  }),
  mlActiveCameras: jest.fn(async () => {
    throw new Error("ML must not be called");
  }),
}));

// Imported after the mocks so the action modules bind to the fakes.
import { changeRoleAction, createUserAction, deleteUserAction, resetPasswordAction, setRevealLevelAction } from "@/app/(app)/users/actions";
import { addCameraAction, deleteCameraAction, toggleCameraAction, toggleConsentAction, updateCameraAction } from "@/app/(app)/cameras/actions";
import { runSweepAction, updateRetentionAction } from "@/app/(app)/retention/actions";
import { getActiveCamerasAction, getStreamTicketAction, startCameraAction, stopCameraAction } from "@/app/(app)/live/actions";
import { POST as uploadRecording } from "@/app/api/recording/upload/route";

const ADMIN_ONLY = "redirect:/dashboard?error=admin-only";

beforeAll(async () => {
  // The session-pin verifier is fail-closed without a secret ("no-secret" →
  // 503). The organiser works without TOTP, so its pin cookie is MANDATORY
  // (proof the session came through our login form); bind a genuine one the
  // way app/login/actions.ts does.
  process.env.SESSION_PIN_SECRET = "organiser-boundary-test-secret";
  await bindSessionPin(ORGANISER_ID);
});

beforeEach(() => {
  touches.length = 0;
  jest.clearAllMocks();
  profile.role = "organiser";
  profile.totp_enabled = false;
});

/* ───────────────────────── pure verdicts ───────────────────────── */

describe("schOrganiserVerdict", () => {
  it("admits an organiser without TOTP and an admin only with TOTP", () => {
    expect(schOrganiserVerdict({ role: "organiser", totp_enabled: false })).toBe("ok");
    expect(schOrganiserVerdict({ role: "organiser", totp_enabled: true })).toBe("ok");
    expect(schOrganiserVerdict({ role: "admin", totp_enabled: true })).toBe("ok");
    expect(schOrganiserVerdict({ role: "admin", totp_enabled: false })).toBe("totp_required");
    expect(schOrganiserVerdict({ role: "viewer", totp_enabled: true })).toBe("forbidden");
    expect(schOrganiserVerdict({ role: "auditor", totp_enabled: true })).toBe("forbidden");
  });
});

describe("organiserPathAllowed", () => {
  it.each([
    "/users",
    "/settings",
    "/settings/erase",
    "/cameras",
    "/cameras/b0000000-0000-4000-8000-000000000001/permissions",
    "/dashboard",
    "/live",
    "/grid",
    "/wall",
    "/playback",
    "/faces",
    "/suspects",
    "/search",
    "/alerts",
    "/audit",
    "/retention",
    "/reveal-approvals",
    "/backup",
    "/db-monitor",
    "/webhooks",
    "/alert-rules",
    "/docs",
    "/sch", // the public form — an organiser session is bounced to its console
    "/sch/teams",
    "/sch/admin-not-really",
    "/sch/adminx",
    "/my-datax",
  ])("rejects %s", (path) => {
    expect(organiserPathAllowed(path)).toBe(false);
  });

  it.each(["/sch/admin", "/sch/admin/", "/sch/admin/export", "/my-data", "/my-data/export"])("allows %s", (path) => {
    expect(organiserPathAllowed(path)).toBe(true);
  });

  it("rejects every nav destination except the console and the GDPR page", () => {
    const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    const allowed = hrefs.filter((h) => organiserPathAllowed(h));
    expect(allowed.sort()).toEqual(["/my-data", ORGANISER_HOME].sort());
  });
});

/* ───────────────────────── navigation model ───────────────────────── */

describe("navigation for the organiser role", () => {
  it("visibleNavGroups('organiser') is exactly [/sch/admin]", () => {
    const hrefs = visibleNavGroups("organiser").flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toEqual([ORGANISER_HOME]);
  });

  it("mobileTabs('organiser') has nothing outside /sch/admin", () => {
    const outside = mobileTabs("organiser").filter((i) => !organiserPathAllowed(i.href));
    expect(outside).toEqual([]);
  });

  it("no nav item is organiser-visible unless it is on the organiser allow-list", () => {
    const leaks = NAV_GROUPS.flatMap((g) => g.items)
      .filter((i) => i.organiserAllowed === true && !organiserPathAllowed(i.href))
      .map((i) => i.href);
    expect(leaks).toEqual([]);
  });
});

/* ───────────────────────── auth helpers (real code) ───────────────────────── */

describe("auth helpers with an organiser profile", () => {
  it("requireUser resolves the organiser session (baseline for the tests below)", async () => {
    const ctx = await requireUser();
    expect(ctx.profile.role).toBe("organiser");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("an organiser session WITHOUT a pin (minted outside our login form) is revoked, audited and refused", async () => {
    const pin = [...mockCookieJar.entries()];
    mockCookieJar.clear();
    try {
      await expect(requireUser()).rejects.toThrow("redirect:/login?error=session_pin");
      expect(signOut).toHaveBeenCalledWith({ scope: "global" });
      expect(touches.some((t) => t.client === "service" && t.table === "audit_log" && t.op === "insert")).toBe(true);
      const api = await requireSchOrganiserApi();
      if (!isAuthErr(api)) throw new Error("pin-less organiser admitted");
      expect(api.error.status).toBe(401);
    } finally {
      for (const [k, v] of pin) mockCookieJar.set(k, v);
    }
  });

  it("requireAdmin redirects an organiser", async () => {
    await expect(requireAdmin()).rejects.toThrow(ADMIN_ONLY);
    await expect(requireAdmin({ allowNoTotp: true })).rejects.toThrow(ADMIN_ONLY);
  });

  it("requireAdminApi returns 403 for an organiser", async () => {
    const r = await requireAdminApi();
    if (!isAuthErr(r)) throw new Error("organiser granted admin API access");
    expect(r.error.status).toBe(403);
    expect(await r.error.json()).toEqual({ error: "forbidden: admin only" });
  });

  it("requireAdminOrAuditor redirects an organiser", async () => {
    await expect(requireAdminOrAuditor()).rejects.toThrow("redirect:/dashboard?error=forbidden");
  });

  it("requireAdminOrAuditorApi returns 403 for an organiser", async () => {
    const r = await requireAdminOrAuditorApi();
    if (!isAuthErr(r)) throw new Error("organiser granted audit API access");
    expect(r.error.status).toBe(403);
    expect(await r.error.json()).toEqual({ error: "forbidden: admin or auditor only" });
  });

  it("requireSchOrganiser passes an organiser without TOTP", async () => {
    const ctx = await requireSchOrganiser();
    expect(ctx.user.id).toBe(ORGANISER_ID);
    expect(ctx.profile.totp_enabled).toBe(false);
  });

  it("requireSchOrganiserApi passes an organiser without TOTP", async () => {
    const r = await requireSchOrganiserApi();
    if (isAuthErr(r)) throw new Error("organiser refused by its own console API");
    expect(r.profile.role).toBe("organiser");
  });

  it("requireSchOrganiser(Api) still holds an admin to TOTP and refuses viewer/auditor", async () => {
    profile.role = "admin";
    profile.totp_enabled = false;
    await expect(requireSchOrganiser()).rejects.toThrow("redirect:/settings?force_totp=1");
    const adminNoTotp = await requireSchOrganiserApi();
    if (!isAuthErr(adminNoTotp)) throw new Error("admin without TOTP admitted");
    expect(await adminNoTotp.error.json()).toEqual({ error: "totp_required" });

    for (const role of ["viewer", "auditor"]) {
      profile.role = role;
      profile.totp_enabled = false; // no pin cookie in this fixture; TOTP users would be pin-rejected first
      await expect(requireSchOrganiser()).rejects.toThrow("redirect:/dashboard?error=forbidden");
      const r = await requireSchOrganiserApi();
      if (!isAuthErr(r)) throw new Error(`${role} admitted to the organiser console`);
      expect(r.error.status).toBe(403);
    }
  });

  it("requireUserApi with the own-account opt-in admits the organiser (TOTP setup, passkeys, GDPR)", async () => {
    const r = await requireUserApi({ allowAuditor: true });
    if (isAuthErr(r)) throw new Error("organiser cannot manage its own account");
    expect(r.profile.role).toBe("organiser");
  });

  /**
   * Was a GAP until 2026-09-17: `apiSession` documented the default scope as
   * "operator (admin | viewer)" but implemented it as "not auditor", so the
   * organiser passed every `requireUserApi()` route. It is now an explicit
   * allow-list. The middleware does not help here: /api/* is exempt from the
   * role redirect.
   */
  it("requireUserApi() default (operator) scope refuses an organiser", async () => {
    const r = await requireUserApi();
    if (!isAuthErr(r)) throw new Error("organiser admitted to operator-scope API routes");
    expect(r.error.status).toBe(403);
  });
});

/* ───────────────────────── middleware (real code) ───────────────────────── */

describe("middleware allow-list for an organiser session", () => {
  async function go(path: string) {
    return updateSession(new NextRequest(`https://app.test${path}`));
  }

  it.each(["/users", "/settings", "/cameras", "/dashboard", "/live", "/grid", "/wall", "/faces", "/audit", "/retention", "/docs", "/sch/adminx"])(
    "bounces %s to the console",
    async (path) => {
      const res = await go(path);
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe(ORGANISER_HOME);
    },
  );

  it.each(["/sch/admin", "/sch/admin/export", "/my-data"])("lets %s through", async (path) => {
    const res = await go(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not demand TOTP from an organiser (the redirect is the allow-list, never /settings?force_totp)", async () => {
    const res = await go("/settings");
    expect(new URL(res.headers.get("location")!).pathname).toBe(ORGANISER_HOME);
    expect(res.headers.get("location")).not.toContain("force_totp");
  });
});

/* ───────────────────────── admin server actions (real code) ───────────────────────── */

describe("admin server actions refuse an organiser before touching the database", () => {
  const fd = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };

  const cases: Array<[string, () => Promise<unknown>]> = [
    ["users: createUserAction", () => createUserAction(fd({ email: "x@sch.test", password: "correct horse battery staple", role: "admin" }))],
    ["users: changeRoleAction (self → admin)", () => changeRoleAction(fd({ user_id: ORGANISER_ID, role: "admin" }))],
    ["users: changeRoleAction (other → admin)", () => changeRoleAction(fd({ user_id: OTHER_USER, role: "admin" }))],
    ["users: setRevealLevelAction", () => setRevealLevelAction(fd({ user_id: OTHER_USER, reveal_level: "0" }))],
    ["users: deleteUserAction", () => deleteUserAction(fd({ user_id: OTHER_USER }))],
    ["users: resetPasswordAction", () => resetPasswordAction(fd({ user_id: OTHER_USER, password: "correct horse battery staple" }))],
    ["cameras: addCameraAction", () => addCameraAction(fd({ name: "cam", url: "rtsp://10.0.0.1/live", cam_type: "rtsp" }))],
    ["cameras: deleteCameraAction", () => deleteCameraAction(CAMERA_ID)],
    ["cameras: toggleCameraAction", () => toggleCameraAction(fd({ id: CAMERA_ID, enabled: "true" }))],
    ["cameras: updateCameraAction", () => updateCameraAction(fd({ id: CAMERA_ID, name: "cam" }))],
    ["cameras: toggleConsentAction", () => toggleConsentAction(fd({ id: CAMERA_ID, consent: "true" }))],
    ["retention: updateRetentionAction", () => updateRetentionAction(fd({ resource: "faces", retention_days: "1", enabled: "true" }))],
    ["retention: runSweepAction", () => runSweepAction()],
    ["live: startCameraAction", () => startCameraAction(CAMERA_ID)],
    ["live: stopCameraAction", () => stopCameraAction(CAMERA_ID)],
  ];

  it.each(cases)("%s", async (_name, run) => {
    await expect(run()).rejects.toThrow(ADMIN_ONLY);
    expect(nonSessionTouches()).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});

/* ───────────────────────── operator-scope server actions (real code) ───────────────────────── */

describe("operator-scope server actions refuse an organiser", () => {
  // Server actions are dispatched by action id, so the middleware's page
  // allow-list never sees them — the action itself must refuse.
  it("getStreamTicketAction / getActiveCamerasAction bounce to the console without touching ML or the database", async () => {
    await expect(getStreamTicketAction(CAMERA_ID)).rejects.toThrow(`redirect:${ORGANISER_HOME}`);
    await expect(getActiveCamerasAction()).rejects.toThrow(`redirect:${ORGANISER_HOME}`);
    expect(nonSessionTouches()).toEqual([]);
  });

  it("…and still serve a viewer", async () => {
    profile.role = "viewer";
    process.env.STREAM_TICKET_SECRET = "organiser-boundary-ticket-secret";
    await expect(getStreamTicketAction(CAMERA_ID)).resolves.toEqual(expect.any(String));
  });
});

/* ───────────────────────── operator-scope API route (real code) ───────────────────────── */

describe("operator-scope API routes", () => {
  /**
   * Closed 2026-09-17 (was a GAP). POST /api/recording/upload forwards the
   * caller's video to the ML `/process-upload` endpoint with the service
   * token: the ML side creates a camera + recording, runs face detection,
   * stores embeddings and fires suspect-match alerts. The route's only gate
   * is `requireUserApi()`, which admits the organiser (see above). With the
   * ML URL unset the route answers 503 — i.e. authentication already passed
   * and the request reached the ML hand-off stage — instead of 403.
   */
  it("POST /api/recording/upload refuses an organiser", async () => {
    delete process.env.NEXT_PUBLIC_ML_SERVICE_URL;
    const body = new FormData();
    body.set("file", new File([new Uint8Array(16)], "clip.webm", { type: "video/webm" }));
    body.set("camera_name", "organiser laptop");
    const res = await uploadRecording(new NextRequest("https://app.test/api/recording/upload", { method: "POST", body }));
    expect(res.status).toBe(403);
  });
});
