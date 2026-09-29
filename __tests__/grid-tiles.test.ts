/**
 * /grid wording rules: the idle label in supervisor backoff, when the privacy
 * legend shows, when tile badges collapse to icons, and the header's
 * "streaming" figure for viewers.
 */
import {
  COMPACT_BADGE_TILE_WIDTH,
  compactTileBadges,
  idleTileLabelKey,
  privacyLegendState,
  showsPrivacyBadge,
  streamingCountFor,
  type PrivacyTileState,
} from "@/lib/grid-tiles";

describe("idleTileLabelKey", () => {
  it("never says Idle / Waiting for a camera the supervisor is reconnecting", () => {
    expect(idleTileLabelKey({ failed: false, backoff: true, canControl: true })).toBeNull();
    expect(idleTileLabelKey({ failed: false, backoff: true, canControl: false })).toBeNull();
  });

  it("keeps the idle / waiting labels outside backoff", () => {
    expect(idleTileLabelKey({ failed: false, backoff: false, canControl: true })).toBe("grid_idle");
    expect(idleTileLabelKey({ failed: false, backoff: false, canControl: false })).toBe("grid_waiting_stream");
  });

  it("reports a failed stream first", () => {
    expect(idleTileLabelKey({ failed: true, backoff: true, canControl: true })).toBe("grid_stream_failed");
    expect(idleTileLabelKey({ failed: true, backoff: false, canControl: false })).toBe("grid_stream_failed");
  });
});

describe("privacy badge + legend", () => {
  const tile = (over: Partial<PrivacyTileState>): PrivacyTileState => ({
    privateMode: true,
    failClosed: false,
    attached: true,
    locked: false,
    ...over,
  });

  it("badges only private video the operator is watching", () => {
    expect(showsPrivacyBadge(tile({}))).toBe(true);
    expect(showsPrivacyBadge(tile({ privateMode: false }))).toBe(false);
    expect(showsPrivacyBadge(tile({ attached: false }))).toBe(false);
    expect(showsPrivacyBadge(tile({ locked: true }))).toBe(false);
  });

  it("hides the legend when every private tile is locked or not attached", () => {
    expect(
      privacyLegendState([tile({ locked: true }), tile({ attached: false }), tile({ privateMode: false })]),
    ).toEqual({ show: false, failClosed: false });
    expect(privacyLegendState([])).toEqual({ show: false, failClosed: false });
  });

  it("shows the legend when a badge is on screen", () => {
    expect(privacyLegendState([tile({}), tile({ privateMode: false })])).toEqual({ show: true, failClosed: false });
  });

  it("adds the fail-closed sentence only when a shown badge is fail-closed", () => {
    // The fail-closed camera is locked, so no fail-closed badge is visible.
    expect(privacyLegendState([tile({}), tile({ failClosed: true, locked: true })])).toEqual({
      show: true,
      failClosed: false,
    });
    expect(privacyLegendState([tile({ failClosed: true })])).toEqual({ show: true, failClosed: true });
  });
});

describe("compactTileBadges", () => {
  it("collapses on narrow and unmeasured tiles, never on a focused one", () => {
    expect(compactTileBadges(null, false)).toBe(true);
    expect(compactTileBadges({ width: 175 }, false)).toBe(true); // phone, two columns
    expect(compactTileBadges({ width: COMPACT_BADGE_TILE_WIDTH - 1 }, false)).toBe(true);
    expect(compactTileBadges({ width: COMPACT_BADGE_TILE_WIDTH }, false)).toBe(false);
    expect(compactTileBadges({ width: 495 }, false)).toBe(false); // 2×2 at 1280 px
    expect(compactTileBadges(null, true)).toBe(false);
    expect(compactTileBadges({ width: 175 }, true)).toBe(false);
  });
});

describe("streamingCountFor", () => {
  const active = ["a", "b", "c"];
  it("counts every running camera for an admin", () => {
    expect(streamingCountFor(true, active, {})).toBe(3);
  });

  it("counts only the running cameras a viewer may watch", () => {
    expect(streamingCountFor(false, active, { a: true, b: false })).toBe(1);
    expect(streamingCountFor(false, active, {})).toBe(0);
    expect(streamingCountFor(false, [], { a: true })).toBe(0);
  });
});
