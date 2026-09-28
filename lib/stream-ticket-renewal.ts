/**
 * Keeps a live player's stream ticket fresh.
 *
 * A stream ticket (lib/stream-ticket.ts) is an HMAC over
 * `userId:cameraId:exp` that lives STREAM_TICKET_TTL_SEC. hls.js sends it with
 * every playlist reload and every segment, so a player that kept the ticket
 * it was mounted with was turned away after five minutes of continuous
 * viewing: the gateway answered 403 "invalid or expired stream ticket" (no
 * refusal code), /grid showed "Stream failed" and /wall + /live froze.
 *
 * The TTL stays short. Instead the player asks the page's ticket action for a
 * new ticket after RENEW_AT_FRACTION of the lifetime has passed, and every
 * later request carries the newest one. Every renewal goes through the same
 * server action as the first ticket (same session / role checks), and the
 * gateway still re-checks the camera and the grant on every request — a
 * renewed ticket is never an authorization by itself.
 *
 *   • Scheduled renewal: 195 s after a ticket arrives (65 % of 300 s). A failed
 *     attempt is retried after 10 s, 20 s, 40 s, then every 60 s, so three
 *     tries fit before the ticket in hand runs out.
 *   • A 403 without a refusal code (the ticket expired anyway — a throttled
 *     background tab, a remounted tile holding an old URL) gets one immediate
 *     renewal. Another one is refused for 5 s, then 10 s, 20 s … up to 60 s,
 *     until a load succeeds again (`healthy()`), so a ticket the gateway keeps
 *     rejecting cannot turn into a renewal loop.
 *   • Refusal codes (camera_disabled, camera_not_authorized,
 *     permission_check_failed) are terminal. The player never asks the
 *     renewer about those; it stops it.
 *
 * Client-safe: no Node APIs. The server-side issuer imports the TTL from here
 * so the schedule and the ticket lifetime cannot drift apart.
 */

/** Lifetime of a stream ticket, in seconds. */
export const STREAM_TICKET_TTL_SEC = 300;

/** Renew once this share of a ticket's lifetime has passed. */
export const RENEW_AT_FRACTION = 0.65;

const TTL_MS = STREAM_TICKET_TTL_SEC * 1000;

/** Delay between receiving a ticket and renewing it (195 s). */
export const RENEW_AFTER_MS = Math.round(TTL_MS * RENEW_AT_FRACTION);

/** Retry schedule for a failed scheduled renewal: 10 s, 20 s, 40 s, 60 s … */
export const RENEW_RETRY_BASE_MS = 10_000;
export const RENEW_RETRY_MAX_MS = 60_000;

/** Back-off between renewals forced by 403s: immediate, then 5 s, 10 s … 60 s. */
export const EXPIRED_BACKOFF_BASE_MS = 5_000;
export const EXPIRED_BACKOFF_MAX_MS = 60_000;

/** A ticket this close to its expiry is treated as already expired on mount. */
export const EXPIRY_MARGIN_MS = 2_000;

/** Longest a player waits for a renewal before loading with what it has. */
export const SETTLE_MAX_MS = 5_000;

function backoff(base: number, max: number, attempt: number): number {
  return Math.min(base * 2 ** Math.max(0, attempt - 1), max);
}

/**
 * Expiry (unix seconds) read from a ticket's payload, or null when the ticket
 * is not in the `base64url(userId:cameraId:exp).signature` shape. The payload
 * is not secret from the viewer holding it; this is only a scheduling hint —
 * the client clock may be off, and the signature is checked by the server.
 */
export function readTicketExpiry(ticket: string): number | null {
  const dot = ticket.indexOf(".");
  if (dot <= 0) return null;
  try {
    const b64 = ticket.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
    const payload = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const colon = payload.lastIndexOf(":");
    if (colon < 0) return null;
    const exp = Number(payload.slice(colon + 1));
    return Number.isFinite(exp) && exp > 0 ? exp : null;
  } catch {
    return null;
  }
}

/** `?ticket=` of a stream URL, or null. */
export function ticketFromUrl(url: string, base: string): string | null {
  try {
    return new URL(url, base).searchParams.get("ticket");
  } catch {
    return null;
  }
}

/** The same URL carrying `ticket` instead of whatever ticket it had. */
export function withTicket(url: string, ticket: string, base: string): string {
  const u = new URL(url, base);
  u.searchParams.set("ticket", ticket);
  return u.toString();
}

/**
 * When to renew the ticket a player was mounted with. A page keeps the URL it
 * attached with, so a tile that remounts (focus, paging) may start with a
 * ticket that is minutes old: renew when as much life is left as a fresh
 * ticket would have at its scheduled renewal, never later than a fresh ticket
 * would be renewed. A clock that runs ahead only makes this earlier — and
 * only for this first renewal: later ones are timed from receipt, so a skewed
 * clock cannot cause a renewal loop.
 */
export function initialRenewalDelayMs(ticket: string, nowMs: number): number {
  const exp = readTicketExpiry(ticket);
  if (exp === null) return RENEW_AFTER_MS;
  const remaining = exp * 1000 - nowMs;
  return Math.min(RENEW_AFTER_MS, Math.max(0, remaining - (TTL_MS - RENEW_AFTER_MS)));
}

export interface TicketRenewerOptions {
  /** Ticket the player was mounted with. */
  ticket: string;
  /** Issues a fresh ticket (the page's getStreamTicketAction); throws on failure. */
  renew: () => Promise<string>;
  /** Called with every new ticket (native HLS swaps its source here). */
  onRenewed?: (ticket: string) => void;
}

export interface TicketRenewer {
  /** The newest ticket; every request made from now on should carry it. */
  current(): string;
  /**
   * The gateway answered 403 without a refusal code. Resolves true when a
   * fresh ticket is in hand (the caller retries once), false when renewing
   * again is pointless or backed off (the caller reports the failure).
   */
  expired(): Promise<boolean>;
  /** A playlist or segment loaded: a later 403 gets an immediate renewal again. */
  healthy(): void;
  /** The page became visible again: renew now if a throttled timer is overdue. */
  resume(): void;
  /** Resolves once no renewal is running (at most `maxMs`). */
  settle(maxMs?: number): Promise<void>;
  /** Stop for good: no timers, and a renewal still in flight is ignored. */
  stop(): void;
  readonly stopped: boolean;
  /** The mounted ticket had (practically) expired; a renewal is already running. */
  readonly startsExpired: boolean;
}

export function createTicketRenewer({ ticket, renew, onRenewed }: TicketRenewerOptions): TicketRenewer {
  let current = ticket;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dueAt = 0;
  let inflight: Promise<boolean> | null = null;
  let failures = 0;
  let expiredStreak = 0;
  let expiredAt = 0;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(delay: number) {
    if (stopped) return;
    clearTimer();
    dueAt = Date.now() + delay;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  }

  async function attempt(): Promise<boolean> {
    try {
      const next = await renew();
      if (stopped) return false;
      if (typeof next !== "string" || next.length === 0) throw new Error("empty stream ticket");
      current = next;
      failures = 0;
      schedule(RENEW_AFTER_MS);
    } catch {
      if (stopped) return false;
      failures += 1;
      schedule(backoff(RENEW_RETRY_BASE_MS, RENEW_RETRY_MAX_MS, failures));
      return false;
    }
    try {
      onRenewed?.(current);
    } catch {
      /* the ticket is renewed either way */
    }
    return true;
  }

  function run(): Promise<boolean> {
    if (stopped) return Promise.resolve(false);
    if (inflight) return inflight;
    clearTimer();
    const p = attempt();
    inflight = p;
    void p.finally(() => {
      if (inflight === p) inflight = null;
    });
    return p;
  }

  const exp = readTicketExpiry(ticket);
  const startsExpired = exp !== null && exp * 1000 - Date.now() <= EXPIRY_MARGIN_MS;
  const firstDelay = initialRenewalDelayMs(ticket, Date.now());
  if (firstDelay === 0) void run();
  else schedule(firstDelay);

  return {
    current: () => current,
    expired() {
      if (stopped) return Promise.resolve(false);
      if (!inflight && expiredStreak > 0) {
        const wait = backoff(EXPIRED_BACKOFF_BASE_MS, EXPIRED_BACKOFF_MAX_MS, expiredStreak);
        if (Date.now() - expiredAt < wait) return Promise.resolve(false);
      }
      expiredStreak += 1;
      expiredAt = Date.now();
      return run();
    },
    healthy() {
      expiredStreak = 0;
    },
    resume() {
      if (!stopped && !inflight && timer !== null && Date.now() >= dueAt) void run();
    },
    settle(maxMs = SETTLE_MAX_MS) {
      const p = inflight;
      if (!p) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const t = setTimeout(resolve, maxMs);
        void p.finally(() => {
          clearTimeout(t);
          resolve();
        });
      });
    },
    stop() {
      stopped = true;
      clearTimer();
    },
    get stopped() {
      return stopped;
    },
    startsExpired,
  };
}
