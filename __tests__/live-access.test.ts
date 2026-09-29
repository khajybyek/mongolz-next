/**
 * lib/live-access.ts — the page-side mirror of the stream gateway's live rule
 * (app/api/ml/stream/[cameraId]/[segment]/route.ts). Lists / health /
 * playback are default-allow; live video needs admin or a camera_permissions
 * row. Pages lock tiles up front with computeLiveAllowed / loadLiveAllowed,
 * map runtime 403 codes to a reason, and /cameras summarises grants.
 */
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.generated";
import { t as translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import {
  LIVE_LOCK_MIN,
  LIVE_TILE_OVERLAYS,
  STREAM_DENY_CODES,
  computeLiveAllowed,
  isRetryableDenial,
  isStreamDenyCode,
  lacksAnyLiveAccess,
  liveAccessSummary,
  liveAllowedForCamera,
  liveLockLayout,
  liveLockMessageKey,
  liveLockRetryable,
  liveLockShortKey,
  loadLiveAllowed,
  parseStreamDenyCode,
  probeStreamFailure,
  readStreamDenyCode,
  restrictedCameraIds,
  streamDenyMessageKey,
  summarizeLiveGrants,
  type LiveLock,
} from "@/lib/live-access";

const CAM_A = "11111111-1111-4111-8111-111111111111";
const CAM_B = "22222222-2222-4222-8222-222222222222";
const CAM_C = "33333333-3333-4333-8333-333333333333";
const CAMS = [CAM_A, CAM_B, CAM_C];

jest.mock("@/lib/log", () => ({ log: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

describe("computeLiveAllowed", () => {
  it("lets an admin watch every camera, grants or not", () => {
    expect(computeLiveAllowed("admin", CAMS, [])).toEqual({ [CAM_A]: true, [CAM_B]: true, [CAM_C]: true });
    expect(computeLiveAllowed("admin", CAMS, null)).toEqual({ [CAM_A]: true, [CAM_B]: true, [CAM_C]: true });
  });

  it("lets a viewer watch only the cameras they hold a grant for", () => {
    expect(computeLiveAllowed("viewer", CAMS, [CAM_B])).toEqual({ [CAM_A]: false, [CAM_B]: true, [CAM_C]: false });
  });

  it("ignores grants for cameras the page does not list", () => {
    expect(computeLiveAllowed("viewer", [CAM_A], [CAM_A, CAM_C])).toEqual({ [CAM_A]: true });
  });

  it("gives a viewer with no grants no live camera — no rows is not consent", () => {
    expect(computeLiveAllowed("viewer", CAMS, [])).toEqual({ [CAM_A]: false, [CAM_B]: false, [CAM_C]: false });
  });

  it("fails closed when the grant lookup failed", () => {
    expect(computeLiveAllowed("viewer", CAMS, null)).toEqual({ [CAM_A]: false, [CAM_B]: false, [CAM_C]: false });
  });

  it("never lets an auditor watch (the gateway refuses the role before any grant)", () => {
    expect(computeLiveAllowed("auditor", CAMS, CAMS)).toEqual({ [CAM_A]: false, [CAM_B]: false, [CAM_C]: false });
  });
});

describe("liveAllowedForCamera / lacksAnyLiveAccess (/live lists disabled cameras too)", () => {
  it("never calls a disabled camera watchable — the gateway answers camera_disabled", () => {
    const verdict = computeLiveAllowed("viewer", CAMS, [CAM_A, CAM_B]);
    expect(liveAllowedForCamera({ id: CAM_A, enabled: false }, verdict)).toBe(false);
    expect(liveAllowedForCamera({ id: CAM_B, enabled: true }, verdict)).toBe(true);
    expect(liveAllowedForCamera({ id: CAM_C, enabled: true }, verdict)).toBe(false);
    // Admins pass the grant half, not the enabled half.
    const admin = computeLiveAllowed("admin", CAMS, null);
    expect(liveAllowedForCamera({ id: CAM_A, enabled: false }, admin)).toBe(false);
    expect(liveAllowedForCamera({ id: CAM_A, enabled: true }, admin)).toBe(true);
  });

  it("says 'no live access' when a grant exists only on a disabled camera", () => {
    // Viewer granted on disabled D (A), not on enabled, running E (B).
    const verdict = computeLiveAllowed("viewer", [CAM_A, CAM_B], [CAM_A]);
    const cameras = [
      { id: CAM_A, enabled: false },
      { id: CAM_B, enabled: true },
    ].map((c) => ({ ...c, liveAllowed: liveAllowedForCamera(c, verdict) }));
    expect(cameras.map((c) => c.liveAllowed)).toEqual([false, false]);
    expect(lacksAnyLiveAccess(cameras)).toBe(true);
  });

  it("stays quiet when an enabled camera is watchable, or when every camera is disabled", () => {
    expect(
      lacksAnyLiveAccess([
        { enabled: true, liveAllowed: false },
        { enabled: true, liveAllowed: true },
      ]),
    ).toBe(false);
    expect(lacksAnyLiveAccess([{ enabled: false, liveAllowed: false }])).toBe(false);
    expect(lacksAnyLiveAccess([])).toBe(false);
  });
});

describe("loadLiveAllowed", () => {
  type Result = { data: Array<{ camera_id: string }> | null; error: { code?: string; message: string } | null };

  function fakeClient(result: Result | (() => never)) {
    const calls: Array<{ table: string; columns: string; filter: [string, unknown] }> = [];
    const client = {
      from: (table: string) => ({
        select: (columns: string) => ({
          eq: async (col: string, val: unknown) => {
            calls.push({ table, columns, filter: [col, val] });
            if (typeof result === "function") return result();
            return result;
          },
        }),
      }),
    };
    return { client: client as unknown as SupabaseClient<Database>, calls };
  }

  it("does not query for an admin and allows everything", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await expect(loadLiveAllowed(client, { userId: "u-admin", role: "admin" }, CAMS)).resolves.toEqual({
      [CAM_A]: true,
      [CAM_B]: true,
      [CAM_C]: true,
    });
    expect(calls).toHaveLength(0);
  });

  it("reads the viewer's own camera_permissions rows — the gateway's read", async () => {
    const { client, calls } = fakeClient({ data: [{ camera_id: CAM_C }, { camera_id: CAM_C }], error: null });
    await expect(loadLiveAllowed(client, { userId: "u-viewer", role: "viewer" }, CAMS)).resolves.toEqual({
      [CAM_A]: false,
      [CAM_B]: false,
      [CAM_C]: true,
    });
    expect(calls).toEqual([{ table: "camera_permissions", columns: "camera_id", filter: ["user_id", "u-viewer"] }]);
  });

  it("treats an RLS / query error as not allowed instead of crashing the page", async () => {
    const { client } = fakeClient({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(loadLiveAllowed(client, { userId: "u-viewer", role: "viewer" }, CAMS)).resolves.toEqual({
      [CAM_A]: false,
      [CAM_B]: false,
      [CAM_C]: false,
    });
  });

  it("treats a thrown client error as not allowed", async () => {
    const { client } = fakeClient(() => {
      throw new Error("fetch failed");
    });
    await expect(loadLiveAllowed(client, { userId: "u-viewer", role: "viewer" }, [CAM_A])).resolves.toEqual({
      [CAM_A]: false,
    });
  });

  it("skips the query when there is nothing to decide", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await expect(loadLiveAllowed(client, { userId: "u-viewer", role: "viewer" }, [])).resolves.toEqual({});
    await expect(loadLiveAllowed(client, { userId: "u-aud", role: "auditor" }, [CAM_A])).resolves.toEqual({
      [CAM_A]: false,
    });
    expect(calls).toHaveLength(0);
  });
});

describe("stream refusal codes", () => {
  const ROUTE = path.resolve(__dirname, "..", "app/api/ml/stream/[cameraId]/[segment]/route.ts");

  it("are exactly the codes the gateway answers with", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    const emitted = new Set([...src.matchAll(/deny\(cameraId,\s*"([a-z_]+)"/g)].map((m) => m[1]));
    expect([...emitted].sort()).toEqual([...STREAM_DENY_CODES].sort());
  });

  it("parse from the gateway's JSON body, text or object", () => {
    expect(parseStreamDenyCode('{"error":"forbidden: no access to this camera","code":"camera_not_authorized"}')).toBe(
      "camera_not_authorized",
    );
    expect(parseStreamDenyCode({ code: "camera_disabled" })).toBe("camera_disabled");
    expect(parseStreamDenyCode({ code: "permission_check_failed" })).toBe("permission_check_failed");
  });

  it("do not invent a code for a 403 without one (expired ticket) or for junk", () => {
    expect(parseStreamDenyCode('{"error":"invalid or expired stream ticket"}')).toBeNull();
    expect(parseStreamDenyCode('{"code":"camera_exploded"}')).toBeNull();
    expect(parseStreamDenyCode("#EXTM3U\n#EXT-X-VERSION:3")).toBeNull();
    expect(parseStreamDenyCode("")).toBeNull();
    expect(parseStreamDenyCode(null)).toBeNull();
    expect(parseStreamDenyCode(`{"code":"camera_disabled","pad":"${"x".repeat(5000)}"}`)).toBeNull();
    expect(isStreamDenyCode("camera_disabled")).toBe(true);
    expect(isStreamDenyCode("admin")).toBe(false);
  });

  it("read from the request hls.js reports: text playlists and binary segments", () => {
    const body = JSON.stringify({ error: "forbidden", code: "camera_disabled" });
    expect(readStreamDenyCode({ responseType: "text", responseText: body })).toBe("camera_disabled");
    expect(readStreamDenyCode({ responseType: "", responseText: body })).toBe("camera_disabled");
    const buf = new TextEncoder().encode(body);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    expect(readStreamDenyCode({ responseType: "arraybuffer", response: ab })).toBe("camera_disabled");
    // Reading responseText on a binary XHR throws — must not escape.
    const binaryXhr = {
      responseType: "arraybuffer",
      get responseText(): string {
        throw new Error("InvalidStateError");
      },
      response: null,
    };
    expect(readStreamDenyCode(binaryXhr)).toBeNull();
    expect(readStreamDenyCode(undefined)).toBeNull();
    expect(readStreamDenyCode(null)).toBeNull();
  });
});

describe("probeStreamFailure", () => {
  function res(status: number, body = ""): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    } as unknown as Response;
  }

  it("returns the gateway's refusal code for a 403", async () => {
    const fetchImpl = jest.fn(async () => res(403, '{"error":"forbidden","code":"camera_not_authorized"}'));
    await expect(probeStreamFailure("/api/ml/stream/x/index.m3u8?ticket=t", fetchImpl as unknown as typeof fetch)).resolves.toEqual({
      status: 403,
      code: "camera_not_authorized",
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/ml/stream/x/index.m3u8?ticket=t", expect.objectContaining({ cache: "no-store" }));
  });

  it("keeps a 403 without a code an ordinary failure", async () => {
    const fetchImpl = async () => res(403, '{"error":"invalid or expired stream ticket"}');
    await expect(probeStreamFailure("/s", fetchImpl as unknown as typeof fetch)).resolves.toEqual({ status: 403, code: null });
  });

  it("passes other statuses through, and reports no status for a playable playlist or a network error", async () => {
    await expect(probeStreamFailure("/s", (async () => res(404)) as unknown as typeof fetch)).resolves.toEqual({
      status: 404,
      code: null,
    });
    await expect(probeStreamFailure("/s", (async () => res(200, "#EXTM3U")) as unknown as typeof fetch)).resolves.toEqual({
      status: undefined,
      code: null,
    });
    await expect(
      probeStreamFailure("/s", (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch),
    ).resolves.toEqual({ status: undefined, code: null });
  });
});

describe("refusal code → message", () => {
  const LANGS: Lang[] = ["mn", "en", "kr"];

  it("maps each code to its own translated message", () => {
    expect(streamDenyMessageKey("camera_disabled")).toBe("live_denied_disabled");
    expect(streamDenyMessageKey("camera_not_authorized")).toBe("live_no_access");
    expect(streamDenyMessageKey("permission_check_failed")).toBe("live_denied_check_failed");
    const keys = STREAM_DENY_CODES.map(streamDenyMessageKey);
    expect(new Set(keys).size).toBe(STREAM_DENY_CODES.length);
    for (const key of keys) {
      for (const lang of LANGS) {
        const text = translate(key, lang);
        expect(text).not.toBe(key);
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  it("says a revoked grant the same way as a locked tile, and asks for an administrator", () => {
    expect(translate("live_no_access", "en")).toBe("You don't have live access to this camera — ask an administrator");
    expect(translate(streamDenyMessageKey("camera_not_authorized"), "kr")).toBe(translate("live_no_access", "kr"));
  });

  it("offers a manual retry only for a failed permission check", () => {
    expect(isRetryableDenial("permission_check_failed")).toBe(true);
    expect(isRetryableDenial("camera_disabled")).toBe(false);
    expect(isRetryableDenial("camera_not_authorized")).toBe(false);
  });
});

describe("locked tile copy and layout", () => {
  const LANGS: Lang[] = ["mn", "en", "kr"];
  const LOCKS: LiveLock[] = ["no_grant", ...STREAM_DENY_CODES];

  it("has a sentence and a one-line label for every lock, in every language", () => {
    expect(liveLockMessageKey("no_grant")).toBe("live_no_access");
    expect(liveLockMessageKey("camera_not_authorized")).toBe("live_no_access");
    expect(liveLockMessageKey("camera_disabled")).toBe("live_denied_disabled");
    expect(liveLockShortKey("no_grant")).toBe("live_no_access_short");
    expect(liveLockShortKey("camera_not_authorized")).toBe("live_no_access_short");
    expect(liveLockShortKey("camera_disabled")).toBe("live_denied_disabled_short");
    expect(liveLockShortKey("permission_check_failed")).toBe("live_denied_check_failed_short");
    for (const lock of LOCKS) {
      for (const lang of LANGS) {
        const full = translate(liveLockMessageKey(lock), lang);
        const short = translate(liveLockShortKey(lock), lang);
        expect(full).not.toBe(liveLockMessageKey(lock));
        expect(short).not.toBe(liveLockShortKey(lock));
        // The label is the one that must fit a dense tile on one line.
        expect(short.length).toBeLessThan(full.length);
        expect(short.length).toBeLessThanOrEqual(24);
      }
    }
  });

  it("offers Retry only for a failed permission check, never for a missing grant", () => {
    expect(LOCKS.filter(liveLockRetryable)).toEqual(["permission_check_failed"]);
  });

  const { top, bottom, sidePadding } = LIVE_TILE_OVERLAYS;
  const tileFor = (width: number, band: number) => ({ width: width + 2 * sidePadding, height: band + top + bottom });

  it("shows the full sentence on a focused tile, whatever its size", () => {
    expect(liveLockLayout(null, { focused: true, retry: true })).toBe("full");
    expect(liveLockLayout({ width: 100, height: 60 }, { focused: true, retry: false })).toBe("full");
  });

  it("starts as the bare icon before the tile is measured", () => {
    expect(liveLockLayout(null, { focused: false, retry: false })).toBe("icon");
  });

  it("picks the layout from the tile's measured size (desktop 2×2 / 3×3 / 4×4, phone 1 and 2 columns)", () => {
    const opts = { focused: false, retry: false };
    expect(liveLockLayout({ width: 495, height: 278 }, opts)).toBe("full"); // 2×2, 1280 px
    expect(liveLockLayout({ width: 328, height: 185 }, opts)).toBe("full"); // 3×3, 1280 px
    expect(liveLockLayout({ width: 245, height: 138 }, opts)).toBe("compact"); // 4×4, 1280 px
    expect(liveLockLayout({ width: 343, height: 193 }, opts)).toBe("full"); // phone, one tile
    expect(liveLockLayout({ width: 167, height: 94 }, opts)).toBe("icon"); // phone, two columns
  });

  it("keeps the sentence inside the band between the overlays", () => {
    const opts = { focused: false, retry: false };
    const { full, compact } = LIVE_LOCK_MIN;
    expect(liveLockLayout(tileFor(full.width, full.height), opts)).toBe("full");
    expect(liveLockLayout(tileFor(full.width, full.height - 1), opts)).toBe("compact");
    expect(liveLockLayout(tileFor(full.width - 1, full.height), opts)).toBe("compact");
    expect(liveLockLayout(tileFor(compact.width, compact.height), opts)).toBe("compact");
    expect(liveLockLayout(tileFor(compact.width, compact.height - 1), opts)).toBe("icon");
    expect(liveLockLayout(tileFor(compact.width - 1, 200), opts)).toBe("icon");
  });

  it("needs more height when the Retry button has to fit too", () => {
    const { full } = LIVE_LOCK_MIN;
    expect(liveLockLayout(tileFor(300, full.height), { focused: false, retry: true })).toBe("compact");
    expect(liveLockLayout(tileFor(300, full.heightWithRetry), { focused: false, retry: true })).toBe("full");
  });
});

describe("summarizeLiveGrants (admin /cameras)", () => {
  const roles = new Map([
    ["v1", "viewer"],
    ["v2", "viewer"],
    ["aud", "auditor"],
    ["adm", "admin"],
  ]);

  it("counts distinct viewers per camera; a view + operate pair is one person", () => {
    const out = summarizeLiveGrants(
      [
        { camera_id: CAM_A, user_id: "v1" },
        { camera_id: CAM_A, user_id: "v1" },
        { camera_id: CAM_A, user_id: "v2" },
        { camera_id: CAM_B, user_id: "v2" },
      ],
      roles,
    );
    expect(out.get(CAM_A)).toBe(2);
    expect(out.get(CAM_B)).toBe(1);
    expect(out.has(CAM_C)).toBe(false);
  });

  it("does not count auditors or admins — their rows grant no live video", () => {
    const out = summarizeLiveGrants(
      [
        { camera_id: CAM_A, user_id: "aud" },
        { camera_id: CAM_A, user_id: "adm" },
        { camera_id: CAM_A, user_id: "gone" },
      ],
      roles,
    );
    expect(out.get(CAM_A) ?? 0).toBe(0);
  });

  it("counts every distinct granted user when roles could not be read", () => {
    const out = summarizeLiveGrants(
      [
        { camera_id: CAM_A, user_id: "aud" },
        { camera_id: CAM_A, user_id: "v1" },
      ],
      null,
    );
    expect(out.get(CAM_A)).toBe(2);
  });

  it("is empty with no grants (production today)", () => {
    expect(summarizeLiveGrants([], roles).size).toBe(0);
  });
});

describe("restrictedCameraIds (the list level)", () => {
  it("marks every camera with any row — an auditor's row restricts lists even though it grants no live video", () => {
    const rows = [
      { camera_id: CAM_A, user_id: "aud" },
      { camera_id: CAM_B, user_id: "v1" },
      { camera_id: CAM_B, user_id: "v1" },
    ];
    expect([...restrictedCameraIds(rows)].sort()).toEqual([CAM_A, CAM_B].sort());
    const roles = new Map([
      ["aud", "auditor"],
      ["v1", "viewer"],
    ]);
    expect(summarizeLiveGrants(rows, roles).get(CAM_A) ?? 0).toBe(0);
  });

  it("is empty with no rows (production today)", () => {
    expect(restrictedCameraIds([]).size).toBe(0);
  });
});

describe("liveAccessSummary", () => {
  const en = (key: TranslationKey) => translate(key, "en");

  it("says admins only when the camera has no rows at all — and that lists stay open to every operator", () => {
    const s = liveAccessSummary(0, false, en);
    expect(s).toEqual({
      label: "Live: admins only",
      title: translate("cam_live_admins_only_tip", "en"),
      adminsOnly: true,
      state: "admins_only",
    });
    expect(s.title).toContain("stay visible to every operator");
  });

  it("does not claim lists stay open when rows exist but none grants live video (e.g. an auditor's)", () => {
    const s = liveAccessSummary(0, true, en);
    expect(s.label).toBe("Live: admins only");
    expect(s.adminsOnly).toBe(true);
    expect(s.title).toBe(translate("cam_live_admins_only_restricted_tip", "en"));
    expect(s.title).not.toContain("every operator");
    for (const lang of ["mn", "en", "kr"] as Lang[]) {
      expect(liveAccessSummary(0, true, (k) => translate(k, lang)).title).not.toBe(
        liveAccessSummary(0, false, (k) => translate(k, lang)).title,
      );
    }
  });

  it("gives the user count otherwise", () => {
    const s = liveAccessSummary(3, true, en);
    expect(s.label).toBe("Live: 3 user(s)");
    expect(s.title).toContain("3 user(s)");
    expect(s.adminsOnly).toBe(false);
    expect(s.state).toBe("users");
    expect(liveAccessSummary(1, true, (k) => translate(k, "mn")).label).toBe("Шууд: 1 хэрэглэгч");
  });

  it("never claims admins only when the grants were unreadable — and flags it as its own state", () => {
    expect(liveAccessSummary(null, false, en)).toEqual({
      label: "Live: unknown",
      title: translate("cam_live_unknown_tip", "en"),
      adminsOnly: false,
      state: "unknown",
    });
  });

  it("a disabled camera is refused to everyone, admins included — whatever the grants say", () => {
    for (const count of [null, 0, 4]) {
      const s = liveAccessSummary(count, true, en, false);
      expect(s).toEqual({
        label: "Live: camera disabled",
        title: translate("cam_live_disabled_tip", "en"),
        adminsOnly: false,
        state: "disabled",
      });
      expect(s.title).toContain("admins included");
    }
    // …and it agrees with the gateway mirror: no role watches a disabled camera.
    expect(liveAllowedForCamera({ id: CAM_A, enabled: false }, { [CAM_A]: true })).toBe(false);
    // Enabled is the default, so existing callers keep their labels.
    expect(liveAccessSummary(0, false, en).state).toBe("admins_only");
  });
});
