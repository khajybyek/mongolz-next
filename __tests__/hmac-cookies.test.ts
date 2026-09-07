beforeAll(() => {
  process.env.REAUTH_COOKIE_SECRET = "reauth-test-secret";
});

import { hmacEqual, hmacSign, isExpired } from "@/lib/auth/hmac";
import { buildReauthCookieValue, verifyReauthCookieValue } from "@/lib/auth/step-up";

describe("domain-separated HMAC", () => {
  it("signatures differ per purpose for the same payload", () => {
    const a = hmacSign("k", "mongolz-pre-totp:v2", "user|1788697749");
    const b = hmacSign("k", "mongolz-reauth:v2", "user|1788697749");
    expect(a).not.toBe(b);
    expect(hmacEqual(a, a)).toBe(true);
    expect(hmacEqual(a, b)).toBe(false);
  });

  it("hmacEqual rejects malformed / empty input without throwing", () => {
    expect(hmacEqual("", "")).toBe(false);
    expect(hmacEqual("zz", "zz")).toBe(false);
  });

  it("isExpired treats unparsable values as expired", () => {
    expect(isExpired("4102444800")).toBe(true); // epoch seconds (other cookie format) are never accepted
    expect(isExpired("not-a-date")).toBe(true);
    expect(isExpired("")).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
    expect(isExpired(new Date(Date.now() - 60_000).toISOString())).toBe(true);
  });
});

describe("step-up cookie", () => {
  const userId = "11111111-2222-4333-8444-555555555555";

  it("round-trips and binds to the user", () => {
    const value = buildReauthCookieValue(userId, new Date(Date.now() + 15 * 60_000));
    expect(verifyReauthCookieValue(value, userId)).not.toBeNull();
    expect(verifyReauthCookieValue(value, "someone-else")).toBeNull();
  });

  it("rejects expired and tampered values", () => {
    const expired = buildReauthCookieValue(userId, new Date(Date.now() - 1000));
    expect(verifyReauthCookieValue(expired, userId)).toBeNull();
    const value = buildReauthCookieValue(userId, new Date(Date.now() + 60_000));
    const [uid, exp, sig] = value.split("|");
    // Flip the first hex digit to something else — replacing it with a
    // literal "0" is a no-op ~1/16 of the time (signatures that already
    // start with 0), which made this assertion flaky.
    const tampered = (sig![0] === "0" ? "1" : "0") + sig!.slice(1);
    expect(verifyReauthCookieValue([uid, exp, tampered].join("|"), userId)).toBeNull();
    expect(verifyReauthCookieValue([uid, new Date(Date.now() + 99_999_999).toISOString(), sig].join("|"), userId)).toBeNull();
  });

  it("cannot be forged from a pre-TOTP style payload (epoch expiry, other purpose)", () => {
    // Attacker re-encodes a pre-TOTP cookie (userId|epochSeconds|sig) as a reauth cookie.
    const epoch = String(Math.floor(Date.now() / 1000) + 120);
    const forgedSig = hmacSign(process.env.REAUTH_COOKIE_SECRET!, "mongolz-pre-totp:v2", `${userId}|${epoch}`, "hex");
    expect(verifyReauthCookieValue(`${userId}|${epoch}|${forgedSig}`, userId)).toBeNull();
    // Even with the right purpose, an epoch-seconds expiry is not "never expires".
    const rightPurposeSig = hmacSign(process.env.REAUTH_COOKIE_SECRET!, "mongolz-reauth:v2", `${userId}|1788697749`, "hex");
    expect(verifyReauthCookieValue(`${userId}|1788697749|${rightPurposeSig}`, userId)).toBeNull();
  });
});
