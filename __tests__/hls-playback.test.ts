/**
 * lib/hls-playback.ts — the live player behind components/hls-player.tsx.
 *
 * Covers the 2026-09-28 bug (live HLS refused after five minutes because
 * every request reused the first stream ticket) on both engines: hls.js
 * (ticket set per request in xhrSetup; chosen whenever it is supported, also
 * on Safari) and the native fallback (ticket only on the playlist URL, so a
 * renewal swaps the element's source — never while the viewer has paused).
 * Refusal codes from the gateway stay terminal; unmounting stops every timer.
 */
import type Hls from "hls.js";
import { startHlsPlayback, type HlsPlaybackOptions } from "@/lib/hls-playback";
import { EXPIRED_BACKOFF_BASE_MS, RENEW_AFTER_MS, STREAM_TICKET_TTL_SEC } from "@/lib/stream-ticket-renewal";

const NOW = Date.UTC(2026, 8, 28, 3, 0, 0);
const BASE = "https://app.test";
const CAM = "11111111-1111-4111-8111-111111111111";

function ticketExpiringAt(expMs: number, tag: string): string {
  return `${Buffer.from(`user-1:${CAM}:${Math.floor(expMs / 1000)}`).toString("base64url")}.${tag}`;
}
const fresh = (tag: string) => ticketExpiringAt(Date.now() + STREAM_TICKET_TTL_SEC * 1000, tag);
const streamSrc = (ticket: string) =>
  `/api/ml/stream/${CAM}/index.m3u8?ticket=${encodeURIComponent(ticket)}`;
const tagOf = (url: string) => {
  const t = new URL(url, BASE).searchParams.get("ticket") ?? "";
  return t.slice(t.indexOf(".") + 1);
};

type Listener = () => void;

class Listeners {
  private map = new Map<string, Set<Listener>>();
  addEventListener(type: string, fn: Listener) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.map.get(type)?.delete(fn);
  }
  dispatch(type: string) {
    for (const fn of [...(this.map.get(type) ?? [])]) fn();
  }
  count() {
    let n = 0;
    for (const set of this.map.values()) n += set.size;
    return n;
  }
}

/**
 * Enough of HTMLMediaElement for the native path: assigning `src` runs the
 * load algorithm (paused becomes true without a `pause` event) and, with the
 * autoplay attribute HlsPlayer renders by default, the element starts playing
 * on its own once data arrives (a microtask here).
 */
class FakeVideo extends Listeners {
  private _src = "";
  srcSets = 0;
  paused = true;
  autoplay = true;
  play = jest.fn(async () => {
    this.startPlaying();
  });
  constructor(private readonly native = false) {
    super();
  }
  get src() {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    this.srcSets += 1;
    this.paused = true;
    if (this.autoplay) void Promise.resolve().then(() => this.startPlaying());
  }
  canPlayType(type: string) {
    return this.native && type === "application/vnd.apple.mpegurl" ? "maybe" : "";
  }
  /** The viewer presses pause / play in the controls. */
  userPause() {
    this.paused = true;
    this.dispatch("pause");
  }
  userPlay() {
    this.startPlaying();
  }
  private startPlaying() {
    if (!this.paused) return;
    this.paused = false;
    this.dispatch("play");
  }
}

class FakeDoc extends Listeners {
  visibilityState: DocumentVisibilityState = "visible";
}

type HlsHandler = (event: string, data: Record<string, unknown>) => void;
type XhrSetup = (xhr: { open: jest.Mock }, url: string) => void;

const instances: FakeHls[] = [];

class FakeHls {
  static supported = true;
  static isSupported() {
    return FakeHls.supported;
  }
  static Events = { ERROR: "hlsError", LEVEL_LOADED: "hlsLevelLoaded", FRAG_LOADED: "hlsFragLoaded" };
  static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
  static ErrorDetails = {
    MANIFEST_LOAD_ERROR: "manifestLoadError",
    LEVEL_LOAD_ERROR: "levelLoadError",
    FRAG_LOAD_ERROR: "fragLoadError",
  };
  handlers = new Map<string, HlsHandler[]>();
  loadSource = jest.fn();
  attachMedia = jest.fn();
  stopLoad = jest.fn();
  startLoad = jest.fn();
  recoverMediaError = jest.fn();
  destroy = jest.fn();
  constructor(public config: { xhrSetup?: XhrSetup }) {
    instances.push(this);
  }
  on(event: string, fn: HlsHandler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
  }
  emit(event: string, data: Record<string, unknown> = {}) {
    for (const fn of this.handlers.get(event) ?? []) fn(event, data);
  }
  /** The URL hls.js would request for `url`, after xhrSetup. */
  requestUrl(url: string): string {
    const xhr = { open: jest.fn() };
    this.config.xhrSetup!(xhr, url);
    return xhr.open.mock.calls[0][1];
  }
}

const loadHls = async () => FakeHls as unknown as typeof Hls;

function response(status: number, body = ""): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
}
const EXPIRED_BODY = '{"error":"invalid or expired stream ticket"}';
const refusalBody = (code: string) => JSON.stringify({ error: "forbidden: no access to this camera", code });

/** A fatal 403 as hls.js reports it for a live playlist reload / segment. */
function forbidden(details: string, body = EXPIRED_BODY) {
  return {
    type: FakeHls.ErrorTypes.NETWORK_ERROR,
    details,
    fatal: true,
    response: { code: 403, text: "Forbidden" },
    networkDetails: { responseType: "", responseText: body },
  };
}

/**
 * `native`: the element plays HLS itself (Safari / iOS). `mse: false`: hls.js
 * is not supported there (older iOS without MediaSource / ManagedMediaSource),
 * which is the only case the native engine is used for.
 */
function setup(
  overrides: Partial<HlsPlaybackOptions> & { native?: boolean; mse?: boolean; firstTicket?: string } = {},
) {
  FakeHls.supported = overrides.mse ?? true;
  const video = new FakeVideo(overrides.native);
  const doc = new FakeDoc();
  let n = 1;
  const renewTicket = jest.fn(async () => {
    n += 1;
    return fresh(`t${n}`);
  });
  const fetchImpl = jest.fn(async (_url: string) => response(403, EXPIRED_BODY));
  const onError = jest.fn();
  const onPlaying = jest.fn();
  const firstTicket = overrides.firstTicket ?? fresh("t1");
  const opts: HlsPlaybackOptions = {
    video: video as unknown as HTMLVideoElement,
    src: streamSrc(firstTicket),
    loadHls,
    renewTicket,
    onError,
    onPlaying,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    baseUrl: BASE,
    doc: doc as unknown as Document,
    ...overrides,
  };
  const dispose = startHlsPlayback(opts);
  return {
    video,
    doc,
    renewTicket,
    fetchImpl,
    onError,
    onPlaying,
    dispose,
    firstTicket,
    hls: () => instances[instances.length - 1],
  };
}

const flush = () => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  instances.length = 0;
  FakeHls.supported = true;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("hls.js — ticket renewal", () => {
  it("renews before expiry and every later request carries the newest ticket", async () => {
    const s = setup();
    await flush();
    const hls = s.hls();
    expect(tagOf(hls.loadSource.mock.calls[0][0])).toBe("t1");
    expect(tagOf(hls.requestUrl(`${BASE}/api/ml/stream/${CAM}/index4.ts`))).toBe("t1");

    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS - 1);
    expect(s.renewTicket).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(s.renewTicket).toHaveBeenCalledTimes(1);

    // Playlist reloads and segments alike, even for a URL that still has the old ticket.
    expect(tagOf(hls.requestUrl(`${BASE}/api/ml/stream/${CAM}/index5.ts`))).toBe("t2");
    expect(tagOf(hls.requestUrl(`${BASE}${streamSrc(s.firstTicket)}`))).toBe("t2");

    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    expect(tagOf(hls.requestUrl(`${BASE}/api/ml/stream/${CAM}/index.m3u8`))).toBe("t3");
    // Nothing restarted: same instance, one loadSource.
    expect(instances).toHaveLength(1);
    expect(hls.loadSource).toHaveBeenCalledTimes(1);
    expect(s.onError).not.toHaveBeenCalled();
    s.dispose();
  });

  it("answers a 403 without a refusal code with one renewal and one retry", async () => {
    const s = setup();
    await flush();
    const hls = s.hls();

    hls.emit(FakeHls.Events.ERROR, forbidden(FakeHls.ErrorDetails.LEVEL_LOAD_ERROR));
    await flush();
    expect(hls.stopLoad).toHaveBeenCalledTimes(1);
    expect(s.renewTicket).toHaveBeenCalledTimes(1);
    expect(hls.startLoad).toHaveBeenCalledTimes(1);
    expect(tagOf(hls.requestUrl(`${BASE}/api/ml/stream/${CAM}/index9.ts`))).toBe("t2");
    expect(s.onError).not.toHaveBeenCalled();

    // The fresh ticket is refused as well: no second immediate renewal.
    hls.emit(FakeHls.Events.ERROR, forbidden(FakeHls.ErrorDetails.FRAG_LOAD_ERROR));
    await flush();
    expect(s.renewTicket).toHaveBeenCalledTimes(1);
    expect(hls.startLoad).toHaveBeenCalledTimes(1);
    expect(s.onError).toHaveBeenCalledWith(403, null);

    // The player gave up: nothing renews in the background any more.
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS * 4);
    expect(s.renewTicket).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it("renews again on a later expiry once loads succeeded in between", async () => {
    const s = setup();
    await flush();
    const hls = s.hls();
    hls.emit(FakeHls.Events.ERROR, forbidden(FakeHls.ErrorDetails.LEVEL_LOAD_ERROR));
    await flush();
    hls.emit(FakeHls.Events.LEVEL_LOADED);
    hls.emit(FakeHls.Events.ERROR, forbidden(FakeHls.ErrorDetails.LEVEL_LOAD_ERROR));
    await flush();
    expect(s.renewTicket).toHaveBeenCalledTimes(2);
    expect(hls.startLoad).toHaveBeenCalledTimes(2);
    expect(s.onError).not.toHaveBeenCalled();
    s.dispose();
  });

  it("backs off instead of hammering the ticket action", async () => {
    const s = setup();
    await flush();
    const hls = s.hls();
    hls.emit(FakeHls.Events.ERROR, forbidden(FakeHls.ErrorDetails.LEVEL_LOAD_ERROR));
    await flush();
    hls.emit(FakeHls.Events.ERROR, forbidden(FakeHls.ErrorDetails.LEVEL_LOAD_ERROR));
    await flush();
    expect(s.onError).toHaveBeenCalledTimes(1);
    // A reported failure is final for this player; later errors are ignored.
    await jest.advanceTimersByTimeAsync(EXPIRED_BACKOFF_BASE_MS);
    hls.emit(FakeHls.Events.ERROR, forbidden(FakeHls.ErrorDetails.LEVEL_LOAD_ERROR));
    await flush();
    expect(s.renewTicket).toHaveBeenCalledTimes(1);
    expect(s.onError).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it("reloads the manifest with the fresh ticket when the first request was refused", async () => {
    const s = setup();
    await flush();
    const hls = s.hls();
    hls.emit(FakeHls.Events.ERROR, forbidden(FakeHls.ErrorDetails.MANIFEST_LOAD_ERROR));
    await flush();
    expect(hls.loadSource).toHaveBeenCalledTimes(2);
    expect(tagOf(hls.loadSource.mock.calls[1][0])).toBe("t2");
    expect(hls.startLoad).not.toHaveBeenCalled();
    s.dispose();
  });

  it("waits for a renewal before the first request when mounted with an expired ticket", async () => {
    const s = setup({ firstTicket: ticketExpiringAt(Date.now() - 60_000, "old") });
    await flush();
    expect(s.renewTicket).toHaveBeenCalledTimes(1);
    const hls = s.hls();
    expect(hls.loadSource).toHaveBeenCalledTimes(1);
    expect(tagOf(hls.loadSource.mock.calls[0][0])).toBe("t2");
    expect(tagOf(hls.requestUrl(`${BASE}/api/ml/stream/${CAM}/index0.ts`))).toBe("t2");
    s.dispose();
  });
});

describe("hls.js — refusals stay terminal", () => {
  it.each(["camera_disabled", "camera_not_authorized", "permission_check_failed"])(
    "reports %s from the failing response without renewing",
    async (code) => {
      const s = setup();
      await flush();
      const hls = s.hls();
      hls.emit(FakeHls.Events.ERROR, forbidden(FakeHls.ErrorDetails.FRAG_LOAD_ERROR, refusalBody(code)));
      await flush();
      expect(s.onError).toHaveBeenCalledWith(403, code);
      expect(s.fetchImpl).not.toHaveBeenCalled();
      expect(s.renewTicket).not.toHaveBeenCalled();
      expect(hls.startLoad).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(STREAM_TICKET_TTL_SEC * 1000 * 3);
      expect(s.renewTicket).not.toHaveBeenCalled();
      s.dispose();
    },
  );

  it("asks the gateway when the failing response is unreadable, and stays terminal", async () => {
    const s = setup();
    s.fetchImpl.mockResolvedValue(response(403, refusalBody("camera_not_authorized")));
    await flush();
    const hls = s.hls();
    hls.emit(FakeHls.Events.ERROR, {
      ...forbidden(FakeHls.ErrorDetails.FRAG_LOAD_ERROR),
      networkDetails: { responseType: "arraybuffer", response: null },
    });
    await flush();
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    expect(tagOf(s.fetchImpl.mock.calls[0][0])).toBe("t1");
    expect(s.onError).toHaveBeenCalledWith(403, "camera_not_authorized");
    expect(s.renewTicket).not.toHaveBeenCalled();
    s.dispose();
  });

  it("keeps the old behaviour without a renewTicket: a 403 is reported", async () => {
    const s = setup({ renewTicket: undefined });
    await flush();
    const hls = s.hls();
    hls.emit(FakeHls.Events.ERROR, forbidden(FakeHls.ErrorDetails.LEVEL_LOAD_ERROR));
    await flush();
    expect(s.onError).toHaveBeenCalledWith(403, null);
    expect(hls.startLoad).not.toHaveBeenCalled();
    s.dispose();
  });
});

describe("engine choice", () => {
  it("uses hls.js on a native-HLS browser that supports it, so renewals never reload", async () => {
    const s = setup({ native: true });
    await flush();
    expect(instances).toHaveLength(1);
    expect(s.video.srcSets).toBe(0);
    const hls = s.hls();
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    expect(s.renewTicket).toHaveBeenCalledTimes(1);
    expect(tagOf(hls.requestUrl(`${BASE}/api/ml/stream/${CAM}/index7.ts`))).toBe("t2");
    expect(s.video.srcSets).toBe(0);
    expect(hls.loadSource).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it("falls back to native HLS when the hls.js chunk fails to load", async () => {
    const s = setup({ native: true, loadHls: () => Promise.reject(new Error("chunk load failed")) });
    await flush();
    expect(instances).toHaveLength(0);
    expect(tagOf(s.video.src)).toBe("t1");
    expect(s.onError).not.toHaveBeenCalled();
    s.dispose();
  });

  it("reports when hls.js fails to load and the element cannot play HLS", async () => {
    const s = setup({ loadHls: () => Promise.reject(new Error("chunk load failed")) });
    await flush();
    expect(s.video.srcSets).toBe(0);
    expect(s.onError).toHaveBeenCalledWith(undefined, undefined);
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS * 2);
    expect(s.renewTicket).not.toHaveBeenCalled();
    s.dispose();
  });
});

describe("native HLS fallback (no MediaSource)", () => {
  it("points the element at the renewed ticket (the playlist URL is the only carrier)", async () => {
    const s = setup({ native: true, mse: false });
    await flush();
    expect(instances).toHaveLength(0);
    expect(tagOf(s.video.src)).toBe("t1");
    expect(s.video.paused).toBe(false);

    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    expect(tagOf(s.video.src)).toBe("t2");
    expect(new URL(s.video.src).pathname).toBe(`/api/ml/stream/${CAM}/index.m3u8`);
    expect(s.video.play).toHaveBeenCalledTimes(1);
    expect(s.video.paused).toBe(false);
    s.dispose();
  });

  it("keeps a paused element paused across a renewal and swaps when the viewer resumes", async () => {
    const s = setup({ native: true, mse: false });
    await flush();
    s.video.userPause();

    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    expect(s.renewTicket).toHaveBeenCalledTimes(1);
    // No load algorithm: the paused frame stays and autoplay cannot restart it.
    expect(s.video.srcSets).toBe(1);
    expect(tagOf(s.video.src)).toBe("t1");
    expect(s.video.paused).toBe(true);
    expect(s.video.play).not.toHaveBeenCalled();

    // A second renewal while still paused: the newest ticket is the one queued.
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    expect(s.renewTicket).toHaveBeenCalledTimes(2);
    expect(s.video.srcSets).toBe(1);

    s.video.userPlay();
    await flush();
    expect(s.video.srcSets).toBe(2);
    expect(tagOf(s.video.src)).toBe("t3");
    expect(s.video.paused).toBe(false);

    // Back to swapping on schedule once playing again.
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    expect(tagOf(s.video.src)).toBe("t4");
    expect(s.onError).not.toHaveBeenCalled();
    s.dispose();
  });

  it("does not treat its own source swap as the viewer pausing", async () => {
    const s = setup({ native: true, mse: false });
    await flush();
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    expect(tagOf(s.video.src)).toBe("t2");
    // The swap paused the element internally (no `pause` event); the next
    // renewal must still apply at once.
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    expect(tagOf(s.video.src)).toBe("t3");
    s.dispose();
  });

  it("while paused, blames an error on the queued ticket and applies it on resume", async () => {
    const s = setup({ native: true, mse: false });
    await flush();
    s.video.userPause();
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);

    s.video.dispatch("error");
    await flush();
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(s.renewTicket).toHaveBeenCalledTimes(1);
    expect(s.onError).not.toHaveBeenCalled();
    expect(tagOf(s.video.src)).toBe("t1");

    s.video.userPlay();
    await flush();
    expect(tagOf(s.video.src)).toBe("t2");
    s.dispose();
  });

  it("still reports a refusal that surfaces after a paused viewer resumes", async () => {
    const s = setup({ native: true, mse: false });
    await flush();
    s.video.userPause();
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    s.video.userPlay();
    await flush();

    s.fetchImpl.mockResolvedValue(response(403, refusalBody("camera_not_authorized")));
    s.video.dispatch("error");
    await flush();
    expect(s.onError).toHaveBeenCalledWith(403, "camera_not_authorized");
    expect(s.renewTicket).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS * 2);
    expect(s.renewTicket).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it("renews once on an expired-ticket error, then reports a repeat", async () => {
    const s = setup({ native: true, mse: false });
    await flush();
    s.video.dispatch("error");
    await flush();
    expect(s.renewTicket).toHaveBeenCalledTimes(1);
    expect(tagOf(s.video.src)).toBe("t2");
    expect(s.onError).not.toHaveBeenCalled();

    s.video.dispatch("error");
    await flush();
    expect(s.renewTicket).toHaveBeenCalledTimes(1);
    expect(s.onError).toHaveBeenCalledWith(403, null);
    s.dispose();
  });

  it("reports a refusal code without renewing", async () => {
    const s = setup({ native: true, mse: false });
    s.fetchImpl.mockResolvedValue(response(403, refusalBody("camera_disabled")));
    await flush();
    s.video.dispatch("error");
    await flush();
    expect(s.onError).toHaveBeenCalledWith(403, "camera_disabled");
    expect(s.renewTicket).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS * 2);
    expect(s.renewTicket).not.toHaveBeenCalled();
    expect(tagOf(s.video.src)).toBe("t1");
    s.dispose();
  });
});

describe("unmount", () => {
  it("stops renewing, removes every listener and destroys hls.js", async () => {
    const s = setup();
    await flush();
    const hls = s.hls();
    expect(s.video.count()).toBeGreaterThan(0);
    expect(s.doc.count()).toBe(1);
    s.dispose();
    expect(hls.destroy).toHaveBeenCalledTimes(1);
    expect(s.video.count()).toBe(0);
    expect(s.doc.count()).toBe(0);
    await jest.advanceTimersByTimeAsync(STREAM_TICKET_TTL_SEC * 1000 * 3);
    expect(s.renewTicket).not.toHaveBeenCalled();
  });

  it("ignores a renewal that finishes after unmount", async () => {
    let release!: (t: string) => void;
    const renewTicket = jest.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const s = setup({ native: true, mse: false, renewTicket });
    await flush();
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    expect(renewTicket).toHaveBeenCalledTimes(1);
    s.dispose();
    release(fresh("t2"));
    await flush();
    expect(tagOf(s.video.src)).toBe("t1");
    expect(s.video.play).not.toHaveBeenCalled();
  });

  it("drops a swap queued for a paused viewer on unmount", async () => {
    const s = setup({ native: true, mse: false });
    await flush();
    s.video.userPause();
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    s.dispose();
    expect(s.video.count()).toBe(0);
    s.video.userPlay();
    await flush();
    expect(tagOf(s.video.src)).toBe("t1");
  });

  it("does not create a player when unmounted before hls.js loaded", async () => {
    let resolve!: (h: typeof Hls) => void;
    const s = setup({ loadHls: () => new Promise((r) => (resolve = r)) });
    s.dispose();
    resolve(FakeHls as unknown as typeof Hls);
    await flush();
    expect(instances).toHaveLength(0);
    expect(s.onError).not.toHaveBeenCalled();
  });

  it("does not report a failure whose probe resolves after unmount", async () => {
    const s = setup();
    s.fetchImpl.mockResolvedValue(response(403, refusalBody("camera_disabled")));
    await flush();
    s.hls().emit(FakeHls.Events.ERROR, {
      ...forbidden(FakeHls.ErrorDetails.LEVEL_LOAD_ERROR),
      networkDetails: null,
    });
    s.dispose();
    await flush();
    expect(s.onError).not.toHaveBeenCalled();
  });
});

describe("page visibility", () => {
  it("renews at once when the page returns with an overdue renewal", async () => {
    const s = setup();
    await flush();
    jest.setSystemTime(Date.now() + RENEW_AFTER_MS + 20_000);
    s.doc.visibilityState = "hidden";
    s.doc.dispatch("visibilitychange");
    expect(s.renewTicket).not.toHaveBeenCalled();
    s.doc.visibilityState = "visible";
    s.doc.dispatch("visibilitychange");
    expect(s.renewTicket).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it("marks the renewer healthy when frames play", async () => {
    const s = setup({ native: true, mse: false });
    await flush();
    s.video.dispatch("error");
    await flush();
    s.video.dispatch("playing");
    expect(s.onPlaying).toHaveBeenCalledTimes(1);
    s.video.dispatch("error");
    await flush();
    // Frames played in between, so the second expiry gets a renewal too.
    expect(s.renewTicket).toHaveBeenCalledTimes(2);
    expect(s.onError).not.toHaveBeenCalled();
    s.dispose();
  });
});
