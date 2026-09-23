/**
 * 4-eyes reveal decisions (app/(app)/reveal-approvals/actions.ts). Approving
 * is what triggers decryption, so the server action carries the whole gate:
 * step-up before any read, approver ≠ requester, reveal_level authority, a
 * compare-and-set on pending_approval, and an ML failure that must not undo a
 * valid approval.
 */
const ADMIN = { id: "11111111-1111-4111-8111-111111111111", email: "approver@example.test" };
const REQUESTER = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";
const RECORDING = "44444444-4444-4444-8444-444444444444";
const FACE = "55555555-5555-4555-8555-555555555555";

type Job = Record<string, unknown>;
const mockDb = {
  job: null as Job | null,
  casRows: [{ id: JOB }] as Array<{ id: string }> | null,
  casError: null as { message: string } | null,
  fromCalls: [] as string[],
  updates: [] as Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  audits: [] as Array<Record<string, unknown>>,
};
const mockAuth = { reauth: null as null | { error: string }, level: 0 as number | "error" };
const mockMl = { trigger: jest.fn(async (_id: string) => ({ ok: true })) };
const mockNotify = jest.fn(async (_input: unknown) => undefined);

jest.mock("@/lib/supabase/auth", () => ({
  requireAdmin: jest.fn(async () => ({ user: ADMIN, profile: { role: "admin", totp_enabled: true } })),
}));
jest.mock("@/lib/auth/step-up", () => ({
  ensureFreshReauth: jest.fn(async () => mockAuth.reauth),
}));
jest.mock("@/lib/reveal-authority", () => ({
  ...jest.requireActual("@/lib/reveal-authority"),
  readRevealAuthority: jest.fn(async () =>
    mockAuth.level === "error" ? { error: new Response(null, { status: 503 }) } : { level: mockAuth.level },
  ),
}));
jest.mock("@/lib/ml-client", () => {
  class MLError extends Error {
    constructor(message: string, public status?: number) {
      super(message);
      this.name = "MLError";
    }
  }
  return { MLError, mlTriggerReveal: (id: string) => mockMl.trigger(id) };
});
jest.mock("@/lib/notify", () => ({ notifyRevealDecision: (input: unknown) => mockNotify(input) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: (fn: () => unknown) => void fn(),
}));
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      mockDb.fromCalls.push(table);
      if (table === "audit_log") {
        return { insert: async (row: Record<string, unknown>) => void mockDb.audits.push(row) };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: mockDb.job, error: null }) }),
        }),
        update: (patch: Record<string, unknown>) => {
          const entry = { patch, filters: [] as Array<[string, unknown]> };
          mockDb.updates.push(entry);
          const chain = {
            eq: (col: string, val: unknown) => {
              entry.filters.push([col, val]);
              return chain;
            },
            select: async () => ({ data: mockDb.casRows, error: mockDb.casError }),
            then: (resolve: (v: unknown) => void) => resolve({ error: null }),
          };
          return chain;
        },
      };
    },
  }),
}));

import { approveRevealAction, rejectRevealAction } from "@/app/(app)/reveal-approvals/actions";

function validJob(overrides: Job = {}): Job {
  return {
    id: JOB,
    status: "pending_approval",
    requested_by: REQUESTER,
    requested_email: "requester@example.test",
    recording_id: RECORDING,
    reveal_level: 2,
    reason: "Case 2026-091: theft at the gate, verify the person",
    request_scope: {
      version: 1,
      recording: { id: RECORDING, filename: "gate.mp4", duration_sec: 60 },
      method: "detected_face",
      targets: [{ id: FACE, label: "face 1" }],
      threshold: 0.5,
      start_sec: null,
      end_sec: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockDb.job = validJob();
  mockDb.casRows = [{ id: JOB }];
  mockDb.casError = null;
  mockDb.fromCalls = [];
  mockDb.updates = [];
  mockDb.audits = [];
  mockAuth.reauth = null;
  mockAuth.level = 0;
  mockMl.trigger.mockReset();
  mockMl.trigger.mockResolvedValue({ ok: true });
  mockNotify.mockClear();
});

const REASON = "Not proportionate to the case";

describe.each([
  ["approve", () => approveRevealAction(JOB)],
  ["reject", () => rejectRevealAction(JOB, REASON)],
] as const)("%sRevealAction", (_name, run) => {
  it("asks for step-up before reading anything", async () => {
    mockAuth.reauth = { error: "REAUTH_REQUIRED" };
    expect(await run()).toEqual({ error: "REAUTH_REQUIRED" });
    expect(mockDb.fromCalls).toEqual([]);
  });

  it("returns NOT_FOUND for a missing job", async () => {
    mockDb.job = null;
    expect(await run()).toEqual({ error: "NOT_FOUND" });
  });

  it("returns ALREADY_DECIDED for a job that left pending_approval", async () => {
    mockDb.job = validJob({ status: "queued" });
    expect(await run()).toEqual({ error: "ALREADY_DECIDED" });
    expect(mockDb.updates).toEqual([]);
  });

  it("refuses the requester deciding their own job (SELF)", async () => {
    mockDb.job = validJob({ requested_by: ADMIN.id });
    expect(await run()).toEqual({ error: "SELF" });
    expect(mockDb.updates).toEqual([]);
  });

  it("hides a job above the decider's reveal authority (NOT_FOUND)", async () => {
    mockAuth.level = 5; // job is L2; a higher number is narrower authority
    expect(await run()).toEqual({ error: "NOT_FOUND" });
    expect(mockDb.updates).toEqual([]);
  });

  it("refuses when authority cannot be read", async () => {
    mockAuth.level = "error";
    expect(await run()).toEqual({ error: "INVALID" });
    expect(mockDb.updates).toEqual([]);
  });

  it("loses the compare-and-set race gracefully (0 rows → ALREADY_DECIDED)", async () => {
    mockDb.casRows = [];
    expect(await run()).toEqual({ error: "ALREADY_DECIDED" });
    expect(mockDb.updates[0]!.filters).toEqual([["id", JOB], ["status", "pending_approval"]]);
    expect(mockDb.audits).toEqual([]);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("maps a database error to DB", async () => {
    mockDb.casError = { message: "boom" };
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await run()).toEqual({ error: "DB" });
    spy.mockRestore();
  });
});

describe("approveRevealAction", () => {
  it("rejects a malformed job id", async () => {
    expect(await approveRevealAction("not-a-uuid")).toEqual({ error: "INVALID" });
    expect(mockDb.fromCalls).toEqual([]);
  });

  it("refuses a job without a valid reason or scope", async () => {
    mockDb.job = validJob({ reason: "short" });
    expect((await approveRevealAction(JOB)) as { error: string }).toMatchObject({ error: "INVALID" });
    mockDb.job = validJob({ request_scope: null });
    expect((await approveRevealAction(JOB)) as { error: string }).toMatchObject({ error: "INVALID" });
    expect(mockDb.updates).toEqual([]);
  });

  it("queues the job, triggers ML, audits and notifies the requester", async () => {
    expect(await approveRevealAction(JOB)).toEqual({ ok: true });
    expect(mockDb.updates[0]!.patch).toMatchObject({ status: "queued", approved_by: ADMIN.id });
    expect(mockMl.trigger).toHaveBeenCalledWith(JOB);
    expect(mockDb.audits.map((a) => a.action)).toEqual(["REVEAL_APPROVE"]);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ jobId: JOB, approved: true, requesterId: REQUESTER }));
  });

  it("keeps the approval when the ML trigger fails (deferred to the worker)", async () => {
    mockMl.trigger.mockRejectedValue(new Error("connect ECONNREFUSED"));
    expect(await approveRevealAction(JOB)).toEqual({ ok: true });
    // The follow-up write only annotates a still-queued row; it never resets status.
    const followUp = mockDb.updates[1]!;
    expect(followUp.patch).toEqual({ error_message: "Awaiting worker: ML service unreachable" });
    expect(followUp.filters).toEqual([["id", JOB], ["status", "queued"]]);
    expect(mockDb.audits.map((a) => a.action)).toEqual(["REVEAL_APPROVE_DEFERRED", "REVEAL_APPROVE"]);
  });
});

describe("rejectRevealAction", () => {
  it.each(["", "no", "  ab  "])("requires a reason of at least 3 characters (%j)", async (reason) => {
    expect(await rejectRevealAction(JOB, reason)).toEqual({ error: "INVALID" });
    expect(mockDb.fromCalls).toEqual([]);
  });

  it("records the rejection with the trimmed reason and notifies the requester", async () => {
    expect(await rejectRevealAction(JOB, `  ${REASON}  `)).toEqual({ ok: true });
    expect(mockDb.updates[0]!.patch).toMatchObject({ status: "rejected", rejected_by: ADMIN.id, rejected_reason: REASON });
    expect(mockDb.audits.map((a) => a.action)).toEqual(["REVEAL_REJECT"]);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ approved: false, reason: REASON }));
  });
});
