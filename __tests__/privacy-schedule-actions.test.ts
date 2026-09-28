/**
 * /cameras/[id]/schedule server actions (ADR 0012). Privacy schedules are
 * enforced by the ML service, so:
 *  - LOOSENING (add standard, delete private, default private → standard)
 *    needs a fresh TOTP step-up — refused with REAUTH_REQUIRED and nothing
 *    written — and notifies the other admins once applied;
 *  - TIGHTENING writes and audits in one click;
 *  - delete / default decide the direction from the DATABASE, never from
 *    what the form claims.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildReauthCookieValue } from "@/lib/auth/step-up";
import { T } from "@/lib/i18n/translations";

const ADMIN = "11111111-2222-4333-8444-555555555555";
const CAMERA = "b0000000-0000-4000-8000-000000000001";
const PRIVATE_ROW = "c0000000-0000-4000-8000-000000000001";
const STANDARD_ROW = "c0000000-0000-4000-8000-000000000002";

type ScheduleRow = {
  id: string;
  camera_id: string;
  window_mode: string;
  starts_at: string;
  ends_at: string;
  weekdays: number;
};
type Op = { table: string; op: string; values?: unknown; filters: Record<string, unknown> };

const state = {
  reauthCookie: undefined as string | undefined,
  schedules: [] as ScheduleRow[],
  camera: { id: CAMERA, privacy_default: "standard" as string } as { id: string; privacy_default: string } | null,
};
const ops: Op[] = [];
let cameraUpdates = 0;
let failCameraUpdateAt = 0;
const events: Array<{ action: string; detail?: string | null }> = [];

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
  cookies: async () => ({
    get: (name: string) => {
      if (name === "mongolz-reauth" && state.reauthCookie) return { value: state.reauthCookie };
      if (name === "mongolz-lang") return { value: "en" };
      return undefined;
    },
  }),
}));
jest.mock("@/lib/notify", () => ({
  scheduleSecurityEvent: (e: { action: string; detail?: string | null }) => {
    events.push(e);
  },
}));
jest.mock("@/lib/supabase/auth", () => ({
  requireAdmin: jest.fn(async () => ({
    user: { id: ADMIN, email: "admin@test" },
    profile: { id: ADMIN, role: "admin", totp_enabled: true, is_super_admin: false },
  })),
}));

function builder(table: string, op: string, values?: unknown) {
  const filters: Record<string, unknown> = {};
  const record = () => ops.push({ table, op, values, filters: { ...filters } });
  const matches = (row: Record<string, unknown>) => Object.entries(filters).every(([k, v]) => row[k] === v);
  const result = (single: boolean) => {
    record();
    if (table === "masking_schedules" && op === "select") {
      if (!single) return { data: state.schedules.filter((r) => matches(r)).map((r) => ({ ...r })), error: null };
      return { data: state.schedules.find((r) => matches(r)) ?? null, error: null };
    }
    if (table === "masking_schedules" && op === "delete") {
      const hit = state.schedules.filter((r) => matches(r));
      state.schedules = state.schedules.filter((r) => !matches(r));
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    if (table === "cameras" && op === "select") {
      return { data: state.camera && matches(state.camera) ? { ...state.camera } : null, error: null };
    }
    if (table === "cameras" && op === "update") {
      cameraUpdates += 1;
      if (cameraUpdates === failCameraUpdateAt) return { data: null, error: { message: "database offline" } };
      if (!state.camera || !matches(state.camera)) return { data: [], error: null };
      Object.assign(state.camera, values as object);
      return { data: [{ id: state.camera.id }], error: null };
    }
    return { data: null, error: null };
  };
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.order = () => q;
  q.eq = (col: string, v: unknown) => {
    filters[col] = v;
    return q;
  };
  q.maybeSingle = async () => result(true);
  q.single = async () => result(true);
  q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
    Promise.resolve(result(false)).then(ok, bad);
  return q;
}

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => builder(table, "select"),
      insert: (v: unknown) => builder(table, "insert", v),
      update: (v: unknown) => builder(table, "update", v),
      delete: () => builder(table, "delete"),
    }),
  }),
}));

import {
  addScheduleAction,
  deleteScheduleAction,
  setPrivacyDefaultAction,
} from "@/app/(app)/cameras/[id]/schedule/actions";

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const soon = () => new Date(Date.now() + 15 * 60_000);
const writes = (table: string) => ops.filter((o) => o.table === table && o.op !== "select");
const audits = (action?: string) =>
  ops.filter(
    (o) => o.table === "audit_log" && o.op === "insert" && (!action || (o.values as { action: string }).action === action),
  );
const windowForm = (mode: string) =>
  fd({ camera_id: CAMERA, window_mode: mode, starts_at: "09:00", ends_at: "18:00", weekdays: "62" });

beforeAll(() => {
  process.env.REAUTH_COOKIE_SECRET = "privacy-schedule-actions-test-secret";
});
beforeEach(() => {
  ops.length = 0;
  cameraUpdates = 0;
  failCameraUpdateAt = 0;
  events.length = 0;
  state.reauthCookie = undefined;
  state.camera = { id: CAMERA, privacy_default: "standard" };
  state.schedules = [
    { id: PRIVATE_ROW, camera_id: CAMERA, window_mode: "private", starts_at: "09:00:00", ends_at: "18:00:00", weekdays: 127 },
    { id: STANDARD_ROW, camera_id: CAMERA, window_mode: "standard", starts_at: "22:00:00", ends_at: "06:00:00", weekdays: 32 },
  ];
});

describe("adding a window", () => {
  it("a private window (tightening) is written and audited without a step-up, no notification", async () => {
    expect(await addScheduleAction(windowForm("private"))).toEqual({ ok: true });
    const [insert] = writes("masking_schedules");
    expect(insert).toMatchObject({ op: "insert", values: { window_mode: "private", starts_at: "09:00", ends_at: "18:00", created_by: ADMIN } });
    const [row] = audits("PRIVACY_SCHEDULE_ADD");
    expect(String((row!.values as { detail: string }).detail)).toMatch(/private 09:00-18:00 weekdays=62.*\[tighten\]/);
    expect(events).toEqual([]);
  });

  it("a standard window (loosening) without a step-up → REAUTH_REQUIRED, nothing written, refusal audited", async () => {
    expect(await addScheduleAction(windowForm("standard"))).toEqual({ error: "REAUTH_REQUIRED" });
    expect(writes("masking_schedules")).toEqual([]);
    expect(audits("PRIVACY_SCHEDULE_ADD")).toEqual([]);
    expect(audits("PRIVACY_SCHEDULE_STEP_UP_REQUIRED")).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it("a password-minted step-up does not count — loosening needs the second factor", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "password");
    expect(await addScheduleAction(windowForm("standard"))).toEqual({ error: "REAUTH_REQUIRED" });
    expect(writes("masking_schedules")).toEqual([]);
  });

  it("with a TOTP step-up the standard window is written, audited and pushed to the other admins", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(await addScheduleAction(windowForm("standard"))).toEqual({ ok: true });
    expect(writes("masking_schedules")).toHaveLength(1);
    expect(audits("PRIVACY_SCHEDULE_ADD")).toHaveLength(1);
    expect(events.map((e) => e.action)).toEqual(["PRIVACY_SCHEDULE_ADD"]);
    expect(events[0]!.detail).toMatch(/standard 09:00-18:00.*\[loosen\]/);
  });

  it("rejects the retired modes", async () => {
    for (const mode of ["masked", "revealed"]) {
      expect(await addScheduleAction(windowForm(mode))).toHaveProperty("error");
    }
    expect(writes("masking_schedules")).toEqual([]);
  });

  it("validates before asking for a step-up, with a translated message", async () => {
    const res = await addScheduleAction(
      fd({ camera_id: CAMERA, window_mode: "standard", starts_at: "24:00", ends_at: "06:00", weekdays: "127" }),
    );
    expect(res).toEqual({ error: T.schedule_err_start_24.en });
    expect(audits()).toEqual([]);
  });
});

describe("deleting a window", () => {
  it("classifies from the DB row: deleting a private window is loosening even if the form says standard", async () => {
    const res = await deleteScheduleAction(fd({ id: PRIVATE_ROW, camera_id: CAMERA, window_mode: "standard" }));
    expect(res).toEqual({ error: "REAUTH_REQUIRED" });
    expect(writes("masking_schedules")).toEqual([]);
    expect(state.schedules.map((r) => r.id)).toContain(PRIVATE_ROW);
  });

  it("deleting a standard window is tightening even if the form says private", async () => {
    const res = await deleteScheduleAction(fd({ id: STANDARD_ROW, camera_id: CAMERA, window_mode: "private" }));
    expect(res).toEqual({ ok: true });
    expect(state.schedules.map((r) => r.id)).toEqual([PRIVATE_ROW]);
    // The delete is conditional on the classified mode.
    expect(writes("masking_schedules")[0]!.filters).toEqual({ id: STANDARD_ROW, window_mode: "standard" });
    const [row] = audits("PRIVACY_SCHEDULE_DELETE");
    expect(String((row!.values as { detail: string }).detail)).toMatch(/standard 22:00-06:00 weekdays=32.*\[tighten\]/);
    expect(events).toEqual([]);
  });

  it("with a TOTP step-up the private window is removed and the other admins are told", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(await deleteScheduleAction(fd({ id: PRIVATE_ROW }))).toEqual({ ok: true });
    expect(state.schedules.map((r) => r.id)).toEqual([STANDARD_ROW]);
    expect(events.map((e) => e.action)).toEqual(["PRIVACY_SCHEDULE_DELETE"]);
  });

  it("an unrecognised stored mode is treated as private (step-up required)", async () => {
    state.schedules[1]!.window_mode = "revealed";
    expect(await deleteScheduleAction(fd({ id: STANDARD_ROW }))).toEqual({ error: "REAUTH_REQUIRED" });
  });

  it("an unknown id writes nothing", async () => {
    const res = await deleteScheduleAction(fd({ id: "c0000000-0000-4000-8000-00000000dead" }));
    expect(res).toEqual({ error: T.schedule_err_not_found.en });
    expect(writes("masking_schedules")).toEqual([]);
    expect(audits()).toEqual([]);
  });
});

describe("changing the default", () => {
  it("standard → private is tightening: one click, compare-and-set on the stored value", async () => {
    expect(await setPrivacyDefaultAction(fd({ camera_id: CAMERA, privacy_default: "private" }))).toEqual({ ok: true });
    expect(state.camera!.privacy_default).toBe("private");
    expect(writes("cameras")[0]!.filters).toEqual({ id: CAMERA, privacy_default: "standard" });
    const [row] = audits("PRIVACY_DEFAULT_CHANGE");
    expect(String((row!.values as { detail: string }).detail)).toMatch(/default: standard → private \[tighten\]/);
    expect(events).toEqual([]);
  });

  it("private → standard is loosening: refused without a TOTP step-up", async () => {
    state.camera!.privacy_default = "private";
    expect(await setPrivacyDefaultAction(fd({ camera_id: CAMERA, privacy_default: "standard" }))).toEqual({
      error: "REAUTH_REQUIRED",
    });
    expect(writes("cameras")).toEqual([]);
    expect(state.camera!.privacy_default).toBe("private");

    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(await setPrivacyDefaultAction(fd({ camera_id: CAMERA, privacy_default: "standard" }))).toEqual({ ok: true });
    expect(state.camera!.privacy_default).toBe("standard");
    expect(events.map((e) => e.action)).toEqual(["PRIVACY_DEFAULT_CHANGE"]);
  });

  it("the same value is a no-op: nothing written or audited", async () => {
    expect(await setPrivacyDefaultAction(fd({ camera_id: CAMERA, privacy_default: "standard" }))).toEqual({ ok: true });
    expect(writes("cameras")).toEqual([]);
    expect(audits()).toEqual([]);
  });

  it("rejects the retired values and an unknown camera", async () => {
    expect(await setPrivacyDefaultAction(fd({ camera_id: CAMERA, privacy_default: "revealed" }))).toHaveProperty("error");
    state.camera = null;
    expect(await setPrivacyDefaultAction(fd({ camera_id: CAMERA, privacy_default: "private" }))).toEqual({
      error: T.schedule_err_camera_not_found.en,
    });
    expect(writes("cameras")).toEqual([]);
  });
});

describe("recording WHEN a schedule was loosened (cameras.privacy_loosened_at)", () => {
  const loosenedWrites = () =>
    writes("cameras").filter((o) => (o.values as Record<string, unknown>)?.privacy_loosened_at !== undefined);
  const stampAt = (o: Op) => Date.parse(String((o.values as { privacy_loosened_at: string }).privacy_loosened_at));
  const writeOrder = () => ops.filter((o) => o.op !== "select" && o.table !== "audit_log").map((o) => `${o.table}:${o.op}`);

  it("adding a standard window that takes private time away stamps BEFORE and AFTER the write", async () => {
    // Default private, no windows: the new standard window makes
    // 09:00–18:00 Mon–Fri standard.
    state.camera!.privacy_default = "private";
    state.schedules = [];
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(await addScheduleAction(windowForm("standard"))).toEqual({ ok: true });
    expect(writeOrder()).toEqual(["cameras:update", "masking_schedules:insert", "cameras:update"]);
    const [before, after] = loosenedWrites();
    expect(before!.filters).toEqual({ id: CAMERA });
    expect(after!.filters).toEqual({ id: CAMERA });
    // A frame captured between the first stamp and the write was still
    // covered by the old schedule: the stamp must not end before the write.
    expect(stampAt(after!)).toBeGreaterThanOrEqual(stampAt(before!));
    expect(stampAt(before!)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("a loosening-by-kind change that takes no private time away writes no stamp (still needs the step-up)", async () => {
    // Default standard: a standard window cannot change any instant.
    expect(await addScheduleAction(windowForm("standard"))).toEqual({ error: "REAUTH_REQUIRED" });
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(await addScheduleAction(windowForm("standard"))).toEqual({ ok: true });
    expect(writes("masking_schedules")).toHaveLength(1);
    expect(loosenedWrites()).toEqual([]);
    expect(events.map((e) => e.action)).toEqual(["PRIVACY_SCHEDULE_ADD"]);

    // Default private, and nothing else makes 09:00–18:00 standard: deleting
    // the private window over it leaves that time private.
    ops.length = 0;
    state.camera!.privacy_default = "private";
    expect(await deleteScheduleAction(fd({ id: PRIVATE_ROW }))).toEqual({ ok: true });
    expect(state.schedules.map((r) => r.id)).not.toContain(PRIVATE_ROW);
    expect(loosenedWrites()).toEqual([]);
  });

  it("deleting a private window that takes private time away stamps the window's camera before and after", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(await deleteScheduleAction(fd({ id: PRIVATE_ROW }))).toEqual({ ok: true });
    expect(writeOrder()).toEqual(["cameras:update", "masking_schedules:delete", "cameras:update"]);
    expect(loosenedWrites().map((o) => o.filters)).toEqual([{ id: CAMERA }, { id: CAMERA }]);
  });

  it("default private → standard stamps it in the same compare-and-set write, and again after it", async () => {
    state.camera!.privacy_default = "private";
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(await setPrivacyDefaultAction(fd({ camera_id: CAMERA, privacy_default: "standard" }))).toEqual({ ok: true });
    const [cas, restamp] = writes("cameras");
    expect(cas!.values).toMatchObject({ privacy_default: "standard" });
    expect(cas!.filters).toEqual({ id: CAMERA, privacy_default: "private" });
    expect(Object.keys(restamp!.values as object)).toEqual(["privacy_loosened_at"]);
    expect(loosenedWrites()).toHaveLength(2);
    expect(stampAt(restamp!)).toBeGreaterThanOrEqual(stampAt(cas!));
  });

  it("a failed second stamp does not undo the change; the audit line says so", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    failCameraUpdateAt = 2; // the first stamp works, the one after the delete fails
    expect(await deleteScheduleAction(fd({ id: PRIVATE_ROW }))).toEqual({ ok: true });
    const [row] = audits("PRIVACY_SCHEDULE_DELETE");
    expect(String((row!.values as { detail: string }).detail)).toMatch(/re-stamp after the write failed.*\[loosen\]/);
  });

  it("tightening and refused loosening never touch it", async () => {
    await addScheduleAction(windowForm("private"));
    await setPrivacyDefaultAction(fd({ camera_id: CAMERA, privacy_default: "private" }));
    state.camera!.privacy_default = "standard";
    await addScheduleAction(windowForm("standard")); // no step-up → refused
    expect(loosenedWrites()).toEqual([]);
  });
});

describe("schedule page wiring", () => {
  const src = readFileSync(join(__dirname, "..", "app", "(app)", "cameras", "[id]", "schedule", "page.tsx"), "utf8");

  it("routes every form that can loosen through StepUpForm (TOTP prompt + resubmit)", () => {
    expect(src).toContain("<StepUpForm action={addScheduleAction}");
    expect(src).toContain("<StepUpForm action={deleteScheduleAction}");
    expect(src).toContain("<StepUpForm action={setPrivacyDefaultAction}");
    expect(src).not.toMatch(/<form action=/);
  });

  it("drops the preview banner, defaults new windows to private and reads the enforced evaluator", () => {
    expect(src).not.toContain("schedule_preview_note");
    expect(src).toContain('name="window_mode" defaultValue="private"');
    expect(src).toContain('rpc("effective_privacy_mode"');
    // The delete form carries only the row id — nothing the action could trust.
    expect(src).not.toMatch(/name="window_mode" value=/);
  });
});
