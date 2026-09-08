jest.mock("@/lib/supabase/auth", () => ({
  requireAdminApi: jest.fn(async () => ({ user: { id: "admin" }, profile: { role: "admin" } })),
  isAuthErr: (value: unknown) => typeof value === "object" && value !== null && "error" in value,
}));

import { GET } from "@/app/api/health/ml/route";

describe("GET /api/health/ml", () => {
  const realFetch = global.fetch;
  const realUrl = process.env.NEXT_PUBLIC_ML_SERVICE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_ML_SERVICE_URL = "https://ml.test/health";
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = realFetch;
    if (realUrl === undefined) delete process.env.NEXT_PUBLIC_ML_SERVICE_URL;
    else process.env.NEXT_PUBLIC_ML_SERVICE_URL = realUrl;
  });

  it("returns healthy only for a valid 2xx payload", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ service: "mongolz-ml", active_cameras: 2 }), { status: 200 }));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", detail: "mongolz-ml — 2 cameras active" });
  });

  it.each([
    new Response(JSON.stringify({ service: "mongolz-ml", active_cameras: 0 }), { status: 503 }),
    new Response(JSON.stringify({ service: "mongolz-ml", active_cameras: "2" }), { status: 200 }),
    new Response(JSON.stringify({ service: "mongolz-ml", active_cameras: -1 }), { status: 200 }),
    new Response(JSON.stringify({ active_cameras: 2 }), { status: 200 }),
  ])("maps an unhealthy upstream response to 503", async (upstream) => {
    (global.fetch as jest.Mock).mockResolvedValue(upstream);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error", detail: "ML service reported an unhealthy response" });
  });

  it("fails closed when the service URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_ML_SERVICE_URL;
    const response = await GET();
    expect(response.status).toBe(503);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("maps network failures to 503", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("offline"));
    expect((await GET()).status).toBe(503);
  });
});
