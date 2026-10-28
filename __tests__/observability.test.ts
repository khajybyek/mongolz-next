/** @jest-environment node */
/**
 * Observability wiring: does the thing that claims to report actually report,
 * and does the failure-rate monitor look at the window it is scheduled for?
 *
 * Two regressions are pinned here:
 *  1. The browser SDK was configured in `sentry.client.config.ts`, which only
 *     the webpack build injects — under Turbopack (Next 16's default) it was
 *     never loaded, so no browser event ever left the page while the crash
 *     screens said "reported automatically".
 *  2. The monitor compared a 5-minute window with the previous 55 minutes but
 *     ran once a day, examining 0.35 % of it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SENTRY_DATA_COLLECTION,
  browserErrorReportingDsn,
  errorReportingEnabled,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentrySpan,
  serverErrorReportingDsn,
  stripQuery,
} from "@/lib/error-reporting";
import {
  BASELINE_WINDOW_MIN,
  DEFAULT_THRESHOLD,
  MIN_RECENT_EVENTS,
  MONITOR_CRON,
  RECENT_WINDOW_MIN,
  cronIntervalMinutes,
  evaluateFailureRate,
  resolveThreshold,
} from "@/app/api/monitoring/error-rate/window";

const ROOT = join(__dirname, "..");

describe("error reporting enablement", () => {
  const realBrowser = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const realServer = process.env.SENTRY_DSN;

  afterEach(() => {
    if (realBrowser === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = realBrowser;
    if (realServer === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = realServer;
  });

  it("is off when no DSN is configured", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    expect(browserErrorReportingDsn()).toBeUndefined();
    expect(errorReportingEnabled()).toBe(false);
  });

  it("is off for a blank DSN — an empty env var is not configuration", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "   ";
    expect(errorReportingEnabled()).toBe(false);
  });

  it("is on, trimmed, when a DSN is present", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = " https://key@o1.ingest.sentry.io/2 ";
    expect(browserErrorReportingDsn()).toBe("https://key@o1.ingest.sentry.io/2");
    expect(errorReportingEnabled()).toBe(true);
  });

  it("prefers the server-only SENTRY_DSN on the server, falling back to the public one", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@o1.ingest.sentry.io/2";
    delete process.env.SENTRY_DSN;
    expect(serverErrorReportingDsn()).toBe("https://public@o1.ingest.sentry.io/2");

    process.env.SENTRY_DSN = "https://private@o1.ingest.sentry.io/3";
    expect(serverErrorReportingDsn()).toBe("https://private@o1.ingest.sentry.io/3");
  });
});

describe("event scrubbing", () => {
  it("drops cookies, auth headers and query strings from every event", () => {
    const event = scrubSentryEvent({
      request: {
        url: "https://aicctv.dev/api/cameras/abc/stream?ticket=SIGNED&x=1",
        headers: {
          Authorization: "Bearer secret",
          Cookie: "sb-access-token=secret",
          "X-ML-Token": "secret",
          "User-Agent": "Mozilla/5.0",
        },
        cookies: { "sb-access-token": "secret" },
        query_string: "ticket=SIGNED",
      },
    });

    expect(event.request?.url).toBe("https://aicctv.dev/api/cameras/abc/stream");
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.headers).toEqual({ "User-Agent": "Mozilla/5.0" });
    expect(JSON.stringify(event)).not.toContain("secret");
    expect(JSON.stringify(event)).not.toContain("SIGNED");
  });

  it("scrubs regardless of the route — not only /api/auth", () => {
    const event = scrubSentryEvent({
      request: { url: "https://aicctv.dev/playback/1", headers: { cookie: "s=1" } },
    });
    expect(event.request?.headers).toEqual({});
  });

  it("tolerates an event with no request context", () => {
    expect(scrubSentryEvent({})).toEqual({});
  });

  it("drops request bodies, the client IP and IP / geo headers", () => {
    // SDK v11 no longer has sendDefaultPii: these are collected unless
    // dataCollection says otherwise, so beforeSend is the second line.
    const event = scrubSentryEvent({
      user: { ip_address: "203.0.113.7" },
      request: {
        url: "https://aicctv.dev/api/auth/reauth",
        data: '{"password":"hunter2"}', // pragma: allowlist secret
        headers: {
          "X-Forwarded-For": "203.0.113.7",
          "x-real-ip": "203.0.113.7",
          "x-vercel-ip-city": "Seoul",
          "x-vercel-ip-latitude": "37.5",
          "User-Agent": "Mozilla/5.0",
        },
      },
    });

    expect(event.request?.data).toBeUndefined();
    expect(event.user).toEqual({});
    expect(event.request?.headers).toEqual({ "User-Agent": "Mozilla/5.0" });
    expect(JSON.stringify(event)).not.toContain("hunter2");
    expect(JSON.stringify(event)).not.toContain("203.0.113.7");
    expect(JSON.stringify(event)).not.toContain("Seoul");
  });

  it("strips query strings from fetch breadcrumbs", () => {
    const crumb = scrubSentryBreadcrumb({
      category: "fetch",
      data: { url: "/api/recordings/1/view?token=abc#frag" },
    });
    expect(crumb.data?.url).toBe("/api/recordings/1/view");
  });

  it("leaves a plain URL alone", () => {
    expect(stripQuery("/api/uptime")).toBe("/api/uptime");
  });
});

describe("span scrubbing", () => {
  it("strips the query from Next's http.target and the referer / location headers", () => {
    // dataCollection.urlQueryParams filters url.full / url.query only; Next
    // sets http.target to the raw req.url on every root span.
    const span = scrubSentrySpan({
      name: "GET /api/ml/stream/[cameraId]/[segment]",
      attributes: {
        "http.target": "/api/ml/stream/cam-1/index.m3u8?ticket=SIGNED_TICKET",
        "http.request.header.referer": ["https://aicctv.dev/audit?q=face-search#top"],
        "http.response.header.location": { value: "/login?next=%2Fplayback%2F1" },
        "http.route": "/api/ml/stream/[cameraId]/[segment]",
        "http.status_code": 200,
      },
    });

    expect(span.attributes).toEqual({
      "http.target": "/api/ml/stream/cam-1/index.m3u8",
      "http.request.header.referer": ["https://aicctv.dev/audit"],
      "http.response.header.location": { value: "/login" },
      "http.route": "/api/ml/stream/[cameraId]/[segment]",
      "http.status_code": 200,
    });
    expect(JSON.stringify(span)).not.toContain("SIGNED_TICKET");
  });

  it("returns the span it was given, with or without attributes", () => {
    // SDK v11 ignores null from beforeSendSpan: dropping is not an option.
    const bare: { name: string; attributes?: Record<string, unknown> } = { name: "x" };
    expect(scrubSentrySpan(bare)).toBe(bare);
    const plain = { attributes: { "http.target": "/api/uptime" } };
    expect(scrubSentrySpan(plain)).toBe(plain);
    expect(plain.attributes["http.target"]).toBe("/api/uptime");
  });
});

describe("instrumentation-client.ts", () => {
  const realDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  afterEach(() => {
    if (realDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = realDsn;
    jest.resetModules();
  });

  function loadClient() {
    const init = jest.fn();
    const captureRouterTransitionStart = jest.fn();
    jest.doMock("@sentry/nextjs", () => ({
      init,
      captureRouterTransitionStart,
      browserTracingIntegration: () => ({ name: "BrowserTracing" }),
    }));

    let mod: { onRouterTransitionStart?: unknown } = {};
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require("@/instrumentation-client");
    });
    return { init, mod };
  }

  it("stays completely silent when no DSN is configured", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const { init, mod } = loadClient();
    expect(init).not.toHaveBeenCalled();
    // The navigation hook is still exported (a no-op while uninitialised) so
    // @sentry/nextjs does not warn about a missing hook.
    expect(mod.onRouterTransitionStart).toBeDefined();
  });

  it("initialises with scrubbing, no PII and a sampled trace rate", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@o1.ingest.sentry.io/2";
    const { init } = loadClient();

    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0][0] as {
      dsn: string;
      dataCollection: unknown;
      sendDefaultPii?: unknown;
      tracesSampleRate: number;
      integrations: unknown[];
      beforeSend: (e: unknown) => { request?: { cookies?: unknown } };
      beforeBreadcrumb: (b: unknown) => { data?: { url?: string } };
    };

    expect(options.dsn).toBe("https://key@o1.ingest.sentry.io/2");
    expect(options.dataCollection).toEqual(SENTRY_DATA_COLLECTION);
    // Ignored by SDK v11: its presence would only suggest a protection that
    // is not there.
    expect(options).not.toHaveProperty("sendDefaultPii");
    expect(options.tracesSampleRate).toBeGreaterThan(0);
    expect(options.tracesSampleRate).toBeLessThanOrEqual(0.2);
    // Session Replay would record a console showing face crops — not enabled.
    expect(JSON.stringify(options.integrations)).not.toContain("Replay");

    expect(options.beforeSend({ request: { cookies: { a: "b" } } }).request?.cookies).toBeUndefined();
    expect(options.beforeBreadcrumb({ data: { url: "/x?t=1" } }).data?.url).toBe("/x");
  });

  it("no longer ships sentry.client.config.ts, which Turbopack ignores", () => {
    expect(() => readFileSync(join(ROOT, "sentry.client.config.ts"))).toThrow();
  });
});

describe("sentry.server.config.ts / sentry.edge.config.ts", () => {
  const realDsn = process.env.SENTRY_DSN;

  afterEach(() => {
    if (realDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = realDsn;
    jest.resetModules();
  });

  it.each(["@/sentry.server.config", "@/sentry.edge.config"])("%s initialises with the shared no-PII collection and span scrubbing", (path) => {
    process.env.SENTRY_DSN = "https://key@o1.ingest.sentry.io/3";
    const init = jest.fn();
    jest.doMock("@sentry/nextjs", () => ({ init }));
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(path);
    });

    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0][0] as {
      dataCollection: unknown;
      attachStacktrace: unknown;
      beforeSend: (e: unknown) => { request?: { data?: unknown } };
      beforeSendSpan: (s: { attributes: Record<string, unknown> }) => { attributes: Record<string, unknown> };
    };
    expect(options.dataCollection).toEqual(SENTRY_DATA_COLLECTION);
    expect(options).not.toHaveProperty("sendDefaultPii");
    expect(options.attachStacktrace).toBe(false);
    expect(options.beforeSend({ request: { data: "x" } }).request?.data).toBeUndefined();
    // A sampled stream request must not ship its ?ticket= in http.target.
    const span = options.beforeSendSpan({
      attributes: { "http.target": "/api/ml/stream/cam-1/index.m3u8?ticket=SIGNED_TICKET" },
    });
    expect(span.attributes["http.target"]).toBe("/api/ml/stream/cam-1/index.m3u8");
  });
});

describe("SENTRY_DATA_COLLECTION", () => {
  it("collects no identity, cookies, bodies, query strings or payloads", () => {
    expect(SENTRY_DATA_COLLECTION).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
      stackFrameVariables: false,
    });
  });

  it("denies the IP / geo headers in both directions", () => {
    for (const direction of ["request", "response"] as const) {
      const deny = SENTRY_DATA_COLLECTION.httpHeaders[direction].deny;
      for (const header of ["x-forwarded-for", "x-real-ip", "x-vercel-ip-country", "remote-addr", "via"]) {
        expect(deny.some((fragment) => header.includes(fragment))).toBe(true);
      }
    }
  });
});

describe("failure-rate monitor window", () => {
  it("matches the vercel.json cron cadence", () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const cron = vercel.crons.find((c) => c.path === "/api/monitoring/error-rate");
    expect(cron).toBeDefined();
    expect(cron?.schedule).toBe(MONITOR_CRON);
    // The whole point: the window the route inspects IS the interval between
    // runs, so no minute of the day goes unexamined.
    expect(cronIntervalMinutes(cron!.schedule)).toBe(RECENT_WINDOW_MIN);
  });

  it("compares against a baseline several times longer than the window", () => {
    // Today: 60 min against the other 23 hours of the rolling day. The
    // invariant that must survive a schedule change is that the baseline is
    // long enough to mean something — a like-for-like comparison would just
    // alarm on ordinary variance.
    expect(BASELINE_WINDOW_MIN).toBeGreaterThanOrEqual(4 * RECENT_WINDOW_MIN);
  });

  it("reads the cron shapes this repo uses", () => {
    expect(cronIntervalMinutes("0 * * * *")).toBe(60);
    expect(cronIntervalMinutes("0 2 * * *")).toBe(24 * 60);
    expect(cronIntervalMinutes("30 1 * * *")).toBe(24 * 60);
    expect(cronIntervalMinutes("0 5 * * 1")).toBe(7 * 24 * 60);
    expect(cronIntervalMinutes("*/5 * * * *")).toBe(5);
    expect(cronIntervalMinutes("0 0 1 * *")).toBeNull();
    expect(cronIntervalMinutes("nonsense")).toBeNull();
  });
});

describe("resolveThreshold", () => {
  it("accepts a positive number", () => {
    expect(resolveThreshold("0.25")).toBe(0.25);
  });

  it("falls back to the default rather than becoming NaN and never alarming", () => {
    expect(resolveThreshold("not-a-number")).toBe(DEFAULT_THRESHOLD);
    expect(resolveThreshold("")).toBe(DEFAULT_THRESHOLD);
    expect(resolveThreshold("-1")).toBe(DEFAULT_THRESHOLD);
    expect(resolveThreshold(undefined)).toBe(DEFAULT_THRESHOLD);
  });
});

describe("evaluateFailureRate", () => {
  it("does not alarm on ordinary background noise", () => {
    const v = evaluateFailureRate({ recentCount: 2, baselineCount: 40 });
    expect(v.alarm).toBe(false);
    expect(v.baselineEmpty).toBe(false);
  });

  it("alarms when the recent rate outruns the baseline", () => {
    // 40 failures in the hour vs 46 across the previous 23 hours.
    const v = evaluateFailureRate({ recentCount: 40, baselineCount: 46 });
    expect(v.spikeRatio).toBeGreaterThan(1.1);
    expect(v.alarm).toBe(true);
  });

  it("holds fire below the absolute floor even on a large ratio", () => {
    const v = evaluateFailureRate({ recentCount: MIN_RECENT_EVENTS - 1, baselineCount: 1 });
    expect(v.spikeRatio).toBeGreaterThan(1.1);
    expect(v.alarm).toBe(false);
  });

  it("reports no ratio (not Infinity) when the baseline is empty", () => {
    const quiet = evaluateFailureRate({ recentCount: 4, baselineCount: 0 });
    expect(quiet.spikeRatio).toBeNull();
    expect(quiet.baselineEmpty).toBe(true);
    expect(quiet.alarm).toBe(false);

    // 12 failures in an hour on a system that had none all day.
    const burst = evaluateFailureRate({ recentCount: 12, baselineCount: 0 });
    expect(burst.spikeRatio).toBeNull();
    expect(burst.alarm).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * The monitor over HTTP: auth, the honest-failure path, and the alarm.
 * ------------------------------------------------------------------ */

type CountResult = { count: number | null; error: unknown };

const monitorState: { authorized: boolean; results: CountResult[]; inserts: unknown[] } = {
  authorized: true,
  results: [],
  inserts: [],
};

function monitorBuilder() {
  const result = monitorState.results.shift() ?? { count: 0, error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "in", "gte", "lt"]) chain[method] = () => chain;
  chain.insert = async (row: unknown) => {
    monitorState.inserts.push(row);
    return { error: null };
  };
  chain.then = (resolve: (v: CountResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

jest.mock("@/lib/auth/cron", () => ({ authorizeCron: () => monitorState.authorized }));
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ from: () => monitorBuilder() }),
}));

describe("GET /api/monitoring/error-rate", () => {
  const realThreshold = process.env.SENTRY_ERROR_RATE_THRESHOLD;
  const realSlack = process.env.SLACK_ALERT_WEBHOOK;

  function call() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NextRequest } = require("next/server") as typeof import("next/server");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GET } = require("@/app/api/monitoring/error-rate/route") as {
      GET: (req: InstanceType<typeof NextRequest>) => Promise<Response>;
    };
    return GET(new NextRequest("http://localhost/api/monitoring/error-rate"));
  }

  beforeEach(() => {
    monitorState.authorized = true;
    monitorState.results = [];
    monitorState.inserts = [];
    delete process.env.SENTRY_ERROR_RATE_THRESHOLD;
    delete process.env.SLACK_ALERT_WEBHOOK;
  });

  afterAll(() => {
    if (realThreshold === undefined) delete process.env.SENTRY_ERROR_RATE_THRESHOLD;
    else process.env.SENTRY_ERROR_RATE_THRESHOLD = realThreshold;
    if (realSlack === undefined) delete process.env.SLACK_ALERT_WEBHOOK;
    else process.env.SLACK_ALERT_WEBHOOK = realSlack;
  });

  it("refuses an unauthorised caller", async () => {
    monitorState.authorized = false;
    expect((await call()).status).toBe(401);
  });

  it("reports the window it actually inspected", async () => {
    monitorState.results = [
      { count: 1, error: null },
      { count: 30, error: null },
    ];
    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      cron: string;
      window: { recent_min: number; baseline_min: number };
    };
    expect(body.status).toBe("ok");
    expect(body.cron).toBe(MONITOR_CRON);
    expect(body.window).toEqual({ recent_min: RECENT_WINDOW_MIN, baseline_min: BASELINE_WINDOW_MIN });
  });

  it("answers 500 when a count query fails — a failed query is not zero failures", async () => {
    const warn = jest.spyOn(console, "error").mockImplementation(() => {});
    monitorState.results = [
      { count: null, error: { code: "57014", message: "statement timeout on audit_log" } },
      { count: 5, error: null },
    ];

    const res = await call();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { status: string; detail: string };
    expect(body.status).toBe("error");
    // Generic detail: the upstream message never reaches the response body.
    expect(JSON.stringify(body)).not.toContain("statement timeout");
    expect(monitorState.inserts).toHaveLength(0);
    warn.mockRestore();
  });

  it("alarms on a spike and records it in the audit log", async () => {
    monitorState.results = [
      { count: 40, error: null }, // this hour
      { count: 46, error: null }, // the previous 23 hours
    ];

    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; spike_ratio: number | null };
    expect(body.status).toBe("warn");
    expect(body.spike_ratio).toBeGreaterThan(1);
    expect(monitorState.inserts).toHaveLength(1);
    expect(monitorState.inserts[0]).toMatchObject({ action: "MONITOR_ALARM" });
  });
});

describe("robots.txt", () => {
  it("keeps the blanket disallow and reads professionally", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GET } = require("@/app/robots.txt/route") as { GET: () => Response };
    const body = await GET().text();

    expect(body).toMatch(/User-Agent:\s*\*/i);
    expect(body).toMatch(/Disallow:\s*\//);
    expect(body).toContain("security.txt");
    expect(body).not.toMatch(/\$\$|\bass\b/i);
  });
});
