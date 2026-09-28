/**
 * getActiveCamerasAction (app/(app)/live/actions.ts) feeds /live and /grid.
 * The ML service knows every camera it captures or is reconnecting; the
 * action must only pass on the ones the caller can list through RLS (enabled
 * cameras), and never anything URL-shaped.
 */
const VISIBLE_RUNNING = "11111111-1111-4111-8111-111111111111";
const VISIBLE_BACKOFF = "22222222-2222-4222-8222-222222222222";
const HIDDEN_RUNNING = "33333333-3333-4333-8333-333333333333";
const HIDDEN_BACKOFF = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;
const mockMl = { status: null as null | { active: Row[]; reconnecting: Row[] } };
const mockDb = {
  visible: [] as string[],
  queries: [] as Array<{ table: string; ids: string[]; filters: Array<[string, unknown]> }>,
};
const mockRequireOperator = jest.fn(async () => ({ user: { id: "u" }, profile: { role: "viewer" } }));

jest.mock("@/lib/supabase/auth", () => ({
  requireAdmin: jest.fn(),
  requireOperator: () => mockRequireOperator(),
}));
jest.mock("@/lib/ml-client", () => ({
  mlCameraSupervision: jest.fn(async () => mockMl.status),
  mlStartCamera: jest.fn(),
  mlStopCamera: jest.fn(),
}));
jest.mock("@/lib/camera-crypto", () => ({ unwrapCameraUrlForRuntime: jest.fn() }));
jest.mock("@/lib/stream-ticket", () => ({ issueStreamTicket: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: jest.fn(),
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        in: (_col: string, ids: string[]) => ({
          eq: async (col: string, val: unknown) => {
            mockDb.queries.push({ table, ids, filters: [[col, val]] });
            // RLS + enabled: only what the caller may list comes back.
            return { data: ids.filter((id) => mockDb.visible.includes(id)).map((id) => ({ id })), error: null };
          },
        }),
      }),
    }),
  }),
}));

import { getActiveCamerasAction } from "@/app/(app)/live/actions";

beforeEach(() => {
  mockDb.visible = [VISIBLE_RUNNING, VISIBLE_BACKOFF];
  mockDb.queries = [];
  mockRequireOperator.mockClear();
  mockMl.status = {
    active: [
      { camera_id: VISIBLE_RUNNING, restart_count: 2, last_error: "source dropped (no frames)", state: "running" },
      { camera_id: HIDDEN_RUNNING, restart_count: 5, last_error: "capture failed: OSError", state: "running" },
      { camera_id: "not-a-uuid", restart_count: 1 },
    ],
    reconnecting: [
      {
        camera_id: VISIBLE_BACKOFF,
        restart_count: 0,
        last_error: "source unreachable at open",
        state: "backoff",
        next_retry_at: "2026-09-27T05:04:30Z",
      },
      { camera_id: HIDDEN_BACKOFF, restart_count: 9, last_error: "secret-reason", state: "backoff" },
    ],
  };
});

describe("getActiveCamerasAction", () => {
  it("requires an operator before asking anything", async () => {
    mockRequireOperator.mockRejectedValueOnce(new Error("redirect"));
    await expect(getActiveCamerasAction()).rejects.toThrow("redirect");
    expect(mockDb.queries).toHaveLength(0);
  });

  it("filters running and backoff cameras through RLS on enabled cameras", async () => {
    const res = await getActiveCamerasAction();
    expect(res.reachable).toBe(true);
    // Only running cameras are streams.
    expect(res.ids).toEqual([VISIBLE_RUNNING]);
    expect(res.restarts).toEqual({
      [VISIBLE_RUNNING]: { count: 2, lastError: "source dropped (no frames)", state: "running", nextRetryAt: null },
      [VISIBLE_BACKOFF]: {
        count: 0,
        lastError: "source unreachable at open",
        state: "backoff",
        nextRetryAt: "2026-09-27T05:04:30.000Z",
      },
    });
    const text = JSON.stringify(res);
    expect(text).not.toContain(HIDDEN_RUNNING);
    expect(text).not.toContain(HIDDEN_BACKOFF);
    expect(text).not.toContain("secret-reason");
    // One query, on cameras, UUIDs only, enabled only.
    expect(mockDb.queries).toEqual([
      {
        table: "cameras",
        ids: [VISIBLE_RUNNING, HIDDEN_RUNNING, VISIBLE_BACKOFF, HIDDEN_BACKOFF],
        filters: [["enabled", true]],
      },
    ]);
  });

  it("lists visible running cameras that are in private mode by schedule, nothing else", async () => {
    mockMl.status = {
      active: [
        { camera_id: VISIBLE_RUNNING, state: "running", privacy_mode: "private" },
        { camera_id: HIDDEN_RUNNING, state: "running", privacy_mode: "private" },
      ],
      reconnecting: [{ camera_id: VISIBLE_BACKOFF, state: "backoff", privacy_mode: "private" }],
    };
    const res = await getActiveCamerasAction();
    expect(res.privateIds).toEqual([VISIBLE_RUNNING]);

    mockMl.status = { active: [{ camera_id: VISIBLE_RUNNING, privacy_mode: "standard" }], reconnecting: [] };
    expect((await getActiveCamerasAction()).privateIds).toEqual([]);
    // An ML build without the field reports no private camera.
    mockMl.status = { active: [{ camera_id: VISIBLE_RUNNING }], reconnecting: [] };
    expect((await getActiveCamerasAction()).privateIds).toEqual([]);
  });

  it("tells a fail-closed capture (schedule unreadable) apart from a private window", async () => {
    mockMl.status = {
      active: [
        { camera_id: VISIBLE_RUNNING, state: "running", privacy_mode: "private", privacy_source: "fail_closed" },
        { camera_id: HIDDEN_RUNNING, state: "running", privacy_mode: "private", privacy_source: "fail_closed" },
      ],
      reconnecting: [],
    };
    const res = await getActiveCamerasAction();
    expect(res.privateIds).toEqual([VISIBLE_RUNNING]);
    expect(res.failClosedIds).toEqual([VISIBLE_RUNNING]);
    mockMl.status = {
      active: [{ camera_id: VISIBLE_RUNNING, privacy_mode: "private", privacy_source: "schedule" }],
      reconnecting: [],
    };
    expect((await getActiveCamerasAction()).failClosedIds).toEqual([]);
  });

  it("shows nothing to a caller who may list no camera", async () => {
    mockDb.visible = [];
    const res = await getActiveCamerasAction();
    expect(res).toEqual({ reachable: true, ids: [], restarts: {}, privateIds: [], failClosedIds: [] });
  });

  it("reports an unreachable ML service without querying the database", async () => {
    mockMl.status = null;
    expect(await getActiveCamerasAction()).toEqual({ reachable: false, ids: [], restarts: {}, privateIds: [], failClosedIds: [] });
    expect(mockDb.queries).toHaveLength(0);
  });

  it("skips the database when the ML service reports nothing", async () => {
    mockMl.status = { active: [], reconnecting: [] };
    expect(await getActiveCamerasAction()).toEqual({ reachable: true, ids: [], restarts: {}, privateIds: [], failClosedIds: [] });
    expect(mockDb.queries).toHaveLength(0);
  });
});
