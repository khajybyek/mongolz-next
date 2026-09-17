/**
 * SCH Esports — display helpers shared by the public pages and the organiser
 * console. Pure functions, no I/O.
 */

const STEAM_RE = /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(id|profiles)\/([A-Za-z0-9_\-.]+)\/?(?:[?#].*)?$/i;

/**
 * Compact display form of a Steam profile URL:
 * `https://steamcommunity.com/id/handle/` → `steamcommunity.com/id/handle`.
 * Anything that is not a Steam profile URL (e.g. a Mobile Legends id) is
 * returned trimmed and unchanged, so callers can pass `in_game_id` for every game.
 */
export function maskSteam(url: string | null | undefined): string {
  const v = (url ?? "").trim();
  if (!v) return "";
  const m = STEAM_RE.exec(v);
  if (!m) return v;
  return `steamcommunity.com/${m[1].toLowerCase()}/${m[2]}`;
}

/** Steam profile URLs are the only in-game ids that are links. */
export function isSteamUrl(value: string | null | undefined): boolean {
  return STEAM_RE.test((value ?? "").trim());
}

const FACEBOOK_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "fb.com",
  "www.fb.com",
  "fb.me",
  "www.fb.me",
  "m.me",
]);
const HANDLE_RE = /^@?([A-Za-z0-9][A-Za-z0-9._-]{1,99})$/;

/**
 * Absolute `https://` link for whatever the player typed in the Facebook
 * field: a handle (`@zorig`, `zorig.b`), a bare `fb.com/…` / `facebook.com/…`
 * path, or a full URL. Returns null when the value cannot be turned into a
 * Facebook link (free text, other hosts, javascript: schemes…), so the caller
 * renders it as plain text instead of an anchor.
 */
export function facebookHref(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw || /\s/.test(raw)) return null;

  // Handles: no slash, no dot-separated host-like shape that we cannot map.
  const handle = HANDLE_RE.exec(raw);
  if (handle && !raw.includes("/")) {
    const h = handle[1];
    // "facebook.com" alone is not a profile.
    if (FACEBOOK_HOSTS.has(h.toLowerCase())) return null;
    return `https://www.facebook.com/${h}`;
  }

  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return null; // javascript:, mailto:, …
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!FACEBOOK_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const path = parsed.pathname.replace(/\/+$/, "");
  if (!path || path === "/") return null;
  const host = parsed.hostname.toLowerCase();
  const normalisedHost = host === "facebook.com" ? "www.facebook.com" : host;
  return `https://${normalisedHost}${path}${parsed.search}`;
}
