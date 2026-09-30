/**
 * HTTP-level tests for /api/recordings/[id]/view (ADR 0010 on-demand blurred
 * view). Auth + DB + ML upstream mocked at the module boundary.
 */
import { NextRequest, NextResponse } from "next/server";

const state: {
  auth: "ok" | "unauthorized";
  role: "admin" | "viewer" | "auditor";
  rec: { id: string; has_original: boolean; blur_strategy?: string } | null;
} = { auth: "ok", role: "viewer", rec: null };

jest.mock("@/lib/supabase/auth", () => ({
  requireUserApi: jest.fn(async () => {
    if (state.auth === "unauthorized") return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
    return { user: { id: "u-1", email: "u@x" }, profile: { role: state.role } };
  }),
  isAuthErr: (r: unknown) => typeof r === "object" && r !== null && "error" in r,
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.rec }) }),
      }),
    }),
  }),
}));

const REC = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function call(id: string) {
  process.env.NEXT_PUBLIC_ML_SERVICE_URL = "https://ml.test";
  process.env.ML_SERVICE_TOKEN = "tok";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GET } = require("@/app/api/recordings/[id]/view/route") as {
    GET: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  };
  return GET(new NextRequest(`http://localhost/api/recordings/${id}/view`), { params: Promise.resolve({ id }) });
}

describe("GET /api/recordings/[id]/view", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    state.auth = "ok";
    state.role = "viewer";
    state.rec = null;
    global.fetch = jest.fn() as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it("validates the id and requires a session", async () => {
    expect((await call("nope")).status).toBe(400);
    state.auth = "unauthorized";
    expect((await call(REC)).status).toBe(401);
  });

  it("locks the auditor role out of playback", async () => {
    state.role = "auditor";
    state.rec = { id: REC, has_original: true };
    expect((await call(REC)).status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("404s a missing recording or one without an encrypted original", async () => {
    expect((await call(REC)).status).toBe(404);
    state.rec = { id: REC, has_original: false };
    expect((await call(REC)).status).toBe(404);
  });

  it("streams the ML-rendered MP4 for an operator", async () => {
    state.rec = { id: REC, has_original: true };
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(new Uint8Array([0, 0, 0, 1]), { status: 200, headers: { "content-type": "video/mp4" } }),
    );
    const res = await call(REC);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toBe(`https://ml.test/recording/${REC}/view`);
  });

  it("streams a face-encrypted recording (ADR 0013) although it keeps no raw original", async () => {
    state.rec = { id: REC, has_original: false, blur_strategy: "face_encrypted" };
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(new Uint8Array([0, 0, 0, 1]), { status: 200, headers: { "content-type": "video/mp4" } }),
    );
    const res = await call(REC);
    expect(res.status).toBe(200);
    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toBe(`https://ml.test/recording/${REC}/view`);
  });

  it("still 404s an on_demand row without an original", async () => {
    state.rec = { id: REC, has_original: false, blur_strategy: "on_demand" };
    expect((await call(REC)).status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("maps upstream 404 → 404 and other failures → 502", async () => {
    state.rec = { id: REC, has_original: true };
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response("missing", { status: 404 }));
    expect((await call(REC)).status).toBe(404);
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response("render failed", { status: 500 }));
    expect((await call(REC)).status).toBe(502);
  });
});
