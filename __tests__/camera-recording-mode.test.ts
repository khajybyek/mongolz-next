/**
 * Per-camera recording mode (ADR 0013) — app/(app)/cameras/actions.ts.
 *
 *  - standard → face_encrypted stores LESS (no raw original) = tightening:
 *    one click, audited, nobody else paged;
 *  - face_encrypted → standard stores raw originals again = loosening: a
 *    fresh TOTP step-up (a password step-up is not enough), audited, and the
 *    other admins are notified;
 *  - the direction comes from the stored row, never from the form, and the
 *    write is a compare-and-set on that stored value;
 *  - every write goes through the service role.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildReauthCookieValue } from "@/lib/auth/step-up";
import { T } from "@/lib/i18n/translations";

const ADMIN = "11111111-2222-4333-8444-555555555555";
const CAMERA = "b0000000-0000-4000-8000-000000000001";

type Op = { table: string; op: string; values?: unknown; filters: Record<string, unknown> };

const state = {
  reauthCookie: undefined as string | undefined,
  camera: null as Record<string, unknown> | null,
  failRead: false,
  /** Applied to the stored row right after it is read — another admin's write. */
  raceAfterRead: null as Record<string, unknown> | null,
};
const ops: Op[] = [];
const events: Array<{ action: string; detail?: string | null }> = [];

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  headers: async () => new Headers(),
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
jest.mock("@/lib/camera-crypto", () => ({
  protectCameraUrlForStorage: (url: string) => `enc:${url}`,
  unwrapCameraUrlForRuntime: (url: string) => url.replace(/^enc:/, ""),
}));
jest.mock("@/lib/ml-client", () => ({ mlTestCamera: jest.fn(), mlStopCamera: jest.fn(async () => undefined) }));
jest.mock("@/lib/supabase/auth", () => ({
  requireAdmin: jest.fn(async () => ({
    user: { id: ADMIN, email: "admin@test" },
    profile: { id: ADMIN, role: "admin", totp_enabled: true, is_super_admin: false },
  })),
}));

function builder(table: string, op: string, values?: unknown) {
  const filters: Record<string, unknown> = {};
  const matches = (row: Record<string, unknown>) => Object.entries(filters).every(([k, v]) => row[k] === v);
  const result = () => {
    ops.push({ table, op, values, filters: { ...filters } });
    if (table === "cameras" && op === "select") {
      if (state.failRead) return { data: null, error: { message: "offline" } };
      const row = state.camera && matches(state.camera) ? { ...state.camera } : null;
      if (state.camera && state.raceAfterRead) Object.assign(state.camera, state.raceAfterRead);
      return { data: row, error: null };
    }
    if (table === "cameras" && op === "update") {
      if (!state.camera || !matches(state.camera)) return { data: [], error: null };
      Object.assign(state.camera, values as object);
      return { data: [{ id: state.camera.id }], error: null };
    }
    return { data: null, error: null };
  };
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (col: string, v: unknown) => {
    filters[col] = v;
    return q;
  };
  q.maybeSingle = async () => result();
  q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
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

import { addCameraAction, setRecordingModeAction, updateCameraAction } from "@/app/(app)/cameras/actions";

const soon = () => new Date(Date.now() + 15 * 60_000);
const totp = () => {
  state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
};
const modeForm = (mode: string, id = CAMERA) => {
  const f = new FormData();
  f.set("id", id);
  f.set("recording_mode", mode);
  return f;
};
const cameraWrites = () => ops.filter((o) => o.table === "cameras" && o.op !== "select");
const audits = (action?: string) =>
  ops
    .filter((o) => o.table === "audit_log" && o.op === "insert")
    .map((o) => o.values as { action: string; detail: string })
    .filter((v) => !action || v.action === action);

beforeAll(() => {
  process.env.REAUTH_COOKIE_SECRET = "camera-recording-mode-test-secret";
});
beforeEach(() => {
  ops.length = 0;
  events.length = 0;
  state.reauthCookie = undefined;
  state.failRead = false;
  state.raceAfterRead = null;
  state.camera = { id: CAMERA, recording_mode: "standard", url: "enc:demo://lobby", cam_type: "demo" };
});

describe("setRecordingModeAction — tightening (standard → face_encrypted)", () => {
  it("is one click: written with a compare-and-set, audited, nobody paged", async () => {
    expect(await setRecordingModeAction(modeForm("face_encrypted"))).toEqual({ ok: true });
    expect(cameraWrites()).toEqual([
      {
        table: "cameras",
        op: "update",
        values: { recording_mode: "face_encrypted" },
        filters: { id: CAMERA, recording_mode: "standard" },
      },
    ]);
    const [row] = audits("CAMERA_RECORDING_MODE_CHANGE");
    expect(row.detail).toBe(`camera ${CAMERA} recording_mode: standard → face_encrypted [tighten]`);
    expect(events).toEqual([]);
    expect(state.camera!.recording_mode).toBe("face_encrypted");
  });

  it("a change made meanwhile is refused (the compare-and-set finds no row)", async () => {
    // Another admin wrote a value between this action's read and its write.
    state.raceAfterRead = { recording_mode: "legacy_value" };
    expect(await setRecordingModeAction(modeForm("face_encrypted"))).toEqual({ error: T.cam_rec_mode_err_conflict.en });
    expect(audits("CAMERA_RECORDING_MODE_CHANGE")).toEqual([]);
    expect(state.camera!.recording_mode).toBe("legacy_value");
  });
});

describe("setRecordingModeAction — loosening (face_encrypted → standard)", () => {
  beforeEach(() => {
    state.camera = { id: CAMERA, recording_mode: "face_encrypted" };
  });

  it("without a fresh TOTP step-up it is refused, nothing is written and the refusal is audited", async () => {
    expect(await setRecordingModeAction(modeForm("standard"))).toEqual({ error: "REAUTH_REQUIRED" });
    expect(cameraWrites()).toEqual([]);
    expect(audits().map((a) => a.action)).toEqual(["CAMERA_RECORDING_MODE_STEP_UP_REQUIRED"]);
    expect(events).toEqual([]);
    expect(state.camera!.recording_mode).toBe("face_encrypted");
  });

  it("a password-minted step-up is not enough", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "password");
    expect(await setRecordingModeAction(modeForm("standard"))).toEqual({ error: "REAUTH_REQUIRED" });
    expect(cameraWrites()).toEqual([]);
  });

  it("with TOTP it is written, audited and the other admins are notified", async () => {
    totp();
    expect(await setRecordingModeAction(modeForm("standard"))).toEqual({ ok: true });
    expect(cameraWrites()).toEqual([
      {
        table: "cameras",
        op: "update",
        values: { recording_mode: "standard" },
        filters: { id: CAMERA, recording_mode: "face_encrypted" },
      },
    ]);
    const [row] = audits("CAMERA_RECORDING_MODE_CHANGE");
    expect(row.detail).toBe(`camera ${CAMERA} recording_mode: face_encrypted → standard [loosen]`);
    expect(events.map((e) => e.action)).toEqual(["CAMERA_RECORDING_MODE_CHANGE"]);
    expect(events[0].detail).toContain("[loosen]");
  });

  it("an unknown stored value is judged as the stricter mode, so switching to standard still needs TOTP", async () => {
    state.camera = { id: CAMERA, recording_mode: "legacy_value" };
    expect(await setRecordingModeAction(modeForm("standard"))).toEqual({ error: "REAUTH_REQUIRED" });
    expect(cameraWrites()).toEqual([]);
  });
});

describe("setRecordingModeAction — refusals", () => {
  it("a no-op writes nothing", async () => {
    expect(await setRecordingModeAction(modeForm("standard"))).toEqual({ ok: true });
    expect(cameraWrites()).toEqual([]);
    expect(audits()).toEqual([]);
  });

  it("rejects an unknown mode and a bad id before touching the database", async () => {
    expect(await setRecordingModeAction(modeForm("raw"))).toEqual({ error: T.cam_rec_mode_err_invalid.en });
    expect(await setRecordingModeAction(modeForm("face_encrypted", "not-a-uuid"))).toEqual({ error: "missing id" });
    expect(ops).toEqual([]);
  });

  it("a missing camera and an unreadable row are explicit errors", async () => {
    state.camera = null;
    expect(await setRecordingModeAction(modeForm("face_encrypted"))).toEqual({ error: T.cam_rec_mode_err_not_found.en });
    state.failRead = true;
    expect(await setRecordingModeAction(modeForm("face_encrypted"))).toEqual({ error: T.cam_rec_mode_err_save.en });
    expect(cameraWrites()).toEqual([]);
  });
});

describe("addCameraAction / updateCameraAction carry the mode", () => {
  const cameraForm = (extra: Record<string, string> = {}) => {
    const f = new FormData();
    f.set("name", "Gate");
    f.set("url", "demo://gate");
    f.set("cam_type", "demo");
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };

  it("adding a face-encrypted camera writes the mode; standard stays the column default", async () => {
    totp();
    expect(await addCameraAction(cameraForm({ recording_mode: "face_encrypted" }))).toEqual({ ok: true });
    const insert = ops.find((o) => o.table === "cameras" && o.op === "insert")!;
    expect(insert.values).toMatchObject({ name: "Gate", recording_mode: "face_encrypted" });
    expect(events[0]).toMatchObject({ action: "CAMERA_ADD" });
    expect(events[0].detail).toContain("recording_mode: face_encrypted");

    ops.length = 0;
    expect(await addCameraAction(cameraForm({ recording_mode: "standard" }))).toEqual({ ok: true });
    const plain = ops.find((o) => o.table === "cameras" && o.op === "insert")!;
    expect(plain.values).not.toHaveProperty("recording_mode");
  });

  it("an unknown mode is refused before the insert", async () => {
    totp();
    expect(await addCameraAction(cameraForm({ recording_mode: "raw" }))).toEqual({ error: T.cam_rec_mode_err_invalid.en });
    expect(ops.filter((o) => o.table === "cameras")).toEqual([]);
  });

  it("an edit that switches back to standard (TOTP already required) writes the mode in the same row and notifies", async () => {
    state.camera = { id: CAMERA, recording_mode: "face_encrypted", url: "enc:demo://gate", cam_type: "demo" };
    expect(await updateCameraAction(cameraForm({ id: CAMERA, recording_mode: "standard" }))).toEqual({
      error: "REAUTH_REQUIRED",
    });
    expect(cameraWrites()).toEqual([]);

    totp();
    expect(await updateCameraAction(cameraForm({ id: CAMERA, recording_mode: "standard" }))).toEqual({ ok: true });
    const [update] = cameraWrites();
    expect(update.values).toMatchObject({ name: "Gate", recording_mode: "standard" });
    expect(audits().map((a) => a.action)).toEqual(["CAMERA_RECORDING_MODE_CHANGE", "CAMERA_UPDATE"]);
    expect(events.map((e) => e.action)).toEqual(["CAMERA_RECORDING_MODE_CHANGE"]);
  });

  it("an edit without the field leaves the mode alone", async () => {
    totp();
    expect(await updateCameraAction(cameraForm({ id: CAMERA }))).toEqual({ ok: true });
    const [update] = cameraWrites();
    expect(update.values).not.toHaveProperty("recording_mode");
    expect(audits("CAMERA_RECORDING_MODE_CHANGE")).toEqual([]);
  });
});

describe("the camera dialog and card", () => {
  const dialog = readFileSync(join(process.cwd(), "components", "camera-edit-dialog.tsx"), "utf8");
  const page = readFileSync(join(process.cwd(), "app", "(app)", "cameras", "page.tsx"), "utf8");

  it("a mode-only edit goes through setRecordingModeAction, so tightening stays one click", () => {
    expect(dialog).toContain('fd.get("op") === "recording_mode"');
    expect(dialog).toContain("await setRecordingModeAction(fd)");
    // REAUTH_REQUIRED from the mode action reuses the TOTP prompt + retry.
    expect(dialog).toMatch(/if \(res\.error === "REAUTH_REQUIRED"\) \{\s*pendingEdit\.current = fd;\s*setNeedsTotp\(true\);/);
  });

  it("the card offers the switch through StepUpForm with the loosening reason", () => {
    expect(page).toMatch(/<StepUpForm\s+action=\{setRecordingModeAction\}/);
    expect(page).toContain('stepUpDescription={t("cam_rec_mode_stepup_reason")}');
    expect(page).toContain('t("cam_rec_mode_badge_title")');
  });
});
