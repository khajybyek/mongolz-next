/**
 * /api/privacy-zones — never_reveal zones are a live reveal control, so
 * deleting, disabling or loosening one needs a fresh TOTP step-up, writes
 * through the service role, notifies the other admins, and a delete of a
 * missing id is a 404 (it used to answer 200 and audit a deletion).
 */
import { DELETE, PATCH, POST } from "@/app/api/privacy-zones/route";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { scheduleSecurityEvent } from "@/lib/notify";

const ZONE = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
const CAM = "b0000000-0000-4000-8000-000000000001";
const calls: Array<{ client: string; table: string; op: string; arg?: unknown }> = [];
let deleteReturns: unknown[] = [{ id: ZONE }];

jest.mock("@/lib/supabase/auth", () => ({
  requireAdminApi: async () => ({ user: { id: "admin-1", email: "a@x.test" }, profile: { role: "admin" } }),
  isAuthErr: () => false,
}));
jest.mock("@/lib/auth/step-up", () => ({ ensureFreshReauth: jest.fn() }));
jest.mock("@/lib/notify", () => ({ scheduleSecurityEvent: jest.fn() }));
jest.mock("@/lib/supabase/server", () => {
  function client(name: string) {
    return {
      from: (table: string) => {
        const q: Record<string, unknown> = {};
        const record = (op: string, arg?: unknown) => {
          calls.push({ client: name, table, op, arg });
          return q;
        };
        q.insert = (row: unknown) => record("insert", row);
        q.update = (row: unknown) => record("update", row);
        q.delete = () => record("delete");
        q.eq = () => q;
        q.select = () => q;
        q.single = async () => ({ data: { id: ZONE }, error: null });
        q.maybeSingle = async () => ({ data: { id: ZONE }, error: null });
        q.then = (ok: (v: unknown) => unknown) =>
          Promise.resolve({ data: deleteReturns, error: null }).then(ok);
        return q;
      },
    };
  }
  return { createClient: async () => client("user"), createServiceClient: () => client("service") };
});

function req(method: string, url: string, body?: unknown) {
  return new Request(`https://app.test${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  calls.length = 0;
  deleteReturns = [{ id: ZONE }];
  jest.mocked(ensureFreshReauth).mockResolvedValue(null);
  jest.mocked(scheduleSecurityEvent).mockClear();
});

const writes = () => calls.filter((c) => c.table === "privacy_zones");

describe("step-up for loosening changes", () => {
  it("DELETE without a fresh step-up is refused before any write", async () => {
    jest.mocked(ensureFreshReauth).mockResolvedValue({ error: "REAUTH_REQUIRED" });
    const res = await DELETE(req("DELETE", `/api/privacy-zones?id=${ZONE}`));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "REAUTH_REQUIRED" });
    expect(writes()).toEqual([]);
  });

  it.each([{ enabled: false }, { never_reveal: false }, { enforce_vip_mask: false }])(
    "PATCH %j needs the step-up",
    async (patch) => {
      jest.mocked(ensureFreshReauth).mockResolvedValue({ error: "REAUTH_REQUIRED" });
      const res = await PATCH(req("PATCH", "/api/privacy-zones", { id: ZONE, ...patch }));
      expect(res.status).toBe(403);
      expect(writes()).toEqual([]);
    },
  );

  it("tightening stays one click", async () => {
    jest.mocked(ensureFreshReauth).mockResolvedValue({ error: "REAUTH_REQUIRED" });
    const res = await PATCH(req("PATCH", "/api/privacy-zones", { id: ZONE, enabled: true, never_reveal: true }));
    expect(res.status).toBe(200);
    expect(scheduleSecurityEvent).not.toHaveBeenCalled();
  });

  it("creating a zone WITHOUT never_reveal needs the step-up; a never_reveal zone does not", async () => {
    jest.mocked(ensureFreshReauth).mockResolvedValue({ error: "REAUTH_REQUIRED" });
    const zone = { camera_id: CAM, name: "door", x: 0, y: 0, w: 0.5, h: 0.5 };
    expect((await POST(req("POST", "/api/privacy-zones", { ...zone, never_reveal: false }))).status).toBe(403);
    expect((await POST(req("POST", "/api/privacy-zones", { ...zone, never_reveal: true }))).status).toBe(200);
  });
});

describe("writes", () => {
  it("DELETE writes with the service role, audits and notifies", async () => {
    const res = await DELETE(req("DELETE", `/api/privacy-zones?id=${ZONE}`));
    expect(res.status).toBe(200);
    const zoneWrites = writes();
    expect(zoneWrites).toEqual([{ client: "service", table: "privacy_zones", op: "delete", arg: undefined }]);
    expect(calls.some((c) => c.table === "audit_log")).toBe(true);
    expect(scheduleSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "PRIVACY_ZONE_DELETE" }));
  });

  it("DELETE of a missing zone is a 404 without an audit row", async () => {
    deleteReturns = [];
    const res = await DELETE(req("DELETE", `/api/privacy-zones?id=${ZONE}`));
    expect(res.status).toBe(404);
    expect(calls.some((c) => c.table === "audit_log")).toBe(false);
  });

  it("no write ever uses the user token", async () => {
    await PATCH(req("PATCH", "/api/privacy-zones", { id: ZONE, enabled: false }));
    await DELETE(req("DELETE", `/api/privacy-zones?id=${ZONE}`));
    expect(writes().every((c) => c.client === "service")).toBe(true);
  });
});
