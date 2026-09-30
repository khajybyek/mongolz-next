/**
 * Face-encrypted recordings (ADR 0013) on the web side: the pure helpers in
 * lib/recording-mode.ts, the reveal-start gate, the reveal error code, the
 * playback page's routing and the mn/en/kr copy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import {
  classifyRecordingModeChange,
  displayRecordingMode,
  isFaceEncryptedRecording,
  isRecordingMode,
  recordingObjectPaths,
  recordingRevealable,
  recordingViewable,
  storedRecordingMode,
} from "@/lib/recording-mode";
import { revealErrorText, revealWithheldByPrivacy } from "@/lib/reveal-errors";
import { T, type TranslationKey } from "@/lib/i18n/translations";

const RECORDING = "22222222-2222-4333-8444-555555555555";
const SUSPECT = "33333333-2222-4333-8444-555555555555";

const state = { rec: null as Record<string, unknown> | null };
const inserted = jest.fn();

jest.mock("next/server", () => ({ ...jest.requireActual("next/server"), after: jest.fn() }));
jest.mock("@/lib/supabase/auth", () => ({
  requireAdminApi: jest.fn(async () => ({ user: { id: "admin-1", email: "admin@example.test" }, profile: { role: "admin" } })),
  isAuthErr: (r: object) => "error" in r,
}));
jest.mock("@/lib/auth/step-up", () => ({ hasFreshReauth: jest.fn(async () => true) }));
jest.mock("@/lib/rate-limit", () => ({ checkRateLimit: jest.fn(async () => ({ ok: true })), REVEAL_LIMIT: {} }));
jest.mock("@/lib/notify", () => ({ notifyRevealRequested: jest.fn() }));
jest.mock("@/lib/ml-client", () => ({ mlEmbed: jest.fn(), MLError: class extends Error {} }));
jest.mock("@/lib/supabase/server", () => {
  const client = () => ({
    from: (table: string) => {
      const read = async () => {
        if (table === "profiles") return { data: { role: "admin", reveal_level: 0 }, error: null };
        if (table === "recordings") return { data: state.rec, error: null };
        if (table === "suspects") return { data: { name: "fixture", embedding: [0.1] }, error: null };
        return { data: null, error: null };
      };
      return {
        select: () => ({ eq: () => ({ single: read, maybeSingle: read }) }),
        insert: (data: unknown) => {
          inserted(table, data);
          return { select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) };
        },
      };
    },
  });
  return { createServiceClient: client, createClient: async () => client() };
});

import { POST as startReveal } from "@/app/api/reveal/start/route";

function start() {
  const form = new FormData();
  form.set("recording_id", RECORDING);
  form.set("method", "suspect");
  form.set("reason", "Investigate the reported entry incident");
  form.set("suspect_id", SUSPECT);
  return startReveal(new NextRequest("https://app.test/api/reveal/start", { method: "POST", body: form }));
}

describe("lib/recording-mode", () => {
  it("face_encrypted is the stricter mode", () => {
    expect(classifyRecordingModeChange("standard", "face_encrypted")).toBe("tighten");
    expect(classifyRecordingModeChange("face_encrypted", "standard")).toBe("loosen");
    expect(classifyRecordingModeChange("standard", "standard")).toBe("noop");
    expect(classifyRecordingModeChange("face_encrypted", "face_encrypted")).toBe("noop");
  });

  it("an unknown stored value is judged as the opposite of the target", () => {
    expect(storedRecordingMode("face_encrypted", "standard")).toEqual({ mode: "face_encrypted", known: true });
    expect(storedRecordingMode(null, "standard")).toEqual({ mode: "face_encrypted", known: false });
    expect(storedRecordingMode("baked", "face_encrypted")).toEqual({ mode: "standard", known: false });
    expect(isRecordingMode("on_demand")).toBe(false);
  });

  it("shows an unknown or missing mode as standard (the ML default)", () => {
    expect(displayRecordingMode(undefined)).toBe("standard");
    expect(displayRecordingMode("x")).toBe("standard");
    expect(displayRecordingMode("face_encrypted")).toBe("face_encrypted");
  });

  it("a face-encrypted row is viewable without a raw original and revealable only with its envelope", () => {
    const fe = { blur_strategy: "face_encrypted", has_original: false };
    expect(isFaceEncryptedRecording(fe)).toBe(true);
    expect(recordingViewable(fe)).toBe(true);
    expect(recordingRevealable(fe)).toBe(false);
    expect(recordingRevealable({ ...fe, face_envelope_path: "" })).toBe(false);
    expect(recordingRevealable({ ...fe, face_envelope_path: "cam/r_faces.mfe" })).toBe(true);
    // The ML marks a delivered face-encrypted row has_original = true; the
    // envelope still decides — no envelope, nothing to unseal.
    expect(recordingRevealable({ ...fe, has_original: true })).toBe(false);
    expect(recordingRevealable({ ...fe, has_original: true, face_envelope_path: "cam/r_faces.mfe.enc" })).toBe(true);
  });

  it("standard rows keep today's has_original rule", () => {
    expect(recordingViewable({ blur_strategy: "on_demand", has_original: false })).toBe(false);
    expect(recordingRevealable({ blur_strategy: "on_demand", has_original: false, face_envelope_path: "x" })).toBe(false);
    expect(recordingViewable({ blur_strategy: "baked", has_original: true })).toBe(true);
    expect(recordingRevealable({ blur_strategy: "baked", has_original: true })).toBe(true);
  });

  it("lists every object a recordings row owns, without duplicates or nulls", () => {
    expect(recordingObjectPaths({ storage_path: "a.enc", original_path: "a.enc", face_envelope_path: null })).toEqual(["a.enc"]);
    expect(recordingObjectPaths({ storage_path: "m.enc", original_path: null, face_envelope_path: "f.mfe" })).toEqual(["m.enc", "f.mfe"]);
    expect(recordingObjectPaths({ storage_path: "b.mp4", original_path: "o.enc" })).toEqual(["b.mp4", "o.enc"]);
  });
});

describe("POST /api/reveal/start on a face-encrypted recording", () => {
  beforeEach(() => inserted.mockClear());

  it("accepts a request when the sealed face envelope exists (no raw original needed)", async () => {
    state.rec = { id: RECORDING, has_original: false, blur_strategy: "face_encrypted", face_envelope_path: "cam/r_faces.mfe", filename: "r.mp4", duration_sec: 60 };
    const res = await start();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job_id: "job-1", status: "pending_approval" });
    expect(inserted).toHaveBeenCalledWith("reveal_jobs", expect.objectContaining({ status: "pending_approval" }));
  });

  it("refuses with NO_FACE_ENVELOPE when the envelope is missing", async () => {
    state.rec = { id: RECORDING, has_original: false, blur_strategy: "face_encrypted", face_envelope_path: null, filename: "r.mp4", duration_sec: 60 };
    const res = await start();
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("NO_FACE_ENVELOPE");
    expect(inserted).not.toHaveBeenCalledWith("reveal_jobs", expect.anything());
  });

  it("still refuses a standard row without an original with NO_ORIGINAL", async () => {
    state.rec = { id: RECORDING, has_original: false, blur_strategy: "on_demand", face_envelope_path: null, filename: "r.mp4", duration_sec: 60 };
    const res = await start();
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("NO_ORIGINAL");
  });

  it("the reveal modal translates the new refusal code", () => {
    const src = readFileSync(join(process.cwd(), "app", "(app)", "playback", "[id]", "reveal-modal.tsx"), "utf8");
    expect(src).toContain('NO_FACE_ENVELOPE: "pb_reveal_err_no_envelope"');
  });
});

describe("reveal job error [face_envelope_empty]", () => {
  it("is translated, and it is not a privacy-policy withholding", () => {
    const message = "[face_envelope_empty] no sealed face of the selected person";
    for (const lang of ["mn", "en", "kr"] as const) {
      expect(revealErrorText(message, (k: TranslationKey) => T[k][lang])).toBe(T.reveal_err_face_envelope_empty[lang]);
    }
    expect(revealWithheldByPrivacy(message)).toBe(false);
  });

  it("the other two envelope failures are translated too, and neither is a withholding", () => {
    const cases = {
      face_envelope_unavailable: T.reveal_err_face_envelope_unavailable,
      face_envelope_invalid: T.reveal_err_face_envelope_invalid,
    } as const;
    for (const [code, entry] of Object.entries(cases)) {
      const message = `[${code}] ML text`;
      for (const lang of ["mn", "en", "kr"] as const) {
        expect(revealErrorText(message, (k: TranslationKey) => T[k][lang])).toBe(entry[lang]);
      }
      expect(revealWithheldByPrivacy(message)).toBe(false);
    }
  });
});

describe("playback routing", () => {
  const page = readFileSync(join(process.cwd(), "app", "(app)", "playback", "[id]", "page.tsx"), "utf8");

  it("streams a face-encrypted recording through the audited view route, never a signed Storage link", () => {
    expect(page).toContain('if (rec.blur_strategy === "on_demand" || faceEncrypted) {');
    expect(page).toContain("blurredUrl = `/api/recordings/${rec.id}/view`;");
  });

  it("shows the notice and hands the flag to the reveal modal", () => {
    expect(page).toContain('t("pb_face_encrypted_title")');
    expect(page).toContain("faceEncrypted={faceEncrypted}");
  });
});

describe("face-encrypted copy (mn / en / kr)", () => {
  const KEYS = (Object.keys(T) as TranslationKey[]).filter(
    (k) =>
      k.startsWith("cam_rec_mode") ||
      k.startsWith("pb_face_encrypted") ||
      k === "rec_original_face_encrypted" ||
      k === "reveal_not_possible_face_envelope" ||
      k === "pb_reveal_err_no_envelope" ||
      k === "pb_reveal_face_encrypted_notice" ||
      k.startsWith("reveal_err_face_envelope_"),
  );

  it("covers the whole feature", () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(22);
  });

  it("every key is filled in for all three languages and differs from English in mn and kr", () => {
    for (const key of KEYS) {
      for (const lang of ["mn", "en", "kr"] as const) expect({ key, lang, ok: T[key][lang].length > 0 }).toEqual({ key, lang, ok: true });
      expect({ key, mn: T[key].mn === T[key].en }).toEqual({ key, mn: false });
      expect({ key, kr: T[key].kr === T[key].en }).toEqual({ key, kr: false });
    }
  });

  it("Mongolian and Korean use native terms, not English words (TOTP is the product name)", () => {
    const ENGLISH = /\b(reveal|face|encrypt\w*|envelope|standard|original|track|blob|cipher)\b/i;
    for (const key of KEYS) {
      for (const lang of ["mn", "kr"] as const) {
        expect({ key, lang, text: T[key][lang] }).toEqual({ key, lang, text: expect.not.stringMatching(ENGLISH) });
      }
    }
  });
});
