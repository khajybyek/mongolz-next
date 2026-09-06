"use client";

import { useState } from "react";
import { Lock, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

/**
 * Unified face-crop thumbnail. Loads every crop through the single
 * /api/faces/[id]/secure-crop endpoint, which decrypts sealed crops
 * (authority-gated) or streams legacy plaintext crops — so display sites
 * never touch the storage layer directly and the crop can be encrypt-only
 * at rest (ADR 0009, Tier 2).
 *
 *   • loading → spinner
 *   • 403 (above the viewer's reveal_level) / error → lock placeholder
 *   • `sealed` → shield badge (the crop exists only as an AES-256-GCM blob
 *     keyed by the face's hash-chain position). Callers get the flag from
 *     `faces.crop_sealed` / the `faces_in_recording` RPC, so no probe request
 *     is needed to tell sealed from legacy plaintext.
 *
 * `className` sizes the wrapper (e.g. "aspect-square rounded"); the image
 * fills it with object-cover.
 */
export function FaceThumb({
  faceId,
  alt,
  className,
  sealed,
}: {
  faceId: string;
  alt?: string;
  className?: string;
  /** Crop is encrypt-only at rest (ADR 0009). Shows a shield badge. */
  sealed?: boolean;
}) {
  const { t } = useT();
  const [status, setStatus] = useState<"loading" | "ok" | "err">("loading");

  return (
    <div className={cn("relative overflow-hidden bg-bg-tertiary", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/faces/${faceId}/secure-crop`}
        alt={alt ?? "face"}
        loading="lazy"
        decoding="async"
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
        <div
          className="absolute inset-0 flex items-center justify-center text-text-faint"
          title={t("face_locked_badge")}
        >
          <Lock className="w-4 h-4" aria-label={t("face_locked_badge")} />
        </div>
      )}
      {sealed && status === "ok" && (
        <span
          className="absolute bottom-0.5 right-0.5 z-10 rounded bg-black/60 p-0.5 text-accent pointer-events-none"
          title={t("face_sealed_badge")}
          aria-label={t("face_sealed_badge")}
        >
          <ShieldCheck className="w-3 h-3" />
        </span>
      )}
    </div>
  );
}
