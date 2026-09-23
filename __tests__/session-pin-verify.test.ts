/**
 * Session pin v3 (2026-09-23): the pin binds the browser, not the network.
 * Production logged 37 SESSION_PIN_REJECTED rows in 16 days, 35 of them from
 * an IPv4 /16 change — each one a forced re-login that also signed every
 * other device out. These cases run the real HMAC code against a mocked
 * request (headers + cookie jar).
 */
import { createHmac } from "node:crypto";
import { bindSessionPin, checkSessionPin, networkBucket } from "@/lib/auth/session-pin";

const USER = "11111111-2222-4333-8444-555555555555";
const SECRET = "test-session-pin-secret-0123456789abcdef";
const COOKIE = "mongolz-session-pin";

const mockReq = { ip: "203.0.113.7", ua: "Mozilla/5.0 (Macintosh) Chrome/140" };
const mockJar = new Map<string, string>();

jest.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": mockReq.ip, "user-agent": mockReq.ua }),
  cookies: async () => ({
    get: (name: string) => (mockJar.has(name) ? { name, value: mockJar.get(name)! } : undefined),
    set: (name: string, value: string) => void mockJar.set(name, value),
    delete: (name: string) => void mockJar.delete(name),
  }),
}));

function hmac(purpose: string, payload: string): string {
  return createHmac("sha256", SECRET).update(`${purpose}\0${payload}`).digest("hex");
}

/** A cookie exactly as the pre-2026-09-23 (v2, network-bound) code minted it. */
function legacyCookie(ip: string, ua: string, expiresAt = new Date(Date.now() + 86400_000).toISOString()): string {
  const fp = hmac("mongolz-session-pin-fp:v2", `${networkBucket(ip)}|${ua}`).slice(0, 32);
  const sig = hmac("mongolz-session-pin:v2", `${USER}|${fp}|${expiresAt}`);
  return [USER, fp, expiresAt, sig].join("|");
}

const savedSecret = process.env.SESSION_PIN_SECRET;
beforeAll(() => {
  process.env.SESSION_PIN_SECRET = SECRET;
});
afterAll(() => {
  if (savedSecret === undefined) delete process.env.SESSION_PIN_SECRET;
  else process.env.SESSION_PIN_SECRET = savedSecret;
});
beforeEach(() => {
  mockJar.clear();
  mockReq.ip = "203.0.113.7";
  mockReq.ua = "Mozilla/5.0 (Macintosh) Chrome/140";
});

describe("session pin v3 (browser-bound)", () => {
  it("survives a carrier change across /16 networks", async () => {
    await bindSessionPin(USER);
    expect(await checkSessionPin(USER)).toEqual({ ok: true });
    mockReq.ip = "198.51.100.23"; // different /16
    expect(await checkSessionPin(USER)).toEqual({ ok: true });
    mockReq.ip = "2001:db8:9::1"; // IPv6 on the same browser
    expect(await checkSessionPin(USER)).toEqual({ ok: true });
  });

  it("still rejects the cookie in another browser as a mismatch", async () => {
    await bindSessionPin(USER);
    mockReq.ua = "curl/8.7.1";
    expect(await checkSessionPin(USER)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects another user's pin and a forged fingerprint", async () => {
    await bindSessionPin(USER);
    expect(await checkSessionPin("99999999-2222-4333-8444-555555555555")).toEqual({ ok: false, reason: "mismatch" });
    const [u, fp, exp, sig] = mockJar.get(COOKIE)!.split("|");
    expect(fp!.startsWith("u3.")).toBe(true);
    // Dropping the v3 prefix to fall back to the legacy path breaks the signature.
    mockJar.set(COOKIE, [u, fp!.slice(3), exp, sig].join("|"));
    expect(await checkSessionPin(USER)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("reports an expired pin as expired", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const fp = `u3.${hmac("mongolz-session-pin-fp:v3", mockReq.ua).slice(0, 32)}`;
    const sig = hmac("mongolz-session-pin:v2", `${USER}|${fp}|${past}`);
    mockJar.set(COOKIE, [USER, fp, past, sig].join("|"));
    expect(await checkSessionPin(USER)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("legacy v2 pins during the transition", () => {
  it("are honoured on the network they were minted on", async () => {
    mockJar.set(COOKIE, legacyCookie(mockReq.ip, mockReq.ua));
    expect(await checkSessionPin(USER)).toEqual({ ok: true });
    mockReq.ip = "203.0.200.1"; // same /16
    expect(await checkSessionPin(USER)).toEqual({ ok: true });
  });

  it("are `stale` (benign), not `mismatch`, from another network", async () => {
    mockJar.set(COOKIE, legacyCookie(mockReq.ip, mockReq.ua));
    mockReq.ip = "198.51.100.23";
    expect(await checkSessionPin(USER)).toEqual({ ok: false, reason: "stale" });
  });
});
