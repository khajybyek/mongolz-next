"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";

/** Convert base64url → ArrayBuffer for the WebAuthn browser API. */
function b64uToBuf(b64u: string): ArrayBuffer {
  const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
  const b64 = (b64u + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function bufToB64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface Props {
  /** Where to redirect after success. */
  next: string;
  /** i18n labels resolved server-side. */
  labels: {
    button: string;            // "Passkey-ээр нэвтрэх"
    needEmail: string;         // "Email эсвэл username оруулна уу"
    notEnrolled: string;       // "Passkey бүртгэгдээгүй..."
    unsupported: string;       // "Браузер passkey дэмждэггүй"
    cancelled: string;         // "Цуцлагдсан"
    generic: string;           // "Passkey login bүтэлгүйтэв"
  };
}

export function PasskeyLoginButton({ next, labels }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolved after mount so SSR (null) and the first client render agree;
  // reading `window` during render caused a hydration mismatch.
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(typeof window.PublicKeyCredential !== "undefined");
  }, []);

  async function run() {
    if (busy) return;
    setError(null);
    const emailInput = document.getElementById(
      "email",
    ) as HTMLInputElement | null;
    const email = emailInput?.value?.trim() ?? "";
    if (!email) {
      emailInput?.focus();
      setError(labels.needEmail);
      return;
    }

    setBusy(true);
    try {
      // 1. begin
      const beginRes = await fetch("/api/auth/passkey/login/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const opts = await beginRes.json();
      if (!beginRes.ok) {
        throw new Error(opts?.error ?? labels.notEnrolled);
      }

      // 2. navigator.credentials.get
      const publicKey: PublicKeyCredentialRequestOptions = {
        ...opts,
        challenge: b64uToBuf(opts.challenge),
        allowCredentials: (opts.allowCredentials ?? []).map(
          (c: { id: string; type: string; transports?: string[] }) => ({
            ...c,
            id: b64uToBuf(c.id),
          }),
        ),
      };
      const cred = (await navigator.credentials.get({ publicKey })) as
        | PublicKeyCredential
        | null;
      if (!cred) throw new Error(labels.cancelled);

      const ass = cred.response as AuthenticatorAssertionResponse;

      // 3. finish
      const finishRes = await fetch("/api/auth/passkey/login/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_handle: opts.user_handle,
          response: {
            id: cred.id,
            rawId: bufToB64u(cred.rawId),
            type: cred.type,
            authenticatorAttachment: (cred as unknown as {
              authenticatorAttachment?: string;
            }).authenticatorAttachment ?? null,
            clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
            response: {
              clientDataJSON: bufToB64u(ass.clientDataJSON),
              authenticatorData: bufToB64u(ass.authenticatorData),
              signature: bufToB64u(ass.signature),
              userHandle: ass.userHandle ? bufToB64u(ass.userHandle) : null,
            },
          },
        }),
      });
      const finishJson = await finishRes.json();
      if (!finishRes.ok) {
        throw new Error(finishJson?.error ?? labels.generic);
      }

      // 4. Cookies set by /finish → reload into the protected area.
      // Intentional full-page load (not router.push) so the server re-reads
      // the freshly-set session cookie and renders the authed shell.
      window.location.assign(next || "/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.generic);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="btn-secondary w-full"
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Fingerprint className="w-4 h-4" />
        )}
        {labels.button}
      </button>
      {error && (
        <p className="text-2xs text-danger text-center">{error}</p>
      )}
    </div>
  );
}
