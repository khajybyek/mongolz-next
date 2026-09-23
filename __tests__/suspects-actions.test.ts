/**
 * /suspects server actions (2026-09-23): the watchlist is written with the
 * service role after requireAdmin() + step-up (migration 20260923150000
 * revokes suspect DML from `authenticated`), the row is deleted BEFORE its
 * photo, and the audit row carries ids + the affected alert count, never the
 * person's name. The migration itself is checked statically at the end.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ADMIN = { id: "11111111-1111-4111-8111-111111111111", email: "admin@example.test" };
const SUSPECT = "66666666-6666-4666-8666-666666666666";

type Step = { client: "user" | "service"; table: string; op: string; arg?: unknown };
const mockLog: Step[] = [];
const mockState = {
  reauth: null as null | { error: string },
  row: { image_path: "abc.jpg" } as { image_path: string } | null,
  deleteError: null as { message: string; code: string } | null,
  deletedRows: [{ id: SUSPECT }] as Array<{ id: string }>,
  alertCount: 3 as number | null,
  audits: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
};

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "mongolz-lang" ? { value: "en" } : undefined) }),
}));
jest.mock("@/lib/supabase/auth", () => ({
  requireAdmin: jest.fn(async () => ({ user: ADMIN, profile: { role: "admin", totp_enabled: true } })),
}));
jest.mock("@/lib/auth/step-up", () => ({ ensureFreshReauth: jest.fn(async () => mockState.reauth) }));
jest.mock("@/lib/ml-client", () => ({ mlEmbed: jest.fn(async () => Array(512).fill(0.01)) }));
jest.mock("@/lib/notify", () => ({
  scheduleSecurityEvent: (e: Record<string, unknown>) => void mockState.events.push(e),
}));

function mockClient(client: "user" | "service") {
  return {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          mockLog.push({ client, table: `storage:${bucket}`, op: "upload", arg: path });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          mockLog.push({ client, table: `storage:${bucket}`, op: "remove", arg: paths });
          return { error: null };
        },
      }),
    },
    from: (table: string) => ({
      select: (_cols: string, opts?: { head?: boolean }) => ({
        eq: () => {
          mockLog.push({ client, table, op: opts?.head ? "count" : "select" });
          return opts?.head
            ? Promise.resolve({ count: mockState.alertCount, error: null })
            : { maybeSingle: async () => ({ data: mockState.row, error: null }) };
        },
      }),
      insert: (row: Record<string, unknown>) => {
        mockLog.push({ client, table, op: "insert" });
        if (table === "audit_log") {
          mockState.audits.push(row);
          return Promise.resolve({ error: null });
        }
        return { select: () => ({ single: async () => ({ data: { id: SUSPECT }, error: null }) }) };
      },
      delete: () => ({
        eq: () => ({
          select: async () => {
            mockLog.push({ client, table, op: "delete" });
            return { data: mockState.deleteError ? null : mockState.deletedRows, error: mockState.deleteError };
          },
        }),
      }),
    }),
  };
}
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockClient("user"),
  createServiceClient: () => mockClient("service"),
}));

import { addSuspectAction, deleteSuspectAction } from "@/app/(app)/suspects/actions";

beforeEach(() => {
  mockLog.length = 0;
  mockState.reauth = null;
  mockState.row = { image_path: "abc.jpg" };
  mockState.deleteError = null;
  mockState.deletedRows = [{ id: SUSPECT }];
  mockState.alertCount = 3;
  mockState.audits = [];
  mockState.events = [];
});

describe("deleteSuspectAction", () => {
  it("asks for step-up before touching anything", async () => {
    mockState.reauth = { error: "REAUTH_REQUIRED" };
    expect(await deleteSuspectAction(SUSPECT)).toEqual({ error: "REAUTH_REQUIRED" });
    expect(mockLog).toEqual([]);
  });

  it("refuses a malformed id without a database call", async () => {
    expect(await deleteSuspectAction("1 or 1=1")).toEqual({ error: "Could not delete the suspect. Try again." });
    expect(mockLog).toEqual([]);
  });

  it("deletes the row with the service role BEFORE removing the photo", async () => {
    expect(await deleteSuspectAction(SUSPECT)).toEqual({ ok: true });
    const writes = mockLog.filter((s) => s.op === "delete" || s.op === "remove");
    expect(writes).toEqual([
      { client: "service", table: "suspects", op: "delete" },
      { client: "service", table: "storage:suspects", op: "remove", arg: ["abc.jpg"] },
    ]);
    expect(mockLog.some((s) => s.client === "user")).toBe(false);
  });

  it("keeps the photo when the row delete fails", async () => {
    mockState.deleteError = { message: "permission denied", code: "42501" };
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await deleteSuspectAction(SUSPECT)).toEqual({ error: "Could not delete the suspect. Try again." });
    expect(mockLog.some((s) => s.op === "remove")).toBe(false);
    expect(mockState.audits).toEqual([]);
    jest.mocked(console.error).mockRestore();
  });

  it("audits ids + the affected alert count (no name) and notifies the other admins", async () => {
    await deleteSuspectAction(SUSPECT);
    expect(mockState.audits).toEqual([
      expect.objectContaining({ action: "SUSPECT_DELETE", detail: `suspect_id=${SUSPECT} alerts=3`, user_id: ADMIN.id }),
    ]);
    expect(mockState.events).toEqual([
      expect.objectContaining({ action: "SUSPECT_DELETE", actorId: ADMIN.id, detail: `suspect_id=${SUSPECT} alerts=3` }),
    ]);
  });

  it("treats an already-deleted suspect as done without auditing", async () => {
    mockState.row = null;
    expect(await deleteSuspectAction(SUSPECT)).toEqual({ ok: true });
    expect(mockLog.some((s) => s.op === "delete" || s.op === "remove")).toBe(false);
    expect(mockState.audits).toEqual([]);
  });
});

describe("addSuspectAction", () => {
  it("inserts the row with the service role and audits the id, not the name", async () => {
    const fd = new FormData();
    fd.set("name", "Test Person");
    fd.set("privacy_tier", "standard");
    fd.set("photo", new File([new Uint8Array([1, 2, 3])], "p.jpg", { type: "image/jpeg" }));
    expect(await addSuspectAction(fd)).toEqual({ ok: true });
    expect(mockLog.find((s) => s.table === "suspects" && s.op === "insert")?.client).toBe("service");
    expect(mockState.audits[0]).toMatchObject({ action: "SUSPECT_ADD", detail: `suspect_id=${SUSPECT} tier=standard` });
    expect(JSON.stringify(mockState.audits)).not.toContain("Test Person");
  });
});

describe("migration 20260923150000_suspect_delete_keeps_alerts", () => {
  const sql = readFileSync(
    join(__dirname, "..", "supabase", "migrations", "20260923150000_suspect_delete_keeps_alerts.sql"),
    "utf8",
  ).replace(/--.*$/gm, "");

  it("re-creates alerts.suspect_id as ON DELETE SET NULL (no more cascade)", () => {
    expect(sql).toMatch(/drop constraint if exists alerts_suspect_id_fkey/i);
    expect(sql).toMatch(/foreign key \(suspect_id\) references public\.suspects\(id\) on delete set null/i);
    expect(sql).not.toMatch(/on delete cascade/i);
  });

  it("drops the CHECK that would make SET NULL fail", () => {
    expect(sql).toMatch(/drop constraint if exists alerts_type_suspect_check/i);
    expect(sql).not.toMatch(/add constraint alerts_type_suspect_check/i);
  });

  it("revokes suspect DML from browser roles", () => {
    expect(sql).toMatch(/revoke insert, update, delete, truncate, references, trigger\s+on public\.suspects from anon, authenticated/i);
  });
});
