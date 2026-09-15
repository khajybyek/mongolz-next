import { createHash } from "node:crypto";
import JSZip from "jszip";
import { NextRequest } from "next/server";

const INCIDENT = "00000000-0000-0000-0000-000000000010";
const RECORDING = "00000000-0000-0000-0000-000000000020";
const EVIDENCE = "00000000-0000-0000-0000-000000000030";

const state = {
  fresh: true,
  auditError: false,
  mediaStatus: 200,
  rpc: jest.fn(),
  rows: {} as Record<string, unknown[]>,
};

jest.mock("@/lib/supabase/auth", () => ({
  requireAdminApi: jest.fn(async () => ({ user: { id: "admin-1", email: "admin@example.com" }, profile: { role: "admin" } })),
  isAuthErr: (value: unknown) => typeof value === "object" && value !== null && "error" in value,
}));
jest.mock("@/lib/auth/step-up", () => ({ hasFreshReauth: jest.fn(async () => state.fresh) }));

class MockQuery {
  constructor(private table: string) {}
  select() { return this; }
  eq() { return this; }
  ilike() { return this; }
  order() { return Promise.resolve({ data: state.rows[this.table] ?? [], error: null }); }
  maybeSingle() { return Promise.resolve({ data: (state.rows[this.table] ?? [])[0] ?? null, error: null }); }
}

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ from: (table: string) => new MockQuery(table) }),
  createClient: jest.fn(async () => ({ rpc: state.rpc })),
}));

function call() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GET } = require("@/app/api/incidents/[id]/evidence-package/route") as {
    GET: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
  };
  return GET(new NextRequest(`http://localhost/api/incidents/${INCIDENT}/evidence-package`), {
    params: Promise.resolve({ id: INCIDENT }),
  });
}

beforeEach(() => {
  state.fresh = true;
  state.auditError = false;
  state.mediaStatus = 200;
  state.rpc.mockReset().mockImplementation(async () => state.auditError
    ? { data: null, error: { message: "audit down" } }
    : { data: "00000000-0000-0000-0000-000000000099", error: null });
  state.rows = {
    incidents: [{ id: INCIDENT, title: "Gate review", status: "open", priority: "high", created_at: "2026-09-15T00:00:00Z", updated_at: "2026-09-15T00:00:00Z" }],
    incident_recordings: [{
      id: EVIDENCE, recording_id: RECORDING, recording_filename: "gate.mp4", camera_name: "Gate A",
      recording_started_at: "2026-09-15T00:00:00Z", clip_start_sec: 2, clip_end_sec: 7,
      note: "Person entered", legal_hold: true, added_at: "2026-09-15T00:01:00Z",
    }],
    incident_alerts: [], incident_faces: [], incident_events: [], audit_log: [],
  };
  process.env.NEXT_PUBLIC_ML_SERVICE_URL = "https://ml.example";
  process.env.ML_SERVICE_TOKEN = "secret";
  global.fetch = jest.fn(async (url: string | URL | Request) => {
    const isFrame = String(url).includes("evidence-frame");
    const body = isFrame ? new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]) : new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
    return new Response(body, { status: state.mediaStatus, headers: { "content-length": String(body.length) } });
  }) as jest.Mock;
});

it("builds a masked, checksummed ZIP and writes its audit record", async () => {
  const response = await call();
  expect(response.status).toBe(200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  expect(zip.file(`clips/01-${EVIDENCE}-masked.mp4`)).not.toBeNull();
  expect(zip.file(`images/01-${EVIDENCE}-masked.jpg`)).not.toBeNull();
  const manifestText = await zip.file("manifest.json")!.async("string");
  const manifest = JSON.parse(manifestText) as { privacy: string; files: Array<{ path: string; sha256: string }> };
  expect(manifest.privacy).toContain("fully masked");
  expect(manifest.files.map((file) => file.path)).toContain("README.txt");
  for (const file of manifest.files) {
    const bytes = await zip.file(file.path)!.async("uint8array");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
  }
  expect(state.rpc).toHaveBeenCalledWith("log_incident_evidence_export", expect.objectContaining({
    p_incident_id: INCIDENT,
    p_manifest_sha256: createHash("sha256").update(manifestText).digest("hex"),
    p_file_count: manifest.files.length + 2,
  }));
});

it("requires fresh reauthentication before rendering any media", async () => {
  state.fresh = false;
  const response = await call();
  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: "REAUTH_REQUIRED" });
  expect(global.fetch).not.toHaveBeenCalled();
});

it("does not release a package when the audit transaction fails", async () => {
  state.auditError = true;
  const response = await call();
  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({ error: "evidence export audit failed" });
});

it("fails the whole package when a masked artifact cannot be rendered", async () => {
  state.mediaStatus = 503;
  const response = await call();
  expect(response.status).toBe(502);
  expect(state.rpc).not.toHaveBeenCalled();
});
