"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Lock, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import {
  liveLockLayout,
  liveLockMessageKey,
  liveLockRetryable,
  liveLockShortKey,
  type LiveLock,
} from "@/lib/live-access";

/**
 * Measured size of a live tile (ResizeObserver), or null before the first
 * measurement. Feed it to liveLockLayout() to decide how much a tile body
 * may say without running under the tile's name chip and meta bar — the
 * lock overlay below and the idle / reconnecting body of a /grid tile both
 * use it.
 */
export function useTileSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } | null {
  const [tile, setTile] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (width: number, height: number) =>
      setTile((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    const rect = el.getBoundingClientRect();
    measure(rect.width, rect.height);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) measure(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return tile;
}

/**
 * Body of a live tile that shows no video to this operator (/grid, /wall):
 * no grant, or a gateway refusal that arrived while the page was open. No
 * player and no request — it says why.
 *
 * Tiles are always `bg-black`, so the colours are fixed light ones (like the
 * failed-stream overlay), never theme tokens that turn dark slate on black in
 * the light theme.
 *
 * It measures the tile and keeps the message in the band between the tile's
 * name chip and meta bar (lib/live-access.ts#liveLockLayout): the full
 * sentence where it fits, a one-line label in dense layouts, the bare lock on
 * phone-size tiles. The sentence is always present for screen readers. The
 * bare lock is centred on the tile, so a locked tile renders no Play button —
 * nothing covers the lock, and nothing offers a start that can only end in
 * the same refusal.
 *
 * It renders under the tile's click-to-focus layer, so tapping a small tile
 * focuses it (full sentence, and Retry for a failed permission check); only
 * the Retry button is raised above that layer.
 */
export function LiveLockOverlay({
  lock,
  focused,
  onRetry,
}: {
  lock: LiveLock;
  focused: boolean;
  onRetry?: () => void;
}) {
  const { t } = useT();
  const tileRef = useRef<HTMLDivElement>(null);
  const tile = useTileSize(tileRef);

  const message = t(liveLockMessageKey(lock));
  const retry = Boolean(onRetry) && liveLockRetryable(lock);
  const layout = liveLockLayout(tile, { focused, retry });

  return (
    <div ref={tileRef} className="absolute inset-0">
      {layout === "icon" ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Lock className="w-4 h-4 text-white/70" aria-hidden />
          <span className="sr-only">{message}</span>
        </div>
      ) : (
        // top-10 / bottom-14 = LIVE_TILE_OVERLAYS (name chip, meta bar).
        <div className="absolute inset-x-0 top-10 bottom-14 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
          {layout === "compact" ? (
            <span className="inline-flex max-w-full items-center gap-1.5 text-2xs text-white/80">
              <Lock className="w-3.5 h-3.5 shrink-0 text-white/60" aria-hidden />
              <span className="truncate" aria-hidden>
                {t(liveLockShortKey(lock))}
              </span>
              <span className="sr-only">{message}</span>
            </span>
          ) : (
            <>
              <Lock className="w-6 h-6 shrink-0 text-white/60" aria-hidden />
              <span className="max-w-md text-xs leading-4 text-white/80">{message}</span>
              {retry && (
                <button type="button" onClick={onRetry} className="btn-secondary btn-sm relative z-[4]">
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t("grid_retry")}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
