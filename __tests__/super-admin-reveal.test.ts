/**
 * Super-admin reveal without a second admin (owner decision 2026-09-30,
 * ADR 0003 amendment, migration 20260930120000).
 *
 * The route writes REVEAL_REQUEST + REVEAL_SUPER_ADMIN_SELF_APPROVED FIRST,
 * then files the super admin's reveal as queued + approved by the requester
 * (approval_required = false), tells the other admins and starts the ML job.
 * The durable ML worker claims any queued row on its own, so the ledger must
 * exist before the row does (review finding SEC-1). Every other admin — and the super admin while the kill switch is off —
 * keeps the unchanged pending_approval flow. The database verdict
 * (public.super_admin_self_reveal_allowed) decides; the SQL side is covered
 * by supabase/tests/super_admin_reveal.test.sql.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";

const RECORDING = "22222222-2222-4333-8444-555555555555";
const SUSPECT = "33333333-2222-4333-8444-555555555555";
const SUPER = { id: "aaaaaaaa-1111-4111-8111-111111111111", email: "owner@example.test" };

type Insert = { table: string; data: unknown };
type Update = { table: string; patch: Record<string, unknown>; filters: Array<[string, unknown]> };

const mock = {
  isSuperAdmin: true as boolean | undefined,
  rpc: { data: true as unknown, error: null as { code?: string; message: string } | null, throws: false },
  rpcCalls: [] as Array<[string, unknown]>,
  /** hasFreshReauth(id, { allowPassword: true }) — any factor. */
  freshAny: true,
  /** hasFreshReauth(id) — the TOTP factor. */
  freshTotp: true,
  inserts: [] as Insert[],
  updates: [] as Update[],
  /** Error codes returned by successive reveal_jobs inserts (null = success, "" = no SQLSTATE, e.g. a network failure). */
  jobInsertErrors: [] as Array<string | null>,
  /** Error returned by every audit_log insert (unless auditErrors has an entry). */
  auditError: null as { message: string } | null,
  /** Errors for successive audit_log inserts; undefined entries fall back to auditError. */
  auditErrors: [] as Array<{ message: string } | null>,
  /** Answer of the compensating cancel (update … .select("id")). */
  cancel: { rows: 1, error: null as { code?: string; message: string } | null },
  mlFails: false,
  /** "table:op" in call order. */
  ops: [] as string[],
  /**
   * What the durable worker's claim would see at the instant each reveal_jobs
   * row is committed: is the requester's REVEAL_SUPER_ADMIN_SELF_APPROVED row
   * naming that job already in the ledger? (claim_reveal_job requires it.)
   */
  ledgerAtJobInsert: [] as Array<{ id: string; ledger: boolean }>,
};
const mlTrigger = jest.fn(async (_id: string) => {
  if (mock.mlFails) throw new Error("offline");
});
const notifyRequested = jest.fn();
const securityEvent = jest.fn();
const afterMock = jest.fn();

jest.mock("next/server", () => ({ ...jest.requireActual("next/server"), after: (fn: () => unknown) => afterMock(fn) }));
jest.mock("@/lib/supabase/auth", () => ({
  requireAdminApi: jest.fn(async () => ({
    user: SUPER,
    profile: { role: "admin", totp_enabled: true, is_super_admin: mock.isSuperAdmin },
  })),
  isAuthErr: (r: object) => "error" in r,
}));
jest.mock("@/lib/auth/step-up", () => ({
  hasFreshReauth: jest.fn(async (_id: string, opts?: { allowPassword?: boolean }) =>
    opts?.allowPassword ? mock.freshAny : mock.freshTotp),
}));
jest.mock("@/lib/rate-limit", () => ({ checkRateLimit: jest.fn(async () => ({ ok: true })), REVEAL_LIMIT: {} }));
jest.mock("@/lib/notify", () => ({
  notifyRevealRequested: (input: unknown) => notifyRequested(input),
  scheduleSecurityEvent: (input: unknown) => securityEvent(input),
}));
jest.mock("@/lib/ml-client", () => {
  class MLError extends Error {}
  return { MLError, mlEmbed: jest.fn(), mlTriggerReveal: (id: string) => mlTrigger(id) };
});
jest.mock("@/lib/supabase/server", () => {
  const client = () => ({
    rpc: async (fn: string, args: unknown) => {
      mock.rpcCalls.push([fn, args]);
      if (mock.rpc.throws) throw new Error("network");
      return { data: mock.rpc.data, error: mock.rpc.error };
    },
    from: (table: string) => {
      const read = async () => {
        if (table === "profiles") return { data: { role: "admin", reveal_level: 0 }, error: null };
        if (table === "recordings") {
          return { data: { id: RECORDING, has_original: true, filename: "incident.mp4", duration_sec: 60 }, error: null };
        }
        if (table === "suspects") return { data: { name: "Fixture subject", embedding: [0.1] }, error: null };
        return { data: null, error: null };
      };
      return {
        select: () => ({ eq: () => ({ single: read, maybeSingle: read }) }),
        insert: (data: unknown) => {
          mock.ops.push(`${table}:insert`);
          if (table === "audit_log") {
            const queued = mock.auditErrors.shift();
            const error = queued === undefined ? mock.auditError : queued;
            // A failed statement writes nothing.
            if (!error) mock.inserts.push({ table, data });
            return Promise.resolve({ error });
          }
          const code = mock.jobInsertErrors.shift() ?? null;
          const row = data as { id: string; requested_by?: string };
          mock.ledgerAtJobInsert.push({
            id: row.id,
            ledger: mockLedgerRows().some(
              (r) =>
                r.action === "REVEAL_SUPER_ADMIN_SELF_APPROVED" &&
                r.user_id === row.requested_by &&
                String(r.detail).startsWith(`job ${row.id} `),
            ),
          });
          mock.inserts.push({ table, data });
          return {
            select: () => ({
              single: async () =>
                code !== null
                  ? { data: null, error: { code, message: code ? "refused" : "fetch failed" } }
                  : { data: { id: row.id }, error: null },
            }),
          };
        },
        update: (patch: Record<string, unknown>) => {
          mock.ops.push(`${table}:update`);
          const entry: Update = { table, patch, filters: [] };
          mock.updates.push(entry);
          const chain = {
            eq: (col: string, val: unknown) => {
              entry.filters.push([col, val]);
              return chain;
            },
            select: async () =>
              mock.cancel.error
                ? { data: null, error: mock.cancel.error }
                : { data: Array.from({ length: mock.cancel.rows }, () => ({ id: "x" })), error: null },
            then: (resolve: (v: unknown) => void) => resolve({ error: null }),
          };
          return chain;
        },
      };
    },
  });
  return { createServiceClient: client, createClient: async () => client() };
});

function mockLedgerRows(): Array<Record<string, unknown>> {
  return mock.inserts
    .filter((i) => i.table === "audit_log")
    .flatMap((i) => (Array.isArray(i.data) ? i.data : [i.data])) as Array<Record<string, unknown>>;
}

import { POST as startReveal } from "@/app/api/reveal/start/route";
import {
  isDatabaseVerdict,
  isSelfApprovedReveal,
  readSuperAdminSelfReveal,
  REVEAL_START_UNCONFIRMED_CODE,
  REVEAL_TOTP_REQUIRED_CODE,
  SELF_APPROVAL_ABORTED_AUDIT_ACTION,
  SELF_APPROVED_AUDIT_ACTION,
  selfApprovalAuditDetail,
} from "@/lib/reveal-self-approval";
import { revealStartRefusal } from "@/lib/reveal-errors";
import {
  defaultRevealStepUpFactor,
  revealStepUpFactors,
  revealStepUpIsFresh,
} from "@/lib/step-up-client";
import { LangProvider } from "@/lib/i18n/client";
import { T, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { RevealStepUpFields } from "@/app/(app)/playback/[id]/reveal-step-up-fields";
import { RevealModal } from "@/app/(app)/playback/[id]/reveal-modal";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

function start() {
  const form = new FormData();
  form.set("recording_id", RECORDING);
  form.set("method", "suspect");
  form.set("reason", "Investigate the reported entry incident");
  form.set("suspect_id", SUSPECT);
  return startReveal(new NextRequest("https://app.test/api/reveal/start", { method: "POST", body: form }));
}

const jobInserts = () => mock.inserts.filter((i) => i.table === "reveal_jobs").map((i) => i.data as Record<string, unknown>);
const auditRows = mockLedgerRows;

beforeEach(() => {
  mock.isSuperAdmin = true;
  mock.rpc = { data: true, error: null, throws: false };
  mock.rpcCalls = [];
  mock.freshAny = true;
  mock.freshTotp = true;
  mock.inserts = [];
  mock.updates = [];
  mock.jobInsertErrors = [];
  mock.auditError = null;
  mock.auditErrors = [];
  mock.cancel = { rows: 1, error: null };
  mock.mlFails = false;
  mock.ops = [];
  mock.ledgerAtJobInsert = [];
  mlTrigger.mockClear();
  notifyRequested.mockClear();
  securityEvent.mockClear();
  afterMock.mockReset();
  afterMock.mockImplementation((fn: () => unknown) => void fn());
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("POST /api/reveal/start — the super admin", () => {
  it("files the job queued, approved by the requester, and starts the ML job", async () => {
    const res = await start();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ job_id: expect.any(String), status: "queued", self_approved: true });

    expect(mock.rpcCalls).toEqual([["super_admin_self_reveal_allowed", { p_user_id: SUPER.id }]]);
    const [job] = jobInserts();
    expect(jobInserts()).toHaveLength(1);
    expect(job).toEqual(expect.objectContaining({
      id: body.job_id,
      status: "queued",
      approval_required: false,
      approved_by: SUPER.id,
      approved_email: SUPER.email,
      approved_at: expect.any(String),
      requested_by: SUPER.id,
      reason: "Investigate the reported entry incident",
      reveal_level: 0,
    }));
    expect(Number.isNaN(Date.parse(job!.approved_at as string))).toBe(false);
    expect(mlTrigger).toHaveBeenCalledWith(body.job_id);
  });

  it("commits the ledger rows before the job row exists, so the durable worker can never claim it unrecorded", async () => {
    const { job_id } = await (await start()).json();
    // The worker polls queued rows on its own; at the instant the row is
    // committed its claim (which requires the ledger row) must already pass.
    expect(mock.ledgerAtJobInsert).toEqual([{ id: job_id, ledger: true }]);
    expect(mock.ops.slice(0, 2)).toEqual(["audit_log:insert", "reveal_jobs:insert"]);
  });

  it("writes REVEAL_REQUEST and a distinct self-approval row in one insert, without the reason text", async () => {
    const res = await start();
    const { job_id } = await res.json();
    const auditInserts = mock.inserts.filter((i) => i.table === "audit_log");
    expect(auditInserts).toHaveLength(1);
    expect(Array.isArray(auditInserts[0]!.data)).toBe(true);
    const rows = auditRows();
    expect(rows.map((r) => r.action)).toEqual(["REVEAL_REQUEST", SELF_APPROVED_AUDIT_ACTION]);
    expect(SELF_APPROVED_AUDIT_ACTION).toBe("REVEAL_SUPER_ADMIN_SELF_APPROVED");
    const self = rows[1]!;
    expect(self.detail).toBe(`job ${job_id} · recording=${RECORDING} · method=suspect · reason_len=39`);
    expect(self.detail).toBe(selfApprovalAuditDetail({ jobId: job_id, recordingId: RECORDING, method: "suspect", reasonLength: 39 }));
    expect(self).toEqual(expect.objectContaining({ user_id: SUPER.id, user_email: SUPER.email }));
    for (const row of rows) expect(String(row.detail)).not.toContain("entry incident");
    expect(String(rows[0]!.detail)).not.toContain("awaiting 4-eyes");
  });

  it("tells the other admins in real time and never sends the 'awaiting approval' request", async () => {
    await start();
    expect(securityEvent).toHaveBeenCalledTimes(1);
    expect(securityEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: SELF_APPROVED_AUDIT_ACTION,
      actorId: SUPER.id,
      actorEmail: SUPER.email,
      detail: expect.stringContaining("method=suspect"),
    }));
    expect(notifyRequested).not.toHaveBeenCalled();
  });

  it("needs the TOTP factor: a password step-up is refused before anything is written", async () => {
    mock.freshTotp = false;
    const res = await start();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "REAUTH_REQUIRED", code: REVEAL_TOTP_REQUIRED_CODE }));
    expect(mock.inserts).toEqual([]);
    expect(mlTrigger).not.toHaveBeenCalled();
    expect(securityEvent).not.toHaveBeenCalled();
  });

  it("still needs a fresh step-up at all", async () => {
    mock.freshAny = false;
    const res = await start();
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("REAUTH_REQUIRED");
    expect(mock.rpcCalls).toEqual([]);
    expect(mock.inserts).toEqual([]);
  });

  it("an ML trigger failure keeps the approval and leaves the row for the durable worker", async () => {
    mock.mlFails = true;
    const res = await start();
    expect(res.status).toBe(200);
    const { job_id, status } = await res.json();
    expect(status).toBe("queued");
    const upd = mock.updates.find((u) => u.table === "reveal_jobs");
    expect(upd?.patch).toEqual({ error_message: "Awaiting worker: ML service unreachable" });
    expect(upd?.filters).toEqual([["id", job_id], ["status", "queued"]]);
    expect(auditRows().map((r) => r.action)).toEqual(["REVEAL_REQUEST", SELF_APPROVED_AUDIT_ACTION, "REVEAL_APPROVE_DEFERRED"]);
  });

  it("an unwritable audit log creates no job at all — nothing exists that the worker could run", async () => {
    mock.auditError = { message: "offline" };
    const res = await start();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("AUDIT_UNAVAILABLE");
    expect(jobInserts()).toEqual([]);
    expect(mock.updates).toEqual([]);
    expect(mlTrigger).not.toHaveBeenCalled();
    expect(securityEvent).not.toHaveBeenCalled();
    expect(notifyRequested).not.toHaveBeenCalled();
  });

  it("falls back to the 4-eyes flow when the database refuses the self-approved row, and corrects the ledger", async () => {
    mock.jobInsertErrors = ["42501"];
    const res = await start();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job_id: expect.any(String), status: "pending_approval" });
    const [first, second] = jobInserts();
    expect(first).toEqual(expect.objectContaining({ approval_required: false, status: "queued" }));
    expect(second).toEqual(expect.objectContaining({ status: "pending_approval" }));
    expect(second).not.toHaveProperty("approval_required");
    expect(second).not.toHaveProperty("approved_by");
    expect(second!.id).toBe(first!.id);
    expect(mlTrigger).not.toHaveBeenCalled();
    expect(securityEvent).not.toHaveBeenCalled();
    expect(notifyRequested).toHaveBeenCalledTimes(1);
    // One request, one REVEAL_REQUEST; the abort row says what happened.
    expect(auditRows().map((r) => r.action)).toEqual([
      "REVEAL_REQUEST",
      SELF_APPROVED_AUDIT_ACTION,
      SELF_APPROVAL_ABORTED_AUDIT_ACTION,
    ]);
    expect(SELF_APPROVAL_ABORTED_AUDIT_ACTION).toBe("REVEAL_SELF_APPROVAL_ABORTED");
    expect(auditRows()[2]!.detail).toBe(
      `job ${first!.id} · refused by the database (kill switch off, or not the super admin) · filed for 4-eyes approval instead`,
    );
  });

  it("a refused self-approval whose 4-eyes insert also fails says so in the ledger", async () => {
    mock.jobInsertErrors = ["42501", "08006"];
    const res = await start();
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("START_FAILED");
    expect(auditRows().map((r) => r.action)).toEqual(["REVEAL_REQUEST", SELF_APPROVED_AUDIT_ACTION, SELF_APPROVAL_ABORTED_AUDIT_ACTION]);
    expect(String(auditRows()[2]!.detail)).toContain("the 4-eyes request could not be created either");
    expect(notifyRequested).not.toHaveBeenCalled();
    expect(securityEvent).not.toHaveBeenCalled();
  });

  it("a database error (SQLSTATE) is a plain failure: no row exists, nothing to cancel or announce", async () => {
    mock.jobInsertErrors = ["23514"];
    const res = await start();
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("START_FAILED");
    expect(jobInserts()).toHaveLength(1);
    expect(mock.updates).toEqual([]);
    expect(mlTrigger).not.toHaveBeenCalled();
    expect(securityEvent).not.toHaveBeenCalled();
    expect(notifyRequested).not.toHaveBeenCalled();
    const abort = auditRows().at(-1)!;
    expect(abort).toEqual(expect.objectContaining({ action: SELF_APPROVAL_ABORTED_AUDIT_ACTION, user_id: SUPER.id }));
    expect(abort.detail).toBe(`job ${jobInserts()[0]!.id} · not created (23514) · nothing ran`);
  });

  describe("an insert whose outcome is unknown (no SQLSTATE: the row may have been committed)", () => {
    const cancelUpdate = () => mock.updates.find((u) => u.table === "reveal_jobs");

    it("cancels the row while it is still queued, and checks that the cancel hit it", async () => {
      mock.jobInsertErrors = [""];
      mock.cancel = { rows: 1, error: null };
      const res = await start();
      expect(res.status).toBe(500);
      expect((await res.json()).code).toBe("START_FAILED");
      const jobId = jobInserts()[0]!.id;
      expect(cancelUpdate()?.patch).toEqual(expect.objectContaining({ status: "failed", completed_at: expect.any(String) }));
      expect(cancelUpdate()?.filters).toEqual([["id", jobId], ["status", "queued"]]);
      expect(auditRows().at(-1)!.detail).toBe(`job ${jobId} · creation unconfirmed · cancelled while still queued · nothing ran`);
      // A cancelled queued row never decrypted anything: no announcement needed.
      expect(securityEvent).not.toHaveBeenCalled();
      expect(mlTrigger).not.toHaveBeenCalled();
    });

    it.each([
      ["no queued row was left to cancel (never created, or already claimed)", () => { mock.cancel = { rows: 0, error: null }; }, "no queued row to cancel"],
      ["the cancel itself failed", () => { mock.cancel = { rows: 0, error: { message: "offline" } }; }, "the cancel failed (offline)"],
    ])("tells the other admins and the requester when %s", async (_label, arrange, note) => {
      mock.jobInsertErrors = [""];
      arrange();
      const res = await start();
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.code).toBe(REVEAL_START_UNCONFIRMED_CODE);
      expect(body.code).toBe("START_UNCONFIRMED");
      const jobId = jobInserts()[0]!.id;
      expect(securityEvent).toHaveBeenCalledTimes(1);
      expect(securityEvent).toHaveBeenCalledWith(expect.objectContaining({
        action: SELF_APPROVED_AUDIT_ACTION,
        actorId: SUPER.id,
        detail: expect.stringMatching(new RegExp(`^job ${jobId} .*creation unconfirmed — it may run`)),
      }));
      expect(auditRows().at(-1)).toEqual(expect.objectContaining({
        action: SELF_APPROVAL_ABORTED_AUDIT_ACTION,
        detail: `job ${jobId} · creation unconfirmed · ${note} · it may run; the other admins were notified`,
      }));
      expect(mlTrigger).not.toHaveBeenCalled();
    });

    it("an unwritable correction row never changes the answer", async () => {
      mock.jobInsertErrors = [""];
      mock.cancel = { rows: 0, error: null };
      mock.auditErrors = [null, { message: "offline" }];
      const res = await start();
      expect((await res.json()).code).toBe("START_UNCONFIRMED");
      expect(securityEvent).toHaveBeenCalledTimes(1);
    });
  });
});

describe("POST /api/reveal/start — kill switch off, and every other admin", () => {
  function expectPending(body: unknown) {
    expect(body).toEqual({ job_id: expect.any(String), status: "pending_approval" });
    const [job] = jobInserts();
    expect(jobInserts()).toHaveLength(1);
    expect(job).toEqual(expect.objectContaining({ status: "pending_approval", requested_by: SUPER.id }));
    for (const key of ["approval_required", "approved_by", "approved_email", "approved_at"]) {
      expect(job).not.toHaveProperty(key);
    }
    expect(mlTrigger).not.toHaveBeenCalled();
    expect(securityEvent).not.toHaveBeenCalled();
    expect(notifyRequested).toHaveBeenCalledWith(expect.objectContaining({ requesterId: SUPER.id, method: "suspect" }));
    expect(auditRows()).toEqual([expect.objectContaining({ action: "REVEAL_REQUEST", detail: expect.stringContaining("awaiting 4-eyes approval") })]);
  }

  it("kill switch off: the super admin's request waits for a second admin", async () => {
    mock.rpc.data = false;
    const res = await start();
    expect(res.status).toBe(200);
    expectPending(await res.json());
  });

  it("kill switch off: a password step-up is enough again (a second admin approves with TOTP)", async () => {
    mock.rpc.data = false;
    mock.freshTotp = false;
    const res = await start();
    expect(res.status).toBe(200);
    expectPending(await res.json());
  });

  it.each([
    ["an RPC error (web deployed before the migration)", () => { mock.rpc.error = { code: "PGRST202", message: "missing" }; }],
    ["a thrown RPC call", () => { mock.rpc.throws = true; }],
    ["a non-boolean answer", () => { mock.rpc.data = "true"; }],
  ])("%s reads as the 4-eyes flow", async (_label, arrange) => {
    arrange();
    const res = await start();
    expect(res.status).toBe(200);
    expectPending(await res.json());
  });

  it.each([false, undefined])("a normal admin (is_super_admin=%p) is unchanged and never asks the database", async (flag) => {
    mock.isSuperAdmin = flag;
    mock.freshTotp = false; // the password step-up still files a request
    const res = await start();
    expect(res.status).toBe(200);
    expectPending(await res.json());
    expect(mock.rpcCalls).toEqual([]);
  });
});

describe("lib/reveal-self-approval", () => {
  it("only asks the database for the super admin", async () => {
    const rpc = jest.fn(async () => ({ data: true, error: null }));
    await expect(readSuperAdminSelfReveal({ rpc } as never, "u", false)).resolves.toBe(false);
    await expect(readSuperAdminSelfReveal({ rpc } as never, "u", null)).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    await expect(readSuperAdminSelfReveal({ rpc } as never, "u", true)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("super_admin_self_reveal_allowed", { p_user_id: "u" });
  });

  it("labels only approval_required = false as self-approved", () => {
    expect(isSelfApprovedReveal({ approval_required: false })).toBe(true);
    expect(isSelfApprovedReveal({ approval_required: true })).toBe(false);
    expect(isSelfApprovedReveal({ approval_required: null })).toBe(false);
    expect(isSelfApprovedReveal({})).toBe(false);
  });

  it("the TOTP refusal returns to step 2 with its own translated message", () => {
    expect(REVEAL_TOTP_REQUIRED_CODE).toBe("REAUTH_TOTP_REQUIRED");
    expect(revealStartRefusal(REVEAL_TOTP_REQUIRED_CODE)).toEqual({ step: "reauth", errorKey: "pb_reveal_err_reauth_totp" });
    expect(revealStartRefusal("AUDIT_UNAVAILABLE")).toEqual({ step: "method", errorKey: "pb_reveal_start_failed" });
    // Never "could not start" for a job that may be running.
    expect(revealStartRefusal(REVEAL_START_UNCONFIRMED_CODE)).toEqual({ step: "method", errorKey: "pb_reveal_err_unconfirmed" });
  });

  it("isDatabaseVerdict: only a Postgres SQLSTATE proves nothing was written", () => {
    for (const code of ["42501", "23514", "08006", "57014", "P0001"]) expect(isDatabaseVerdict({ code })).toBe(true);
    for (const code of ["", "PGRST116", "ECONNRESET", "4250", null, undefined]) expect(isDatabaseVerdict({ code })).toBe(false);
    expect(isDatabaseVerdict(null)).toBe(false);
  });

  it("the ledger detail starts with the prefix claim_reveal_job() looks for", () => {
    const detail = selfApprovalAuditDetail({ jobId: "j-1", recordingId: "r-1", method: "upload", reasonLength: 12 });
    expect(detail).toBe("job j-1 · recording=r-1 · method=upload · reason_len=12");
    const migration = readFileSync(
      join(__dirname, "..", "supabase", "migrations", "20260930120000_super_admin_reveal_without_approval.sql"),
      "utf8",
    );
    const claim = migration.slice(migration.indexOf("create or replace function public.claim_reveal_job"));
    expect(claim).toContain(`ledger.action = '${SELF_APPROVED_AUDIT_ACTION}'`);
    expect(claim).toContain("ledger.user_id = job.requested_by");
    expect(claim).toContain("starts_with(ledger.detail, 'job ' || job.id::text || ' ')");
  });
});

describe("reveal modal — the super admin's notice and step 2", () => {
  const realFetch = global.fetch;
  afterAll(() => {
    global.fetch = realFetch;
  });

  it("offers only the authenticator code on the self-approved path", () => {
    expect(revealStepUpFactors(true, true)).toEqual(["totp"]);
    expect(revealStepUpFactors(false, true)).toEqual(["totp"]);
    expect(defaultRevealStepUpFactor(true, true)).toBe("totp");
    // Everyone else: unchanged.
    expect(revealStepUpFactors(true)).toEqual(["totp", "password"]);
    expect(revealStepUpFactors(false)).toEqual(["password"]);
  });

  it("a fresh password step-up does not count on the self-approved path", async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ valid: true, factor: "password" }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(revealStepUpIsFresh(undefined, { totpOnly: true })).resolves.toBe(false);
    await expect(revealStepUpIsFresh(undefined)).resolves.toBe(true);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ valid: true, factor: "totp" }), { status: 200 }));
    await expect(revealStepUpIsFresh(undefined, { totpOnly: true })).resolves.toBe(true);
  });

  function fields(props: Record<string, unknown>, lang: Lang = "en") {
    const el = createElement(RevealStepUpFields, {
      totpEnabled: true,
      factor: "totp",
      onFactorChange: () => {},
      code: "",
      onCodeChange: () => {},
      password: "",
      onPasswordChange: () => {},
      busy: false,
      ...props,
    });
    return renderToStaticMarkup(createElement(LangProvider, { initial: lang, children: el }));
  }

  it("step 2 has no password switch and explains why, in mn/en/kr", () => {
    for (const lang of ["mn", "en", "kr"] as const) {
      const html = fields({ totpOnly: true }, lang);
      expect(html).not.toContain("data-reveal-factors");
      expect(html).not.toContain('type="password"');
      expect(html).toContain('id="reveal-totp-code"');
      expect(html).toContain(esc(T.pb_reauth_note_totp_self[lang]));
      const fresh = fields({ totpOnly: true, confirmOnly: true }, lang);
      expect(fresh).toContain(esc(T.pb_reauth_note_fresh_self[lang]));
      expect(fresh).not.toContain(esc(T.pb_reauth_note_fresh[lang]));
    }
    // Without the flag the notes are the 4-eyes ones.
    expect(fields({ confirmOnly: true })).toContain(esc(T.pb_reauth_note_fresh.en));
  });

  function modal(selfReveal: boolean, lang: Lang) {
    const el = createElement(RevealModal, {
      recordingId: RECORDING,
      suspects: [],
      detectedFaces: [],
      totpEnabled: true,
      selfReveal,
      onClose: () => {},
    });
    return renderToStaticMarkup(createElement(LangProvider, { initial: lang, children: el }));
  }

  it("step 1 tells the super admin the request runs now and the other admins are notified", () => {
    for (const lang of ["mn", "en", "kr"] as const) {
      const html = modal(true, lang);
      expect(html).toContain("data-self-reveal-notice");
      expect(html).toContain(esc(T.pb_reveal_self_notice[lang]));
      expect(modal(false, lang)).not.toContain("data-self-reveal-notice");
    }
    expect(T.pb_reveal_self_notice.en).toMatch(/without a second admin's approval/);
    expect(T.pb_reveal_self_notice.en).toMatch(/other admins are notified/);
  });

  it("every new string exists in mn/en/kr, and Korean/Mongolian use native terms", () => {
    const keys: TranslationKey[] = [
      "pb_reveal_self_notice",
      "pb_reauth_note_totp_self",
      "pb_reauth_note_fresh_self",
      "pb_reveal_err_reauth_totp",
      "pb_reveal_err_unconfirmed",
      "pb_reveal_self_running",
      "reveal_self_approved_label",
      "reveal_self_approved_hint",
    ];
    for (const key of keys) {
      for (const lang of ["mn", "en", "kr"] as const) expect(T[key][lang].length).toBeGreaterThan(5);
      expect(T[key].kr).not.toMatch(/reveal|super admin/i);
      expect(T[key].mn).not.toMatch(/reveal|super admin/i);
    }
  });
});

describe("wiring", () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");
  const dir = ["app", "(app)", "playback", "[id]"];

  it("the server page decides the flag from the database and passes it down", () => {
    const page = read(...dir, "page.tsx");
    expect(page).toContain("readSuperAdminSelfReveal(createServiceClient(), user.id, profile.is_super_admin)");
    expect(page).toContain("selfReveal={selfReveal}");
    expect(read(...dir, "playback-player.tsx")).toContain("selfReveal={selfReveal}");
    const m = read(...dir, "reveal-modal.tsx");
    expect(m).toContain("defaultRevealStepUpFactor(totpEnabled, selfReveal)");
    expect(m).toContain("revealStepUpIsFresh(precheck.signal, { totpOnly: selfReveal })");
    expect(m).toContain("totpOnly={selfReveal}");
    // Step 3 follows the route's answer, not the flag.
    expect(m).toContain('status: data.status ?? "pending_approval"');
  });

  it("the lists label a self-approved job instead of showing it as a 4-eyes approval", () => {
    for (const file of [
      ["app", "(app)", "reveal-approvals", "page.tsx"],
      ["app", "(app)", "jobs", "page.tsx"],
      [...dir, "page.tsx"],
    ]) {
      const src = read(...file);
      expect(src).toContain("approval_required");
      expect(src).toContain("isSelfApprovedReveal(");
      expect(src).toContain('t("reveal_self_approved_label")');
    }
  });
});
