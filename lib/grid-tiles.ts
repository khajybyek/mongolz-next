/**
 * What a /grid tile and its page say, as pure functions (client-safe, no
 * imports beyond types) so the wording rules are unit-tested.
 */

import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Status line of a tile that shows no video and is not locked. `null` while
 * the ML supervisor is reconnecting the camera (backoff): the reconnect line
 * carries that state, and "Idle" would tell an admin that nobody captures a
 * camera the ML service is actively trying to reopen.
 */
export function idleTileLabelKey(opts: {
  failed: boolean;
  backoff: boolean;
  canControl: boolean;
}): TranslationKey | null {
  if (opts.failed) return "grid_stream_failed";
  if (opts.backoff) return null;
  return opts.canControl ? "grid_idle" : "grid_waiting_stream";
}

/**
 * Below this measured tile width (px) the top-right badges collapse to icons:
 * a labelled privacy badge ("Recognition paused", ~115 px) plus LIVE (~48 px)
 * would leave the camera name almost no room.
 */
export const COMPACT_BADGE_TILE_WIDTH = 320;

/**
 * Whether a tile shows its privacy badge as an icon only. A focused tile has
 * room; an unmeasured tile starts compact, so nothing covers the name before
 * the first measurement.
 */
export function compactTileBadges(tile: { width: number } | null, focused: boolean): boolean {
  if (focused) return false;
  if (!tile) return true;
  return tile.width < COMPACT_BADGE_TILE_WIDTH;
}

export type PrivacyTileState = {
  /** The capture is in private mode (ADR 0012). */
  privateMode: boolean;
  /** …because the ML service could not read the schedule (fail-closed). */
  failClosed: boolean;
  /** A player is attached to the tile. */
  attached: boolean;
  /** The tile is locked (no grant, or refused by the gateway). */
  locked: boolean;
};

/** A tile shows the privacy badge only over video this operator is watching. */
export function showsPrivacyBadge(tile: PrivacyTileState): boolean {
  return tile.privateMode && tile.attached && !tile.locked;
}

/**
 * The legend under the grid explains the badge, so it follows the badges on
 * screen: shown only when a tile on screen shows one, and with the
 * fail-closed sentence only when one of those badges is the fail-closed kind.
 * A private camera whose tile is locked or not attached shows no badge, so it
 * does not raise a legend that explains nothing visible.
 */
export function privacyLegendState(tiles: ReadonlyArray<PrivacyTileState>): { show: boolean; failClosed: boolean } {
  const badged = tiles.filter(showsPrivacyBadge);
  return { show: badged.length > 0, failClosed: badged.some((tile) => tile.failClosed) };
}

/**
 * The "N streaming" figure in the /grid header. Admins watch every running
 * camera; a viewer only the running cameras they hold a live grant for — the
 * streams the grid attaches and its toolbar counts — so the header and the
 * toolbar do not show two different numbers under the same word.
 */
export function streamingCountFor(
  canControl: boolean,
  activeIds: readonly string[],
  liveAllowed: Readonly<Record<string, boolean>>,
): number {
  if (canControl) return activeIds.length;
  return activeIds.filter((id) => liveAllowed[id] === true).length;
}
