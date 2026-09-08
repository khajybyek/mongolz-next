"use client";

import { useEffect, useRef } from "react";

interface HlsPlayerProps {
  src: string;
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
  /** Fired once the first frames are rendering. */
  onPlaying?: () => void;
  /**
   * Fired on a fatal playback / network error (after hls.js gave up). The HTTP
   * status is passed when the failure came from a response, so a tile can tell
   * "no access to this camera" (403) apart from "the stream is not running".
   */
  onError?: (status?: number) => void;
}

export function HlsPlayer({
  src,
  className,
  autoPlay = true,
  muted = true,
  controls = true,
  onPlaying,
  onError,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Keep the latest callbacks in refs so the effect only re-runs on `src`.
  const playingRef = useRef(onPlaying);
  const errorRef = useRef(onError);
  playingRef.current = onPlaying;
  errorRef.current = onError;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: import("hls.js").default | undefined;
    // The hls.js import is async; if `src` changes or the component unmounts
    // before it resolves, the instance created afterwards would leak (keep
    // polling segments forever). Guard with a cancelled flag.
    let cancelled = false;

    const srcUrl = new URL(src, window.location.origin);
    const ticket = srcUrl.searchParams.get("ticket");

    const handlePlaying = () => playingRef.current?.();
    const handleNativeError = () => errorRef.current?.();
    video.addEventListener("playing", handlePlaying);

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.addEventListener("error", handleNativeError);
      video.src = src;
      return () => {
        video.removeEventListener("playing", handlePlaying);
        video.removeEventListener("error", handleNativeError);
      };
    }

    (async () => {
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;
      if (!Hls.isSupported()) {
        video.addEventListener("error", handleNativeError);
        video.src = src;
        return;
      }
      hls = new Hls({
        lowLatencyMode: true,
        liveSyncDuration: 2,
        xhrSetup: ticket
          ? (xhr, url) => {
              const u = new URL(url, window.location.origin);
              u.searchParams.set("ticket", ticket);
              xhr.open("GET", u.toString(), true);
            }
          : undefined,
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        // One recovery attempt for transient network / media glitches, then
        // surface the failure so the tile can show a retry control.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details !== Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
          hls?.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
          return;
        }
        // hls.js attaches the failing response on load errors; a 403 from the
        // stream route means the camera is disabled or not granted, which the
        // tile should say instead of offering a Retry that can never work.
        const status =
          typeof data.response === "object" && data.response
            ? (data.response as { code?: number }).code
            : undefined;
        errorRef.current?.(status);
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    })();

    return () => {
      cancelled = true;
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("error", handleNativeError);
      hls?.destroy();
      hls = undefined;
    };
  }, [src]);

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
