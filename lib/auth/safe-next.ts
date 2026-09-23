/**
 * Post-login redirect target sanitiser — one implementation for every flow
 * (password, TOTP, passkey, auth callback).
 *
 * Returns a same-origin path (`/path?query`) or "/dashboard". Anything that
 * could escape the origin is rejected: absolute URLs, protocol-relative
 * `//host`, backslash tricks, and ASCII control characters (the WHATWG URL
 * parser strips tab/CR/LF, so a tab-prefixed `//evil.com` would otherwise
 * resolve off-origin). The value is re-serialised from a parsed URL — never
 * the raw input — so the output is canonical.
 *
 * The raw-input `//` check alone is not enough: dot segments collapse during
 * parsing ("/.//evil", "/%2e//evil", "/a/..//evil" all become "//evil"), and
 * callers sanitise the same value more than once (the login page, then the
 * server action), each pass decoding one more level ("/.%252F%252Fevil"). So
 * the parsed result is re-checked, and the function only returns values that
 * are fixed points — sanitising the output again yields the same string — so
 * no later decode can turn it into an off-origin target.
 */
const FALLBACK = "/dashboard";
const BASE = "https://mongolz.invalid";
// eslint-disable-next-line no-control-regex
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;

export function sanitizeNextPath(raw: string | null | undefined): string {
  const once = sanitizeOnce(raw);
  if (once === FALLBACK) return FALLBACK;
  // Idempotence: a value that changes when sanitised again still carries an
  // encoded layer a downstream decode would unwrap — refuse it.
  if (sanitizeOnce(once) !== once) return FALLBACK;
  return once;
}

function sanitizeOnce(raw: string | null | undefined): string {
  if (!raw) return FALLBACK;
  // Only the PATH is decoded for the safety checks. The query is kept as
  // the caller passed it: the middleware carries `path + search` in
  // `next=`, which URLSearchParams already decoded once, so decoding it
  // again turned an encoded %, &, # or + in a filter value into a lone "%"
  // (URIError → fallback), a parameter separator, a dropped fragment or a
  // space. A query can never move the origin, so it needs no decoding.
  const q = raw.indexOf("?");
  const rawPath = q === -1 ? raw : raw.slice(0, q);
  const rawQuery = q === -1 ? "" : raw.slice(q);
  if (CONTROL_OR_BACKSLASH.test(rawQuery)) return FALLBACK;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return FALLBACK;
  }
  if (CONTROL_OR_BACKSLASH.test(decoded)) return FALLBACK;
  if (!decoded.startsWith("/") || decoded.startsWith("//")) return FALLBACK;
  let u: URL;
  try {
    u = new URL(decoded, BASE);
  } catch {
    return FALLBACK;
  }
  if (u.origin !== BASE || u.username || u.password) return FALLBACK;
  // Dot-segment collapse can produce a protocol-relative "//host" here even
  // though the raw input did not start with "//".
  if (u.pathname.startsWith("//") || CONTROL_OR_BACKSLASH.test(u.pathname)) return FALLBACK;
  if (u.pathname === "/login" || u.pathname.startsWith("/auth/")) return FALLBACK;
  // A fully encoded value ("%2Faudit%3Fq%3Dx") carries its query inside the
  // decoded path; otherwise re-serialise the raw query (drops any #fragment).
  let search = u.search;
  if (rawQuery) {
    try {
      search = new URL(`/${rawQuery}`, BASE).search;
    } catch {
      return FALLBACK;
    }
  }
  return `${u.pathname}${search}`;
}
