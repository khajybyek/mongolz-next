"use client";

import { useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Unified face-crop thumbnail. Loads every crop through the single
 * /api/faces/[id]/secure-crop endpoint, which decrypts sealed crops
 * (authority-gated) or streams legacy plaintext crops — so display sites
 * never touch the storage layer directly and the crop can be encrypt-only
 * at rest (ADR 0009, Tier 2).
 *
 *   • loading → spinner
 *   • 403 (above the viewer's reveal_level) / error → lock placeholder
 *
 * `className` sizes the wrapper (e.g. "aspect-square rounded"); the image
 * fills it with object-cover.
 */
export function FaceThumb({
  faceId,
  alt,
  className,
}: {
  faceId: string;
  alt?: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"loading" | "ok" | "err">("loading");

  return (
    <div className={cn("relative overflow-hidden bg-bg-tertiary", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/faces/${faceId}/secure-crop`}
        alt={alt ?? "face"}
        onLoad={() => setStatus("ok")}
        onError={() => setStatus("err")}
        className={cn(
          "absolute inset-0 w-full h-full object-cover transition-opacity",
          status === "ok" ? "opacity-100" : "opacity-0",
        )}
      />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
        </div>
      )}
      {status === "err" && (
        <div className="absolute inset-0 flex items-center justify-center text-text-faint">
          <Lock className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}
