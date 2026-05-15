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

    const srcUrl = new URL(src, window.location.origin);
    const ticket = srcUrl.searchParams.get("ticket");

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }

    (async () => {
      const { default: Hls } = await import("hls.js");
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
      hls?.destroy();
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
