"use client";

import { useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";

/**
 * Face thumbnail that proves per-face PIXEL encryption (ADR 0009).
 *
 * It first tries the secure endpoint, which streams the crop decrypted from
 * its AES-256-GCM seal using the face's hash-chain key K_index:
 *   • success  → shows the decrypted crop + a 🛡 "Kᵢ" badge.
 *   • 403      → the face is above the viewer's reveal_level (forward-only
 *                chain can't derive its key) → a 🔒 lock placeholder.
 *   • 404      → legacy face with no sealed crop → falls back to the plain
 *                signed-URL thumbnail (backward compatible, no badge).
 */
export function SecureFaceCrop({
  faceId,
  plainSrc,
  alt,
  displayNo,
}: {
  faceId: string;
  plainSrc: string | null;
  alt: string;
  displayNo: number;
}) {
  // secure → try decrypt endpoint; plain → legacy signed URL; locked → 403.
  const [mode, setMode] = useState<"secure" | "plain" | "locked">("secure");
  const [secureOk, setSecureOk] = useState(false);

  const secureSrc = `/api/faces/${faceId}/secure-crop`;
  const src = mode === "secure" ? secureSrc : mode === "plain" ? plainSrc : null;

  async function onSecureError() {
    // Distinguish 403 (locked) from 404/other (fall back to plain) by a HEAD-ish
    // refetch — cheap and only runs on the error path.
    try {
      const res = await fetch(secureSrc, { method: "GET", cache: "no-store" });
      if (res.status === 403) {
        setMode("locked");
        return;
      }
    } catch {
      /* fall through to plain */
    }
    setMode("plain");
  }

  return (
    <div
      className="relative aspect-square rounded overflow-hidden bg-bg-tertiary"
      title={`#${displayNo} · ${alt}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover"
          onLoad={() => {
            if (mode === "secure") setSecureOk(true);
          }}
          onError={() => {
            if (mode === "secure") void onSecureError();
          }}
        />
      ) : (
        // No displayable image: either above-authority (locked) or a legacy
        // face with neither a sealed crop nor a signed URL. Show a lock
        // placeholder rather than a blank box so the cell never renders empty.
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-text-faint">
          <Lock className="w-4 h-4" />
          <span className="text-[8px] leading-none">
            {mode === "locked" ? "эрхгүй" : "—"}
          </span>
        </div>
      )}

      {secureOk && (
        <span className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5 text-[8px] font-bold leading-none px-1 py-0.5 rounded bg-success/85 text-bg">
          <ShieldCheck className="w-2.5 h-2.5" />
          Kᵢ
        </span>
      )}
      <span className="absolute top-0.5 left-0.5 text-[10px] font-bold leading-none px-1 py-0.5 rounded bg-black/70 text-accent">
        #{displayNo}
      </span>
    </div>
  );
}
