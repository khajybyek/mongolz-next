"use client";

import { useEffect, useRef } from "react";

interface HlsPlayerProps {
  src: string;
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
}

export function HlsPlayer({
  src,
  className,
  autoPlay = true,
  muted = true,
  controls = true,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

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

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }

    (async () => {
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;
      if (!Hls.isSupported()) {
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
      hls.loadSource(src);
      hls.attachMedia(video);
    })();

    return () => {
      cancelled = true;
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
