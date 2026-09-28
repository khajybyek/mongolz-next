"use client";

import { useEffect, useRef } from "react";
import { probeStreamFailure, readStreamDenyCode, type StreamDenyCode } from "@/lib/live-access";

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
   * status is passed when the failure came from a response. `code` is set only
   * when the stream gateway refused the request (403 + camera_disabled |
   * camera_not_authorized | permission_check_failed): the player has already
   * stopped loading, and the tile should say why instead of retrying. A 403
   * without a code (e.g. an expired stream ticket) is an ordinary failure.
   */
  onError?: (status?: number, code?: StreamDenyCode | null) => void;
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
    // Native HLS (Safari / iOS) reports no HTTP status, so ask the gateway
    // once why the playlist failed — that is what turns a refusal into a
    // readable reason instead of a generic error.
    const handleNativeError = () => {
      void probeStreamFailure(src).then((failure) => {
        if (!cancelled) errorRef.current?.(failure.status, failure.code);
      });
    };
    video.addEventListener("playing", handlePlaying);

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.addEventListener("error", handleNativeError);
      video.src = src;
      return () => {
        cancelled = true;
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
        // hls.js attaches the failing response on load errors.
        const status =
          typeof data.response === "object" && data.response
            ? (data.response as { code?: number }).code
            : undefined;
        // A 403 is never fixed by reloading with the same ticket. It used to
        // fall into the startLoad() branch below for playlist reloads and
        // segments, so a grant revoked mid-stream (or a camera disabled
        // meanwhile) left the player re-requesting forever behind a frozen
        // frame. Stop loading and report — with the gateway's refusal code
        // when there is one, so the tile can say why.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && status === 403) {
          hls?.stopLoad();
          void (async () => {
            let code = readStreamDenyCode(data.networkDetails);
            if (!code) {
              const probe = await probeStreamFailure(src);
              code = probe.status === 403 ? probe.code : null;
            }
            if (!cancelled) errorRef.current?.(403, code);
          })();
          return;
        }
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
