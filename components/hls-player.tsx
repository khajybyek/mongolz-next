"use client";

import { useEffect, useRef } from "react";
import type { StreamDenyCode } from "@/lib/live-access";
import { startHlsPlayback } from "@/lib/hls-playback";

interface HlsPlayerProps {
  src: string;
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
  /**
   * Issues a fresh stream ticket for the camera in `src` — pass the page's
   * `() => getStreamTicketAction(cameraId)`. Stream tickets live five
   * minutes; with this the player renews its ticket before it runs out and
   * every later playlist / segment request carries the newest one
   * (lib/stream-ticket-renewal.ts). Without it the stream is refused once
   * the first ticket expires.
   */
  renewTicket?: () => Promise<string>;
  /** Fired once the first frames are rendering. */
  onPlaying?: () => void;
  /**
   * Fired on a fatal playback / network error (after hls.js gave up). The HTTP
   * status is passed when the failure came from a response. `code` is set only
   * when the stream gateway refused the request (403 + camera_disabled |
   * camera_not_authorized | permission_check_failed): the player has already
   * stopped loading and renewing, and the tile should say why instead of
   * retrying. A 403 without a code (an expired stream ticket) is first
   * answered with one ticket renewal and one retry; it reaches this callback
   * as an ordinary failure only when that did not help.
   */
  onError?: (status?: number, code?: StreamDenyCode | null) => void;
}

export function HlsPlayer({
  src,
  className,
  autoPlay = true,
  muted = true,
  controls = true,
  renewTicket,
  onPlaying,
  onError,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Keep the latest callbacks in refs so the effect only re-runs on `src`
  // (pages pass inline arrows; a new function must not restart the stream).
  const playingRef = useRef(onPlaying);
  const errorRef = useRef(onError);
  const renewRef = useRef(renewTicket);
  playingRef.current = onPlaying;
  errorRef.current = onError;
  renewRef.current = renewTicket;
  const canRenew = Boolean(renewTicket);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    return startHlsPlayback({
      video,
      src,
      loadHls: async () => (await import("hls.js")).default,
      renewTicket: canRenew
        ? () => {
            const renew = renewRef.current;
            return renew ? renew() : Promise.reject(new Error("stream ticket renewal unavailable"));
          }
        : undefined,
      onPlaying: () => playingRef.current?.(),
      onError: (status, code) => errorRef.current?.(status, code),
    });
  }, [src, canRenew]);

  return (
    <video
      ref={videoRef}
      className={className}
      autoPlay={autoPlay}
      muted={muted}
      controls={controls}
      playsInline
    />
  );
}
