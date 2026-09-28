/**
 * Read-access ledger (2026-09-08 audit, finding 1 / 6.2).
 *
 * Every route that hands personal data to a human must leave a row, and a
 * refusal must never look like a viewing. These tests drive the real route
 * handlers with auth, Supabase and the ML upstream mocked at the module
 * boundary — same shape as secure-crop-route.test.ts / reveal-authority-route.test.ts.
 */
import { NextRequest, NextResponse } from "next/server";

const FACE = "11111111-2222-4333-8444-555555555555";
const REC = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CAM = "cccccccc-dddd-4eee-8fff-000000000000";
const JOB = "99999999-8888-4777-8666-555555555555";

type Role = "admin" | "viewer" | "auditor";

const state: {
  auth: "ok" | "unauthorized" | "forbidden";
  role: Role;
  level: unknown;
  face: { image_path: string; crop_sealed: boolean } | null;
  storageBytes: Uint8Array | null;
  rec: { id: string; has_original: boolean } | null;
  camera: { id: string; enabled: boolean } | null;
  canSee: boolean | null;
  permError: boolean;
  grant: { id: string } | null;
  alerts: Array<Record<string, unknown>>;
  matches: Array<Record<string, unknown>>;
  trail: Array<Record<string, unknown>>;
  job: Record<string, unknown> | null;
  ledgerHits: number;
} = {
  auth: "ok",
  role: "admin",
  level: 0,
  face: null,
  storageBytes: null,
  rec: null,
  camera: null,
  canSee: true,
  permError: false,
  grant: null,
  alerts: [],
  matches: [],
  trail: [],
  job: null,
  ledgerHits: 0,
};

/** Every audit_log insert the code under test performed. */
const audited: Array<Record<string, unknown>> = [];

function authResult() {
  if (state.auth === "unauthorized") {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (state.auth === "forbidden") {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user: { id: "user-1", email: "op@example.test" }, profile: { role: state.role } };
}

jest.mock("@/lib/supabase/auth", () => ({
  requireUserApi: jest.fn(async () => authResult()),
  requireAdminApi: jest.fn(async () => authResult()),
  isAuthErr: (r: unknown) => typeof r === "object" && r !== null && "error" in r,
}));

jest.mock("@/lib/ml-client", () => ({ mlEmbed: jest.fn(async () => new Array(512).fill(0.1)) }));
jest.mock("@/lib/pgvector", () => ({ vectorParam: (v: number[]) => JSON.stringify(v) }));
// A ticket is accepted when it starts with "valid-" (and belongs to user-1),
// anything else is expired / forged.
jest.mock("@/lib/stream-ticket", () => ({
  verifyStreamTicket: (ticket: string) =>
    ticket.startsWith("valid-") ? { valid: true, userId: "user-1" } : { valid: false },
}));
jest.mock("@/lib/reveal-authority", () => ({
  readRevealAuthority: jest.fn(async () => ({ level: state.level as number })),
  canReadRevealOutput: () => true,
}));
jest.mock("@/lib/reveal-job-access", () => ({
  REVEAL_PRIVATE_HEADERS: { "Cache-Control": "private, no-store" },
  authorizeRevealJob: jest.fn(async () => {
    if (!state.job) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
    return {
      job: state.job,
      svc: {
        storage: {
          from: () => ({
            createSignedUrl: async () => ({ data: { signedUrl: "https://storage.test/x" }, error: null }),
          }),
        },
      },
    };
  }),
}));

/**
 * One fake PostgREST client. Reads are driven by `state`; every insert into
 * audit_log is captured, and the throttle probe answers from `ledgerHits` so
 * the cross-instance suppression path can be exercised.
 */
function fakeClient() {
  const table = (name: string) => {
    const rows = () => {
      switch (name) {
        case "faces":
          return state.face;
        case "recordings":
          return state.rec;
        case "cameras":
          return state.camera;
        case "camera_permissions":
          return state.grant;
        default:
          return null;
      }
    };
    const listFor = () => {
      switch (name) {
        case "alerts":
          return state.alerts;
        case "faces":
          return state.matches;
        default:
          return [];
      }
    };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (name === "audit_log" && opts?.head) {
          return {
            eq: chain,
            gte: async () => ({ count: state.ledgerHits, error: null }),
          } as unknown as typeof builder;
        }
        return builder;
      },
      eq: chain,
      in: async () => ({ data: listFor(), error: null }),
      limit: chain,
      order: () => {
        // Paged exports (lib/paged-fetch) chain order().order().range();
        // every list fits on the first page, so later offsets are empty.
        const ordered: Record<string, unknown> = {
          limit: async () => ({ data: listFor(), error: null }),
          range: async (from: number) => ({ data: from === 0 ? listFor() : [], error: null }),
        };
        ordered.order = () => ordered;
        return ordered;
      },
      maybeSingle: async () => ({ data: rows(), error: null }),
      single: async () => ({ data: rows(), error: null }),
      gte: async () => ({ count: state.ledgerHits, error: null }),
      insert: async (row: Record<string, unknown>) => {
        if (name === "audit_log") audited.push(row);
        return { error: null };
      },
    });
    return builder;
  };
  return {
    from: (name: string) => table(name),
    rpc: async (fn: string) => {
      if (fn === "user_can_see_camera") {
        return state.permError
          ? { data: null, error: { message: "offline" } }
          : { data: state.canSee, error: null };
      }
      if (fn === "camera_trail") return { data: state.trail, error: null };
      if (fn === "match_faces" || fn === "search_faces_advanced_page") return { data: state.matches, error: null };
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        download: async () =>
          state.storageBytes
            ? { data: new Blob([state.storageBytes as BlobPart]), error: null }
            : { data: null, error: { message: "not found" } },
      }),
    },
  };
}

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => fakeClient(),
  createClient: async () => fakeClient(),
}));

import { READ_ACTIONS, resetAccessThrottle } from "@/lib/audit";

/**
 * Route modules read `NEXT_PUBLIC_ML_SERVICE_URL` / `ML_SERVICE_TOKEN` at
 * import time, so they are required lazily — after beforeEach has set them.
 */
type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;
function route<T>(path: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path) as T;
}
const cropGet = (...a: Parameters<Handler<{ params: Promise<{ id: string }> }>>) =>
  route<{ GET: Handler<{ params: Promise<{ id: string }> }> }>("@/app/api/faces/[id]/secure-crop/route").GET(...a);
const viewGet = (...a: Parameters<Handler<{ params: Promise<{ id: string }> }>>) =>
  route<{ GET: Handler<{ params: Promise<{ id: string }> }> }>("@/app/api/recordings/[id]/view/route").GET(...a);
const streamGet = (
  ...a: Parameters<Handler<{ params: Promise<{ cameraId: string; segment: string }> }>>
) =>
  route<{ GET: Handler<{ params: Promise<{ cameraId: string; segment: string }> }> }>(
    "@/app/api/ml/stream/[cameraId]/[segment]/route",
  ).GET(...a);
const trailGet = (req: NextRequest) =>
  route<{ GET: (req: Request) => Promise<Response> }>("@/app/api/reid/trail/route").GET(req);
const csvGet = (req: NextRequest) =>
  route<{ GET: (req: NextRequest) => Promise<Response> }>("@/app/api/alerts/csv/route").GET(req);
const outputGet = (...a: Parameters<Handler<{ params: Promise<{ jobId: string }> }>>) =>
  route<{ GET: Handler<{ params: Promise<{ jobId: string }> }> }>("@/app/api/reveal/[jobId]/output/route").GET(...a);
const searchPost = (req: NextRequest) =>
  route<{ POST: (req: NextRequest) => Promise<Response> }>("@/app/api/search/route").POST(req);

const XFF = { "x-forwarded-for": "203.0.113.9, 70.41.3.18" };

function rows(action: string) {
  return audited.filter((r) => r.action === action);
}

const call = {
  crop: (id = FACE) =>
    cropGet(new NextRequest(`https://app.test/api/faces/${id}/secure-crop`, { headers: XFF }), {
      params: Promise.resolve({ id }),
    }),
  view: (id = REC) =>
    viewGet(new NextRequest(`https://app.test/api/recordings/${id}/view`, { headers: XFF }), {
      params: Promise.resolve({ id }),
    }),
  stream: (segment = "index.m3u8", cameraId = CAM) =>
    streamGet(
      new NextRequest(`https://app.test/api/ml/stream/${cameraId}/${segment}`, { headers: XFF }),
      { params: Promise.resolve({ cameraId, segment }) },
    ),
  streamWithTicket: (ticket: string, segment = "index.m3u8", cameraId = CAM) =>
    streamGet(
      new NextRequest(
        `https://app.test/api/ml/stream/${cameraId}/${segment}?ticket=${encodeURIComponent(ticket)}`,
        { headers: XFF },
      ),
      { params: Promise.resolve({ cameraId, segment }) },
    ),
  trail: (faceId = FACE) =>
    trailGet(new NextRequest(`https://app.test/api/reid/trail?face_id=${faceId}`, { headers: XFF })),
  csv: () => csvGet(new NextRequest("https://app.test/api/alerts/csv", { headers: XFF })),
  output: (range?: string) =>
    outputGet(
      new NextRequest(`https://app.test/api/reveal/${JOB}/output`, {
        headers: range ? { ...XFF, Range: range } : XFF,
      }),
      { params: Promise.resolve({ jobId: JOB }) },
    ),
  search: () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "probe.jpg", { type: "image/jpeg" }));
    return searchPost(
      new NextRequest("https://app.test/api/search", { method: "POST", body: form, headers: XFF }),
    );
  },
};

describe("read-access ledger", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    audited.length = 0;
    resetAccessThrottle();
    state.auth = "ok";
    state.role = "admin";
    state.level = 0;
    state.face = { image_path: "cam/face.jpg", crop_sealed: true };
    state.storageBytes = new Uint8Array([0xff, 0xd8]);
    state.rec = { id: REC, has_original: true };
    state.camera = { id: CAM, enabled: true };
    state.canSee = true;
    state.permError = false;
    state.grant = null;
    state.alerts = [{ suspect_name: "x", similarity: 0.9, camera_name: "c", created_at: "t", state: "new", screenshot_path: null }];
    state.matches = [{ id: FACE, filename: "f", image_path: "p", detected_at: "t", similarity: 0.81,
      recording_id: null, recording_filename: null, camera_id: null, camera_name: null, crop_sealed: false }];
    state.trail = [{ face_id: FACE, camera_id: CAM, camera_name: "gate", detected_at: "t", similarity: 0.7, bbox: null, recording_id: null }];
    state.job = { id: JOB, status: "completed", output_path: `${JOB}.mp4` };
    state.ledgerHits = 0;
    process.env.NEXT_PUBLIC_ML_SERVICE_URL = "https://ml.test";
    process.env.ML_SERVICE_TOKEN = "tok";
    global.fetch = jest.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  // ── successes leave a trace ────────────────────────────────────────
  it("records a sealed face-crop decrypt with the face id, level and client IP", async () => {
    expect((await call.crop()).status).toBe(200);
    const [row] = rows(READ_ACTIONS.FACE_CROP_VIEWED);
    expect(row).toMatchObject({ user_id: "user-1", user_email: "op@example.test", ip: "203.0.113.9" });
    expect(String(row.detail)).toContain(`face=${FACE}`);
    expect(String(row.detail)).toContain("sealed");
  });

  it("records a legacy plaintext crop distinctly from a sealed one", async () => {
    state.face = { image_path: "cam/legacy.jpg", crop_sealed: false };
    expect((await call.crop()).status).toBe(200);
    expect(String(rows(READ_ACTIONS.FACE_CROP_VIEWED)[0]?.detail)).toContain("legacy-plain");
  });

  it("records a recording view, a live playlist, a trail, an export and a search", async () => {
    expect((await call.view()).status).toBe(200);
    expect((await call.stream()).status).toBe(200);
    expect((await call.trail()).status).toBe(200);
    expect((await call.csv()).status).toBe(200);
    expect((await call.search()).status).toBe(200);

    expect(String(rows(READ_ACTIONS.RECORDING_VIEWED)[0]?.detail)).toContain(`recording=${REC}`);
    expect(String(rows(READ_ACTIONS.STREAM_VIEWED)[0]?.detail)).toContain(`camera=${CAM}`);
    expect(String(rows(READ_ACTIONS.REID_TRAIL)[0]?.detail)).toContain("hits=1");
    expect(String(rows(READ_ACTIONS.ALERTS_EXPORTED)[0]?.detail)).toContain("rows=1");
    expect(String(rows(READ_ACTIONS.FACE_SEARCH)[0]?.detail)).toContain("matches=1");
  });

  it("records a 1:N search that found nobody — the query is the event", async () => {
    state.matches = [];
    expect((await call.search()).status).toBe(200);
    expect(rows(READ_ACTIONS.FACE_SEARCH)).toHaveLength(1);
  });

  it("keeps the recording identity when enriching a search candidate", async () => {
    state.matches = [{ id: FACE, filename: "face.jpg", image_path: "p", detected_at: "t", similarity: 0.81,
      recording_id: REC, recording_filename: "evidence.mp4", camera_id: CAM, camera_name: "Entry", crop_sealed: false }];
    const res = await call.search();
    expect(res.status).toBe(200);
    expect((await res.json()).matches[0]).toMatchObject({ id: FACE, recording_id: REC, recording_filename: "evidence.mp4", camera_name: "Entry" });
  });

  it("marks expired recording evidence unavailable instead of generating a dead candidate link", async () => {
    state.matches = [{ id: FACE, filename: "face.jpg", image_path: "p", detected_at: "t", similarity: 0.81,
      recording_id: null, recording_filename: null, camera_id: null, camera_name: null, crop_sealed: false }];
    expect((await (await call.search()).json()).matches[0]).toMatchObject({ recording_id: null, recording_filename: null });
  });

  it("collapses seeks into one row per playback window", async () => {
    expect((await call.output()).status).toBe(200);
    expect((await call.output("bytes=4096-")).status).toBe(200);
    expect((await call.output("bytes=8192-")).status).toBe(200);
    expect(rows(READ_ACTIONS.REVEAL_OUTPUT_DOWNLOADED)).toHaveLength(1);
  });

  it("records a mid-file Range fetch — the whole file can be taken that way", async () => {
    // Regression: logging used to be skipped unless the Range started at byte
    // zero, so `curl -H 'Range: bytes=1-'` downloaded the unmasked evidence
    // with no ledger row at all.
    expect((await call.output("bytes=1-")).status).toBe(200);
    expect(rows(READ_ACTIONS.REVEAL_OUTPUT_DOWNLOADED)).toHaveLength(1);
  });

  it("never puts a secret, a signed URL or an RTSP source in the ledger", async () => {
    await call.crop();
    await call.stream();
    await call.output();
    for (const row of audited) {
      const detail = String(row.detail ?? "");
      expect(detail).not.toMatch(/rtsp:|https?:\/\/|Bearer|token|signed/i);
      expect(detail.length).toBeLessThanOrEqual(400);
    }
  });

  // ── refusals do not ────────────────────────────────────────────────
  it("writes nothing when the session is rejected", async () => {
    state.auth = "unauthorized";
    for (const res of [await call.crop(), await call.view(), await call.stream(), await call.trail(), await call.csv(), await call.search()]) {
      expect(res.status).toBe(401);
    }
    expect(audited).toHaveLength(0);
  });

  it("writes nothing when the authority gate blocks a crop", async () => {
    state.level = 3;
    state.face = { image_path: "cam/legacy.jpg", crop_sealed: false };
    expect((await call.crop()).status).toBe(403);
    expect(audited).toHaveLength(0);
  });

  it("writes nothing when the object is missing or the render fails", async () => {
    state.rec = null;
    expect((await call.view()).status).toBe(404);
    state.rec = { id: REC, has_original: true };
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response("boom", { status: 500 }));
    expect((await call.view()).status).toBe(502);
    state.job = null;
    expect((await call.output()).status).toBe(404);
    expect(audited).toHaveLength(0);
  });

  it("does not record a stream the ML service never served", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response("not active", { status: 404 }));
    expect((await call.stream()).status).toBe(404);
    expect(rows(READ_ACTIONS.STREAM_VIEWED)).toHaveLength(0);
  });

  // ── live authorisation ─────────────────────────────────────────────
  it("refuses a disabled camera and files the refusal under its own action", async () => {
    state.camera = { id: CAM, enabled: false };
    const res = await call.stream();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "camera_disabled" });
    expect(rows(READ_ACTIONS.STREAM_VIEWED)).toHaveLength(0);
    expect(String(rows(READ_ACTIONS.STREAM_DENIED)[0]?.detail)).toContain("reason=camera_disabled");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a viewer with no explicit grant even when no camera is restricted", async () => {
    state.role = "viewer";
    state.canSee = true; // user_can_see_camera says "unrestricted" — not a grant
    state.grant = null;
    const res = await call.stream();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "camera_not_authorized" });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(rows(READ_ACTIONS.STREAM_DENIED)).toHaveLength(1);
  });

  it("lets a viewer with an explicit camera_permissions row watch", async () => {
    state.role = "viewer";
    state.grant = { id: "perm-1" };
    expect((await call.stream()).status).toBe(200);
    expect(rows(READ_ACTIONS.STREAM_VIEWED)).toHaveLength(1);
  });

  it("keeps admins streaming without a permission row", async () => {
    state.role = "admin";
    state.grant = null;
    expect((await call.stream()).status).toBe(200);
  });

  it("enforces the gate on segments too, and fails closed on a broken permission check", async () => {
    state.role = "viewer";
    state.grant = null;
    expect((await call.stream("seg1.ts")).status).toBe(403);
    state.role = "admin";
    state.permError = true;
    const res = await call.stream("seg1.ts");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "permission_check_failed" });
  });

  // ── volume control ─────────────────────────────────────────────────
  it("records a segment fetched without the playlist, and collapses the rest", async () => {
    // Segment names are deterministic (index0.ts, index1.ts, …), so logging
    // the playlist alone left a trace-free way to watch the unmasked feed.
    expect((await call.stream("index0.ts")).status).toBe(200);
    expect(rows(READ_ACTIONS.STREAM_VIEWED)).toHaveLength(1);
    for (const seg of ["index1.ts", "index2.ts"]) {
      expect((await call.stream(seg)).status).toBe(200);
    }
    expect((await call.stream()).status).toBe(200);
    // One row per operator per camera per window, playlist and segments alike.
    expect(rows(READ_ACTIONS.STREAM_VIEWED)).toHaveLength(1);
  });

  it("collapses a polling player to one row per camera per window", async () => {
    for (let i = 0; i < 10; i++) expect((await call.stream()).status).toBe(200);
    expect(rows(READ_ACTIONS.STREAM_VIEWED)).toHaveLength(1);
  });

  // ── ticket renewal (2026-09-28) ────────────────────────────────────
  // Players renew their five-minute ticket (lib/stream-ticket-renewal.ts);
  // neither an expired ticket nor a renewal may add ledger rows.
  it("refuses an expired ticket without a refusal code and without a ledger row", async () => {
    const res = await call.streamWithTicket("expired-t1");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBeUndefined();
    expect(audited).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("collapses a stream watched across ticket renewals into one row", async () => {
    for (const ticket of ["valid-t1", "valid-t2", "valid-t3"]) {
      expect((await call.streamWithTicket(ticket)).status).toBe(200);
      expect((await call.streamWithTicket(ticket, "index4.ts")).status).toBe(200);
    }
    const viewed = rows(READ_ACTIONS.STREAM_VIEWED);
    expect(viewed).toHaveLength(1);
    expect(String(viewed[0].detail)).not.toContain("valid-");
  });

  it("still applies the camera and grant checks to a renewed ticket", async () => {
    state.role = "viewer";
    state.grant = null;
    const res = await call.streamWithTicket("valid-t2");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "camera_not_authorized" });
    state.role = "admin";
    state.camera = { id: CAM, enabled: false };
    const off = await call.streamWithTicket("valid-t3", "index5.ts");
    expect(await off.json()).toMatchObject({ code: "camera_disabled" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("honours a row written by another instance (cross-instance probe)", async () => {
    state.ledgerHits = 1; // the ledger already has a matching row in the window
    expect((await call.stream()).status).toBe(200);
    expect(rows(READ_ACTIONS.STREAM_VIEWED)).toHaveLength(0);
  });

  it("still records a second operator watching the same camera", async () => {
    expect((await call.stream()).status).toBe(200);
    expect(rows(READ_ACTIONS.STREAM_VIEWED)).toHaveLength(1);
    // Same camera, different session identity → a distinct throttle key.
    const auth = jest.requireMock("@/lib/supabase/auth") as { requireUserApi: jest.Mock };
    auth.requireUserApi.mockImplementationOnce(async () => ({
      user: { id: "user-2", email: "other@example.test" },
      profile: { role: "admin" },
    }));
    expect((await call.stream()).status).toBe(200);
    expect(rows(READ_ACTIONS.STREAM_VIEWED)).toHaveLength(2);
  });

  it("keeps serving data when the ledger itself is unavailable", async () => {
    const server = jest.requireMock("@/lib/supabase/server") as { createServiceClient: jest.Mock | (() => unknown) };
    const original = server.createServiceClient;
    const quiet = jest.spyOn(console, "warn").mockImplementation(() => {});
    (server as { createServiceClient: () => unknown }).createServiceClient = () => {
      throw new Error("ledger offline");
    };
    try {
      expect((await call.trail()).status).toBe(200);
      expect(quiet).toHaveBeenCalled();
    } finally {
      (server as { createServiceClient: unknown }).createServiceClient = original;
      quiet.mockRestore();
    }
  });
});
