/**
 * scripts/uptime-probe.cjs — the external (GitHub Actions) uptime probe.
 * Plain CommonJS so the workflow needs no install; loaded at run time.
 */
import path from "node:path";

type State = { web: boolean; db: boolean | null; ml: boolean | null; detail: string };
type Probe = {
  classify: (r: { status: number; body: unknown; error: string | null }) => State;
  transitions: (prev: Partial<State> | null, cur: State) => string[];
  message: (kind: string, cur: State, url: string, now: Date) => string;
  kstClock: (d: Date) => string;
  run: (deps: Record<string, unknown>) => Promise<number>;
};
const probe = jest.requireActual<Probe>(path.join(__dirname, "..", "scripts", "uptime-probe.cjs"));

const OK = { status: "ok", checks: { ml: { ok: true }, db: { ok: true } } };
const DB_DOWN = { status: "degraded", checks: { ml: { ok: true }, db: { ok: false } } };
const ML_DOWN = { status: "degraded", checks: { ml: { ok: false }, db: { ok: true } } };
const TOKEN = "123456:secret-token-value";

type Reply = { status: number; body?: unknown; raw?: string; throws?: Error };

/** A fake fetch: uptime replies in order (the last one repeats), Telegram recorded. */
function fakeFetch(uptime: Reply[], telegramStatus = 200) {
  const sent: { url: string; text: string }[] = [];
  let i = 0;
  const impl = jest.fn(async (url: string, init?: { body?: string }) => {
    if (url.startsWith("https://api.telegram.org/")) {
      sent.push({ url, text: JSON.parse(init?.body ?? "{}").text });
      return { ok: telegramStatus < 300, status: telegramStatus, text: async () => "" };
    }
    const r = uptime[Math.min(i++, uptime.length - 1)];
    if (r.throws) throw r.throws;
    return { ok: r.status < 300, status: r.status, text: async () => r.raw ?? JSON.stringify(r.body) };
  });
  return { impl, sent };
}

function harness(opts: { uptime: Reply[]; prev?: Partial<State> | null; env?: Record<string, string>; telegramStatus?: number }) {
  const { impl, sent } = fakeFetch(opts.uptime, opts.telegramStatus);
  const writes: string[] = [];
  const logs: string[] = [];
  const deps = {
    env: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "-100", PROBE_RETRY_DELAY_MS: "0", ...(opts.env ?? {}) },
    fetchImpl: impl,
    sleep: async () => {},
    now: () => new Date("2026-09-28T03:00:00Z"),
    log: (l: string) => logs.push(l),
    writeFile: (_f: string, text: string) => writes.push(text),
    readStateFile: () => opts.prev ?? null,
  };
  return { deps, sent, writes, logs, impl };
}

describe("classify", () => {
  it("reads the /api/uptime contract", () => {
    expect(probe.classify({ status: 200, body: OK, error: null })).toMatchObject({ web: true, db: true, ml: true });
    expect(probe.classify({ status: 503, body: DB_DOWN, error: null })).toMatchObject({ web: true, db: false, ml: true });
  });

  it("treats anything that is not the app's JSON as web down with the database unknown", () => {
    expect(probe.classify({ status: 502, body: null, error: null })).toMatchObject({ web: false, db: null, ml: null });
    expect(probe.classify({ status: 200, body: { hello: "world" }, error: null })).toMatchObject({ web: false, db: null });
    expect(probe.classify({ status: 0, body: null, error: "timeout after 15000 ms" })).toMatchObject({
      web: false,
      detail: "timeout after 15000 ms",
    });
  });
});

describe("transitions", () => {
  const up = { web: true, db: true, ml: true, detail: "" };
  it("announces each web / database change once", () => {
    expect(probe.transitions(up, { ...up, web: false, db: null })).toEqual(["web_down"]);
    expect(probe.transitions({ web: false, db: null }, up)).toEqual(["web_recovered"]);
    expect(probe.transitions(up, { ...up, db: false })).toEqual(["db_down"]);
    expect(probe.transitions({ web: true, db: false }, up)).toEqual(["db_recovered"]);
    expect(probe.transitions(up, up)).toEqual([]);
  });

  it("does not compare the database when the web app did not answer before", () => {
    expect(probe.transitions({ web: false, db: null }, { ...up, db: false })).toEqual(["web_recovered"]);
  });

  it("ignores ML (the pg_cron monitor reports it)", () => {
    expect(probe.transitions(up, { ...up, ml: false })).toEqual([]);
  });

  it("treats a missing state as everything up, so an ongoing outage is still reported", () => {
    expect(probe.transitions(null, { web: false, db: null, ml: null, detail: "" })).toEqual(["web_down"]);
    expect(probe.transitions(null, up)).toEqual([]);
  });
});

describe("message", () => {
  it("is Mongolian, in Asia/Seoul time and names the source", () => {
    const text = probe.message("db_down", { web: true, db: false, ml: true, detail: "HTTP 503" }, "https://aicctv.dev/api/uptime", new Date("2026-09-28T15:30:00Z"));
    expect(text).toContain("өгөгдлийн сан");
    expect(text).toContain("2026-09-29 00:30 KST");
    expect(text).toContain("GitHub Actions");
    expect(probe.message("web_down", { web: false, db: null, ml: null, detail: "timeout after 15000 ms" }, "u", new Date())).toContain("timeout after 15000 ms");
  });
});

describe("run", () => {
  it("healthy site: exit 0, no message, state saved", async () => {
    const h = harness({ uptime: [{ status: 200, body: OK }], prev: { web: true, db: true } });
    await expect(probe.run(h.deps)).resolves.toBe(0);
    expect(h.sent).toHaveLength(0);
    expect(JSON.parse(h.writes[0])).toMatchObject({ web: true, db: true });
  });

  it("retries and uses the first healthy answer (no alert for a single blip)", async () => {
    const h = harness({ uptime: [{ status: 502, raw: "<html>" }, { status: 200, body: OK }], prev: { web: true, db: true } });
    await expect(probe.run(h.deps)).resolves.toBe(0);
    expect(h.sent).toHaveLength(0);
    expect(h.impl).toHaveBeenCalledTimes(2);
  });

  it("outage: one web_down, exit 1; the next run while still down sends nothing", async () => {
    const first = harness({ uptime: [{ status: 0, throws: new Error("getaddrinfo ENOTFOUND") }], prev: { web: true, db: true } });
    await expect(probe.run(first.deps)).resolves.toBe(1);
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0].text).toContain("вэб апп хариу өгөхгүй");
    const saved = JSON.parse(first.writes[0]);
    expect(saved).toMatchObject({ web: false, db: null });

    const second = harness({ uptime: [{ status: 502, raw: "bad gateway" }], prev: saved });
    await expect(probe.run(second.deps)).resolves.toBe(1);
    expect(second.sent).toHaveLength(0);
  });

  it("database down behind a working web app: db_down", async () => {
    const h = harness({ uptime: [{ status: 503, body: DB_DOWN }], prev: { web: true, db: true } });
    await expect(probe.run(h.deps)).resolves.toBe(1);
    expect(h.sent.map((s) => s.text.split("\n")[0])).toEqual(["🔴 MONGOLZ өгөгдлийн сан хариу өгөхгүй байна"]);
  });

  it("ML down alone is not this probe's alarm and the job stays green", async () => {
    const h = harness({ uptime: [{ status: 503, body: ML_DOWN }], prev: { web: true, db: true } });
    await expect(probe.run(h.deps)).resolves.toBe(0);
    expect(h.sent).toHaveLength(0);
  });

  it("recovery is announced", async () => {
    const h = harness({ uptime: [{ status: 200, body: OK }], prev: { web: false, db: null } });
    await expect(probe.run(h.deps)).resolves.toBe(0);
    expect(h.sent[0].text).toContain("сэргэлээ");
  });

  it("a failed Telegram delivery keeps the old state (retried next run), fails the job and never logs the token", async () => {
    const h = harness({ uptime: [{ status: 503, body: DB_DOWN }], prev: { web: true, db: true }, telegramStatus: 500 });
    await expect(probe.run(h.deps)).resolves.toBe(1);
    expect(h.writes).toHaveLength(0);
    expect(h.logs.join("\n")).not.toContain(TOKEN);
    expect(h.logs.join("\n")).toContain("could not deliver db_down");
  });

  it("without Telegram secrets: warns, records the change, still fails while down", async () => {
    const h = harness({
      uptime: [{ status: 0, throws: new Error("timeout") }],
      prev: { web: true, db: true },
      env: { TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "" },
    });
    await expect(probe.run(h.deps)).resolves.toBe(1);
    expect(h.sent).toHaveLength(0);
    expect(h.logs.some((l) => l.startsWith("::warning::"))).toBe(true);
    expect(JSON.parse(h.writes[0])).toMatchObject({ web: false });
  });
});
