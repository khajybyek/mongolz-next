import { NextRequest, NextResponse } from "next/server";

const JOB = "11111111-2222-4333-8444-555555555555";
const RECORDING = "22222222-2222-4333-8444-555555555555";
const SUSPECT = "33333333-2222-4333-8444-555555555555";
const state = {
  authStatus: 200,
  fresh: true,
  profile: { role: "admin", reveal_level: 0 } as { role: string; reveal_level: unknown } | null,
  profileError: false,
  profileThrows: false,
  job: { id: JOB, status: "completed", reveal_level: 0, output_path: `${JOB}.mp4`, progress: 100 } as Record<string, unknown> | null,
  storageError: false,
};
const inserted = jest.fn();
const signing = jest.fn();
const tables = jest.fn();

jest.mock("next/server", () => ({ ...jest.requireActual("next/server"), after: jest.fn() }));
jest.mock("@/lib/supabase/auth", () => ({
  requireAdminApi: jest.fn(async () => state.authStatus === 200
    ? { user: { id: "admin-1", email: "admin@example.test" }, profile: { role: "admin" } }
    : { error: NextResponse.json({ error: "forbidden" }, { status: state.authStatus }) }),
  isAuthErr: (r: object) => "error" in r,
}));
jest.mock("@/lib/auth/step-up", () => ({ hasFreshReauth: jest.fn(async () => state.fresh) }));
jest.mock("@/lib/rate-limit", () => ({ checkRateLimit: jest.fn(async () => ({ ok: true })), REVEAL_LIMIT: {} }));
jest.mock("@/lib/notify", () => ({ notifyRevealRequested: jest.fn() }));
jest.mock("@/lib/ml-client", () => ({ mlEmbed: jest.fn(), MLError: class extends Error {} }));
jest.mock("@/lib/supabase/server", () => {
  const client = () => ({
    from: (table: string) => {
      tables(table);
      const read = async () => {
        if (table === "profiles") {
          if (state.profileThrows) throw new Error("offline");
          return { data: state.profile, error: state.profileError ? { message: "offline" } : null };
        }
        if (table === "reveal_jobs") return { data: state.job, error: null };
        if (table === "recordings") return { data: { id: RECORDING, has_original: true, filename: "test.mp4" }, error: null };
        if (table === "suspects") return { data: { name: "fixture", embedding: [0.1] }, error: null };
        return { data: null, error: null };
      };
      return {
        select: () => ({ eq: () => ({ single: read, maybeSingle: read }) }),
        insert: (data: unknown) => {
          inserted(table, data);
          return { select: () => ({ single: async () => ({ data: { id: JOB }, error: null }) }) };
        },
      };
    },
    storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string, ttl: number) => {
      signing(bucket, path, ttl);
      return state.storageError
        ? { data: null, error: { message: "offline" } }
        : { data: { signedUrl: "https://storage.example.test/internal-token" }, error: null };
    } }) },
  });
  return { createServiceClient: client, createClient: async () => client() };
});

import { GET as getStatus } from "@/app/api/reveal/[jobId]/route";
import { GET as getOutput } from "@/app/api/reveal/[jobId]/output/route";
import { GET as getLevel } from "@/app/api/reveal/my-level/route";
import { POST as startReveal } from "@/app/api/reveal/start/route";

function status() {
  return getStatus(new NextRequest(`https://app.test/api/reveal/${JOB}`), { params: Promise.resolve({ jobId: JOB }) });
}
function output(range?: string) {
  return getOutput(new NextRequest(`https://app.test/api/reveal/${JOB}/output`, { headers: range ? { Range: range } : {} }), { params: Promise.resolve({ jobId: JOB }) });
}
function start() {
  const form = new FormData();
  form.set("recording_id", RECORDING);
  form.set("method", "suspect");
  form.set("suspect_id", SUSPECT);
  return startReveal(new NextRequest("https://app.test/api/reveal/start", { method: "POST", body: form }));
}

describe("reveal authority and media gateway", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
    state.authStatus = 200;
    state.fresh = true;
    state.profile = { role: "admin", reveal_level: 0 };
    state.profileError = false;
    state.profileThrows = false;
    state.job = { id: JOB, status: "completed", reveal_level: 0, output_path: `${JOB}.mp4`, progress: 100 };
    state.storageError = false;
    global.fetch = jest.fn().mockResolvedValue(new Response("video", { status: 200 }));
  });
  afterAll(() => { global.fetch = realFetch; });

  it.each([401, 403])("preserves auth denial %s across all routes", async (code) => {
    state.authStatus = code;
    for (const response of [await status(), await output(), await getLevel(), await start()]) expect(response?.status).toBe(code);
    expect(tables).not.toHaveBeenCalled();
    expect(signing).not.toHaveBeenCalled();
  });

  it.each([null, { role: "viewer", reveal_level: 0 }, { role: "auditor", reveal_level: 0 }, { role: "admin", reveal_level: null }, { role: "admin", reveal_level: "0" }, { role: "admin", reveal_level: -1 }, { role: "admin", reveal_level: 100 }, { role: "admin", reveal_level: 1.5 }])("fails closed on invalid profile %p before reading or creating jobs", async (profile) => {
    state.profile = profile;
    for (const response of [await status(), await output(), await getLevel(), await start()]) expect(response?.status).toBe(403);
    expect(tables.mock.calls.every(([table]) => table === "profiles")).toBe(true);
    expect(inserted).not.toHaveBeenCalled();
    expect(signing).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(["returned", "thrown"])("handles %s profile lookup failure without privileged fallback", async (kind) => {
    state.profileError = kind === "returned";
    state.profileThrows = kind === "thrown";
    for (const response of [await start(), await status(), await output(), await getLevel()]) expect(response?.status).toBe(503);
    expect(inserted).not.toHaveBeenCalled();
    expect(signing).not.toHaveBeenCalled();
  });

  it.each([[3, 0, 403], [3, 3, 200], [0, 3, 200], [99, 99, 200], [0, null, 403], [0, 100, 403], [0, -1, 403]])("caller L%s vs output L%s gives %s", async (caller, scope, code) => {
    state.profile!.reveal_level = caller;
    state.job!.reveal_level = scope;
    expect((await status())?.status).toBe(code);
    expect((await output())?.status).toBe(code);
    if (code === 403) expect(signing).not.toHaveBeenCalled();
  });

  it("requires current fresh reauth for completed metadata and every media request", async () => {
    expect((await output())?.status).toBe(200);
    signing.mockClear();
    state.fresh = false;
    for (const response of [await status(), await output("bytes=5-")]) {
      expect(response?.status).toBe(401);
      expect(await response?.json()).toEqual({ error: "REAUTH_REQUIRED" });
    }
    expect(signing).not.toHaveBeenCalled();
  });

  it("rechecks a demotion on the next Range request", async () => {
    expect((await output())?.status).toBe(200);
    signing.mockClear();
    state.profile!.reveal_level = 3;
    expect((await output("bytes=5-"))?.status).toBe(403);
    expect(signing).not.toHaveBeenCalled();
  });

  it("allows pending status polling after reauth expires without exposing media", async () => {
    state.fresh = false;
    state.job!.status = "pending_approval";
    const response = await status();
    expect(response?.status).toBe(200);
    const data = await response?.json();
    expect(data?.signed_url).toBeNull();
    expect((await output())?.status).toBe(404);
    expect(signing).not.toHaveBeenCalled();
  });

  it("returns only a same-origin media URL and no internal Storage path or token", async () => {
    const response = await status();
    expect(response?.headers.get("cache-control")).toContain("no-store");
    const data = await response?.json();
    expect(data.signed_url).toBe(`/api/reveal/${JOB}/output`);
    expect(data).not.toHaveProperty("output_path");
    expect(signing).not.toHaveBeenCalled();
  });

  it("streams byte ranges with media headers and no reusable upstream credentials", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(new Response("vid", { status: 206, headers: { "Content-Range": "bytes 0-2/8", "Content-Length": "3", "Accept-Ranges": "bytes" } }));
    const response = await output("bytes=0-2");
    expect(response?.status).toBe(206);
    expect(await response?.text()).toBe("vid");
    expect(response?.headers.get("content-range")).toBe("bytes 0-2/8");
    expect(response?.headers.get("cache-control")).toContain("no-store");
    expect(response?.headers.get("location")).toBeNull();
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers.get("Range")).toBe("bytes=0-2");
    expect(options.redirect).toBe("error");
    expect(signing).toHaveBeenCalledWith("revealed", `${JOB}.mp4`, 60);
  });

  it("does not disguise unavailable Storage as playable media", async () => {
    state.storageError = true;
    expect((await output())?.status).toBe(502);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("snapshots validated caller authority on an approval-gated job", async () => {
    state.profile!.reveal_level = 3;
    expect((await start()).status).toBe(200);
    expect(inserted).toHaveBeenCalledWith("reveal_jobs", expect.objectContaining({ reveal_level: 3, status: "pending_approval", requested_by: "admin-1" }));
  });
});
