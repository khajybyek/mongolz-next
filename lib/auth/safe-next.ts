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
 */
const FALLBACK = "/dashboard";
const BASE = "https://mongolz.invalid";
// eslint-disable-next-line no-control-regex
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;

export function sanitizeNextPath(raw: string | null | undefined): string {
  if (!raw) return FALLBACK;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
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
  if (u.pathname === "/login" || u.pathname.startsWith("/auth/")) return FALLBACK;
  return `${u.pathname}${u.search}`;
}
