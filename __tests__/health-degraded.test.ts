/**
 * /health must not paint a broken dependency green:
 *  - ML answering `ok` with a degraded tailnet (no camera can deliver a frame)
 *    is reported as `degraded`, not `ok — 0 cameras active`;
 *  - the storage probe uses the service role and checks the expected
 *    buckets (the user JWT sees no row of storage.buckets → "ok · 0 buckets").
 */
jest.mock("@/lib/supabase/auth", () => ({
  requireAdminApi: jest.fn(async () => ({ user: { id: "admin" }, profile: { role: "admin" } })),
  isAuthErr: (value: unknown) => typeof value === "object" && value !== null && "error" in value,
}));

let mockBuckets: Array<{ id: string }> = [];
let mockAuditRows: Array<{ action: string; created_at: string; detail: string }> = [];
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ storage: { listBuckets: async () => ({ data: [], error: null }) } }),
  createServiceClient: () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "in", "gte", "order"]) q[m] = () => q;
    q.limit = async () => ({ data: mockAuditRows, error: null });
    return {
      storage: { listBuckets: async () => ({ data: mockBuckets, error: null }) },
      from: () => q,
    };
  },
}));

import { GET as mlHealth } from "@/app/api/health/ml/route";
import { GET as storageHealth } from "@/app/api/health/storage/route";
import { GET as opsHealth } from "@/app/api/health/ops/route";

describe("GET /api/health/ml tunnel state", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_ML_SERVICE_URL = "https://ml.test/";
    global.fetch = jest.fn();
  });

  it("reports degraded when the requested tunnel cannot reach the camera LAN", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          service: "mongolz-ml",
          active_cameras: 0,
          tunnel: { requested: true, state: "degraded", target_ok: false, reason: "socks5 connect failed via rtsp://admin:pw@10.0.0.9" },
        }),
        { status: 200 },
      ),
    );
    const res = await mlHealth();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.detail).toContain("tunnel degraded");
    expect(body.detail).not.toContain("admin:pw");
  });

  it.each([
    { requested: false, state: "disabled" },
    { requested: true, state: "ok" },
    { requested: true, state: "unknown" },
  ])("stays ok for tunnel %j", async (tunnel) => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ service: "mongolz-ml", active_cameras: 1, tunnel }), { status: 200 }),
    );
    expect((await (await mlHealth()).json()).status).toBe("ok");
  });
});

describe("GET /api/health/storage", () => {
  const all = ["alert-screenshots", "branding", "faces", "recordings", "revealed", "suspects"];

  it("is ok only when every expected bucket exists (service-role listing)", async () => {
    mockBuckets = all.map((id) => ({ id }));
    const res = await storageHealth();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", detail: "6/6 buckets present" });
  });

  it("names the missing buckets with a 503", async () => {
    mockBuckets = all.filter((id) => id !== "faces" && id !== "recordings").map((id) => ({ id }));
    const res = await storageHealth();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error", detail: "missing: faces, recordings" });
  });
});

describe("GET /api/health/ops", () => {
  it("is ok with no recent alarms (a passing backup run is not an alarm)", async () => {
    mockAuditRows = [
      { action: "BACKUP_VERIFY", created_at: "2026-09-22T03:00:00Z", detail: JSON.stringify({ sample_size: 5, failures: 0 }) },
    ];
    expect(await (await opsHealth()).json()).toEqual({ status: "ok", detail: "no alarms in 8 days" });
  });

  it("surfaces the latest overdue keys and failed backups as degraded — names and counts only", async () => {
    mockAuditRows = [
      {
        action: "KEY_ROTATION_DUE",
        created_at: "2026-09-21T05:00:00Z",
        detail: JSON.stringify({ overdue_keys: [{ name: "ML_SERVICE_TOKEN", age_days: 136, basis: "inception" }] }),
      },
      { action: "BACKUP_VERIFY", created_at: "2026-09-20T03:00:00Z", detail: JSON.stringify({ sample_size: 5, failures: 2 }) },
    ];
    const res = await opsHealth();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.detail).toContain("ML_SERVICE_TOKEN 136d");
    expect(body.detail).toContain("backup verify 2026-09-20: 2/5 failed");
  });
});
