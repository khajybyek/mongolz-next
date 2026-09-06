/**
 * HTTP-level tests for /api/faces/[id]/secure-crop — the single endpoint every
 * gallery goes through (ADR 0009 / Tier 2). Auth, storage and the ML upstream
 * are mocked at the module boundary; the route code itself runs for real.
 */
import { NextRequest, NextResponse } from "next/server";

type FaceRow = { image_path: string; crop_sealed: boolean } | null;

const state: {
  auth: "ok" | "unauthorized" | "forbidden";
  face: FaceRow;
  level: number;
  storageBytes: Uint8Array | null;
} = { auth: "ok", face: null, level: 0, storageBytes: null };

jest.mock("@/lib/supabase/auth", () => ({
  requireAdminApi: jest.fn(async () => {
    if (state.auth === "unauthorized") return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
    if (state.auth === "forbidden") return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    return { user: { id: "admin-1", email: "a@x" }, profile: { role: "admin" } };
  }),
  isAuthErr: (r: unknown) => typeof r === "object" && r !== null && "error" in r,
}));

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === "faces" ? state.face : null }),
          single: async () => ({ data: table === "profiles" ? { reveal_level: state.level } : null }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        download: async () =>
          state.storageBytes
            ? { data: new Blob([state.storageBytes as BlobPart]), error: null }
            : { data: null, error: { message: "not found" } },
      }),
    },
  }),
}));

const FACE = "11111111-2222-4333-8444-555555555555";

function call(id: string) {
  // Route modules read env at import time → set before requiring.
  process.env.NEXT_PUBLIC_ML_SERVICE_URL = "https://ml.test";
  process.env.ML_SERVICE_TOKEN = "tok";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GET } = require("@/app/api/faces/[id]/secure-crop/route") as {
    GET: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  };
  return GET(new NextRequest(`http://localhost/api/faces/${id}/secure-crop`), { params: Promise.resolve({ id }) });
}

describe("GET /api/faces/[id]/secure-crop", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    state.auth = "ok";
    state.face = null;
    state.level = 0;
    state.storageBytes = null;
    global.fetch = jest.fn() as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it("rejects a non-UUID id before touching auth", async () => {
    const res = await call("../../etc/passwd");
    expect(res.status).toBe(400);
  });

  it("returns 401/403 from the auth helper untouched", async () => {
    state.auth = "unauthorized";
    expect((await call(FACE)).status).toBe(401);
    state.auth = "forbidden";
    expect((await call(FACE)).status).toBe(403);
  });

  it("404s an unknown face", async () => {
    expect((await call(FACE)).status).toBe(404);
  });

  it("streams a legacy plaintext crop from storage without calling ML", async () => {
    state.face = { image_path: "cam/legacy.jpg", crop_sealed: false };
    state.storageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const res = await call(FACE);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(state.storageBytes);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("proxies a sealed crop through ML with the caller's reveal_level", async () => {
    state.face = { image_path: "cam/sealed.jpg", crop_sealed: true };
    state.level = 2;
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    const res = await call(FACE);
    expect(res.status).toBe(200);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://ml.test/face/${FACE}/secure-crop?level=2`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("maps an ML 403 (below authority) to 403 and other failures to 502", async () => {
    state.face = { image_path: "cam/sealed.jpg", crop_sealed: true };
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response("no", { status: 403 }));
    expect((await call(FACE)).status).toBe(403);
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response("boom", { status: 500 }));
    expect((await call(FACE)).status).toBe(502);
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect((await call(FACE)).status).toBe(502);
  });
});
