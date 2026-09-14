import { NextRequest, NextResponse } from "next/server";
import { GET, POST } from "@/app/api/upload-jobs/[id]/route";
import { POST as upload } from "@/app/api/recording/upload/route";

const USER = "11111111-2222-4333-8444-555555555555";
const OTHER = "22222222-2222-4333-8444-555555555555";
const JOB = "99999999-8888-4777-8666-555555555555";
const REC = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const state: { auth: boolean; role: string; job: Record<string, unknown> | null; dbError: boolean } = { auth: true, role: "viewer", job: null, dbError: false };

jest.mock("@/lib/supabase/auth", () => ({
  requireUserApi: jest.fn(async () => state.auth ? { user: { id: USER }, profile: { role: state.role } } : { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }),
  isAuthErr: (value: object) => "error" in value,
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.job, error: state.dbError ? { message: "offline" } : null }) }) }) }) }) }));
const context = { params: Promise.resolve({ id: JOB }) };
function action(body: unknown) { return POST(new NextRequest(`https://example.test/api/upload-jobs/${JOB}`, { method: "POST", body: JSON.stringify(body) }), context); }
function get() { return GET(new NextRequest(`https://example.test/api/upload-jobs/${JOB}`), context); }

const originalFetch = global.fetch;
beforeEach(() => {
  state.auth = true; state.role = "viewer"; state.dbError = false;
  state.job = { id: JOB, recording_id: REC, requested_by: USER, status: "failed", progress: 17, error_message: "processing interrupted" };
  process.env.NEXT_PUBLIC_ML_SERVICE_URL = "https://ml.test";
  process.env.ML_SERVICE_TOKEN = "ml-test-token";
  global.fetch = jest.fn(async () => Response.json({ ok: true }));
});
afterAll(() => { global.fetch = originalFetch; });

describe("durable job owner boundary", () => {
  test("owner reads safe status from the caller-scoped database", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect((await res.json()).job.requested_by).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test("missing or foreign job never reaches privileged ML", async () => {
    state.job!.requested_by = OTHER;
    expect((await get()).status).toBe(404);
    expect((await action({ action: "retry", requested_by: OTHER, is_admin: true })).status).toBe(404);
    state.job = null;
    expect((await action({ action: "cancel" })).status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test("session and database failures do not become missing successful jobs", async () => {
    state.auth = false; expect((await get()).status).toBe(401);
    state.auth = true; state.dbError = true; expect((await get()).status).toBe(503);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test("retry uses trusted caller ownership, ignoring forged body flags", async () => {
    expect((await action({ action: "retry", requested_by: OTHER, is_admin: true })).status).toBe(200);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://ml.test/upload-jobs/${JOB}/retry`);
    expect(JSON.parse(init.body as string)).toEqual({ requested_by: USER, is_admin: false });
  });
  test("admin may manage another user's job with server-verified role", async () => {
    state.role = "admin"; state.job!.requested_by = OTHER;
    expect((await action({ action: "retry" })).status).toBe(200);
    const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ requested_by: USER, is_admin: true });
  });
  test.each(["delivering", "ready", "cancelled"])("cancel cannot interrupt a commit or terminal %s", async (status) => {
    state.job!.status = status;
    expect((await action({ action: "cancel" })).status).toBe(409);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test("retry of queued work cannot start a second worker", async () => {
    state.job!.status = "queued";
    expect((await action({ action: "retry" })).status).toBe(409);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test("worker error does not leak local paths or exception details", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(new Response("/private/upload/job-key.secret", { status: 500 }));
    const res = await action({ action: "retry" });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("/private");
  });
});

describe("upload acceptance is durable but not completed video", () => {
  function request() {
    const fd = new FormData();
    fd.append("file", new File(["video"], "sample.mp4", { type: "video/mp4" }));
    fd.append("requested_by", OTHER);
    return new NextRequest("https://example.test/api/recording/upload", { method: "POST", body: fd });
  }
  test("202 exposes a stable job and injects the authenticated owner", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(Response.json({ ok: true, status: "queued", job_id: JOB, recording_id: REC }, { status: 202 }));
    const res = await upload(request());
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true, status: "queued", job_id: JOB, recording_id: REC });
    const form = (global.fetch as jest.Mock).mock.calls[0][1].body as FormData;
    expect(form.get("requested_by")).toBe(USER);
  });
  test("old fire-and-forget response without a durable job is not accepted", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(Response.json({ ok: true, status: "processing", recording_id: REC }));
    expect((await upload(request())).status).toBe(502);
  });
});
