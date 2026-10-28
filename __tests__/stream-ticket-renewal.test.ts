/**
 * lib/stream-ticket-renewal.ts — live players renew their five-minute stream
 * ticket before it expires instead of being refused after five minutes of
 * viewing (the 2026-09-28 bug: hls.js reused the first ticket forever).
 */
import {
  EXPIRED_BACKOFF_BASE_MS,
  RENEW_AFTER_MS,
  RENEW_RETRY_BASE_MS,
  RENEW_RETRY_MAX_MS,
  STREAM_TICKET_TTL_SEC,
  createTicketRenewer,
  initialRenewalDelayMs,
  readTicketExpiry,
  ticketFromUrl,
  withTicket,
} from "@/lib/stream-ticket-renewal";

const NOW = Date.UTC(2026, 8, 28, 3, 0, 0);
const BASE = "https://app.test";

/** Same shape as lib/stream-ticket.ts issues: base64url(user:cam:exp).sig */
function ticketExpiringAt(expMs: number, tag = "sig"): string {
  const payload = `user-1:cam-1:${Math.floor(expMs / 1000)}`;
  return `${Buffer.from(payload).toString("base64url")}.${tag}`;
}

const fresh = (tag = "sig") => ticketExpiringAt(Date.now() + STREAM_TICKET_TTL_SEC * 1000, tag);

/** A renew mock that hands out t2, t3, … */
function sequentialRenew() {
  let n = 1;
  return jest.fn(async () => {
    n += 1;
    return fresh(`t${n}`);
  });
}

const sigOf = (ticket: string) => ticket.slice(ticket.indexOf(".") + 1);

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ticket helpers", () => {
  it("reads the expiry of a ticket issued by the server", async () => {
    jest.useRealTimers();
    process.env.STREAM_TICKET_SECRET = "renewal-test-secret"; // pragma: allowlist secret
    const { issueStreamTicket } = await import("@/lib/stream-ticket");
    const before = Math.floor(Date.now() / 1000);
    const exp = readTicketExpiry(issueStreamTicket("user-1", "cam-1"));
    expect(exp).not.toBeNull();
    // The issuer and the renewal schedule share one TTL.
    expect(exp! - before).toBeGreaterThanOrEqual(STREAM_TICKET_TTL_SEC);
    expect(exp! - before).toBeLessThanOrEqual(STREAM_TICKET_TTL_SEC + 1);
  });

  it("returns null for anything that is not a ticket", () => {
    expect(readTicketExpiry("")).toBeNull();
    expect(readTicketExpiry("nodot")).toBeNull();
    expect(readTicketExpiry(".sig")).toBeNull();
    expect(readTicketExpiry(`${Buffer.from("no-colons").toString("base64url")}.sig`)).toBeNull();
    expect(readTicketExpiry(`${Buffer.from("a:b:soon").toString("base64url")}.sig`)).toBeNull();
  });

  it("reads and replaces ?ticket= on stream URLs", () => {
    const url = "/api/ml/stream/cam-1/index.m3u8?ticket=old";
    expect(ticketFromUrl(url, BASE)).toBe("old");
    expect(ticketFromUrl("/api/ml/stream/cam-1/index.m3u8", BASE)).toBeNull();
    expect(withTicket(url, "new", BASE)).toBe(`${BASE}/api/ml/stream/cam-1/index.m3u8?ticket=new`);
  });

  it("renews a fresh ticket after 65 % of its lifetime", () => {
    expect(RENEW_AFTER_MS).toBe(195_000);
    expect(initialRenewalDelayMs(fresh(), Date.now())).toBe(RENEW_AFTER_MS);
  });

  it("renews an old ticket sooner, an expired one at once", () => {
    // Four minutes old: 60 s left, less than the 105 s a fresh ticket keeps.
    expect(initialRenewalDelayMs(ticketExpiringAt(Date.now() + 60_000), Date.now())).toBe(0);
    // Two minutes old: 180 s left → renew in 75 s.
    expect(initialRenewalDelayMs(ticketExpiringAt(Date.now() + 180_000), Date.now())).toBe(75_000);
    expect(initialRenewalDelayMs(ticketExpiringAt(Date.now() - 60_000), Date.now())).toBe(0);
    // Unreadable ticket: assume it is fresh.
    expect(initialRenewalDelayMs("opaque", Date.now())).toBe(RENEW_AFTER_MS);
    // A client clock that runs behind never delays past the normal schedule.
    expect(initialRenewalDelayMs(ticketExpiringAt(Date.now() + 900_000), Date.now())).toBe(RENEW_AFTER_MS);
  });
});

describe("createTicketRenewer — scheduled renewal", () => {
  it("renews well before expiry and keeps doing so", async () => {
    const renew = sequentialRenew();
    const onRenewed = jest.fn();
    const r = createTicketRenewer({ ticket: fresh("t1"), renew, onRenewed });
    expect(r.startsExpired).toBe(false);

    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS - 1);
    expect(renew).not.toHaveBeenCalled();
    expect(sigOf(r.current())).toBe("t1");

    await jest.advanceTimersByTimeAsync(1);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(sigOf(r.current())).toBe("t2");
    expect(onRenewed).toHaveBeenLastCalledWith(r.current());

    // The next renewal is timed from receipt of t2 — well inside its 300 s.
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(sigOf(r.current())).toBe("t3");
    r.stop();
  });

  it("renews at once when mounted with an expired ticket, then on schedule (no loop on a skewed clock)", async () => {
    const renew = sequentialRenew();
    const r = createTicketRenewer({ ticket: ticketExpiringAt(Date.now() - 1_000, "old"), renew });
    expect(r.startsExpired).toBe(true);
    expect(renew).toHaveBeenCalledTimes(1);
    await r.settle();
    expect(sigOf(r.current())).toBe("t2");

    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS - 1);
    expect(renew).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(renew).toHaveBeenCalledTimes(2);
    r.stop();
  });

  it("retries a failed renewal with back-off while the ticket in hand is still valid", async () => {
    const renew = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(fresh("t2"));
    const r = createTicketRenewer({ ticket: fresh("t1"), renew });

    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(sigOf(r.current())).toBe("t1");

    await jest.advanceTimersByTimeAsync(RENEW_RETRY_BASE_MS - 1);
    expect(renew).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(renew).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(RENEW_RETRY_BASE_MS * 2);
    expect(renew).toHaveBeenCalledTimes(3);
    expect(sigOf(r.current())).toBe("t2");

    // Success resets the schedule to the normal cadence.
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS - 1);
    expect(renew).toHaveBeenCalledTimes(3);
    r.stop();
  });

  it("caps the retry interval", async () => {
    const renew = jest.fn<Promise<string>, []>().mockRejectedValue(new Error("down"));
    const r = createTicketRenewer({ ticket: fresh("t1"), renew });
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS); // 1st try
    await jest.advanceTimersByTimeAsync(10_000 + 20_000 + 40_000); // 2nd–4th
    expect(renew).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(RENEW_RETRY_MAX_MS - 1);
    expect(renew).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(1);
    expect(renew).toHaveBeenCalledTimes(5);
    r.stop();
  });

  it("treats an empty ticket as a failed renewal", async () => {
    const renew = jest.fn<Promise<string>, []>().mockResolvedValueOnce("").mockResolvedValueOnce(fresh("t2"));
    const r = createTicketRenewer({ ticket: fresh("t1"), renew });
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    expect(sigOf(r.current())).toBe("t1");
    await jest.advanceTimersByTimeAsync(RENEW_RETRY_BASE_MS);
    expect(sigOf(r.current())).toBe("t2");
    r.stop();
  });

  it("renews at once when the page comes back and a throttled timer is overdue", async () => {
    const renew = sequentialRenew();
    const r = createTicketRenewer({ ticket: fresh("t1"), renew });
    r.resume(); // not due yet
    expect(renew).not.toHaveBeenCalled();
    // A background tab can hold the timer back: the clock moves, the timer does not fire.
    jest.setSystemTime(Date.now() + RENEW_AFTER_MS + 30_000);
    r.resume();
    expect(renew).toHaveBeenCalledTimes(1);
    await r.settle();
    expect(sigOf(r.current())).toBe("t2");
    r.stop();
  });
});

describe("createTicketRenewer — 403 without a refusal code", () => {
  it("renews immediately once, then backs off until a load succeeds", async () => {
    const renew = sequentialRenew();
    const r = createTicketRenewer({ ticket: fresh("t1"), renew });

    await expect(r.expired()).resolves.toBe(true);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(sigOf(r.current())).toBe("t2");

    // The fresh ticket was refused as well: no second immediate renewal.
    await expect(r.expired()).resolves.toBe(false);
    expect(renew).toHaveBeenCalledTimes(1);

    // After the back-off window another attempt is allowed …
    await jest.advanceTimersByTimeAsync(EXPIRED_BACKOFF_BASE_MS);
    await expect(r.expired()).resolves.toBe(true);
    expect(renew).toHaveBeenCalledTimes(2);
    // … and the window doubles.
    await jest.advanceTimersByTimeAsync(EXPIRED_BACKOFF_BASE_MS);
    await expect(r.expired()).resolves.toBe(false);
    await jest.advanceTimersByTimeAsync(EXPIRED_BACKOFF_BASE_MS);
    await expect(r.expired()).resolves.toBe(true);
    expect(renew).toHaveBeenCalledTimes(3);

    // A successful load resets it: the next 403 gets an immediate renewal.
    r.healthy();
    await expect(r.expired()).resolves.toBe(true);
    expect(renew).toHaveBeenCalledTimes(4);
    r.stop();
  });

  it("joins a renewal that is already running instead of starting another", async () => {
    let release!: (t: string) => void;
    const renew = jest.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const r = createTicketRenewer({ ticket: fresh("t1"), renew });
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    expect(renew).toHaveBeenCalledTimes(1);

    const joined = r.expired();
    expect(renew).toHaveBeenCalledTimes(1);
    release(fresh("t2"));
    await expect(joined).resolves.toBe(true);
    expect(sigOf(r.current())).toBe("t2");
    r.stop();
  });

  it("answers false when the renewal fails", async () => {
    const renew = jest.fn<Promise<string>, []>().mockRejectedValue(new Error("session gone"));
    const r = createTicketRenewer({ ticket: fresh("t1"), renew });
    await expect(r.expired()).resolves.toBe(false);
    r.stop();
  });
});

describe("createTicketRenewer — stop", () => {
  it("clears the schedule", async () => {
    const renew = sequentialRenew();
    const r = createTicketRenewer({ ticket: fresh("t1"), renew });
    r.stop();
    expect(r.stopped).toBe(true);
    await jest.advanceTimersByTimeAsync(STREAM_TICKET_TTL_SEC * 1000 * 10);
    expect(renew).not.toHaveBeenCalled();
    await expect(r.expired()).resolves.toBe(false);
    r.resume();
    expect(renew).not.toHaveBeenCalled();
  });

  it("ignores a renewal that resolves after stop", async () => {
    let release!: (t: string) => void;
    const renew = jest.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const onRenewed = jest.fn();
    const r = createTicketRenewer({ ticket: fresh("t1"), renew, onRenewed });
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS);
    r.stop();
    release(fresh("t2"));
    await jest.advanceTimersByTimeAsync(0);
    expect(sigOf(r.current())).toBe("t1");
    expect(onRenewed).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(RENEW_AFTER_MS * 3);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("settle() gives up waiting after its limit", async () => {
    const renew = jest.fn(() => new Promise<string>(() => {}));
    const r = createTicketRenewer({ ticket: ticketExpiringAt(Date.now() - 1_000), renew });
    const done = jest.fn();
    void r.settle(5_000).then(done);
    await jest.advanceTimersByTimeAsync(4_999);
    expect(done).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
    r.stop();
  });
});
