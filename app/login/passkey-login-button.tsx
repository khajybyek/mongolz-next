"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
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
    busy: string;
    hint: string;
    divider: string;
    tooMany: string;
    needEmail: string;         // "Email эсвэл username оруулна уу"
    notEnrolled: string;       // "Passkey бүртгэгдээгүй..."
    unsupported: string;       // "Браузер passkey дэмждэггүй"
    cancelled: string;         // "Цуцлагдсан"
    generic: string;           // "Passkey login bүтэлгүйтэв"
  };
}

export function PasskeyLoginButton({ next, labels }: Props) {
  const { pending } = useFormStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolved after mount so SSR (null) and the first client render agree;
  // reading `window` during render caused a hydration mismatch.
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(typeof window.PublicKeyCredential !== "undefined");
  }, []);

  async function run() {
    if (busy || pending) return;
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
        setError(beginRes.status === 429 ? labels.tooMany : labels.notEnrolled);
        return;
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
      if (!cred) {
        setError(labels.cancelled);
        return;
      }

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
      if (!finishRes.ok) {
        setError(finishRes.status === 429 ? labels.tooMany : labels.generic);
        return;
      }

      // 4. Cookies set by /finish → reload into the protected area.
      // Intentional full-page load (not router.push) so the server re-reads
      // the freshly-set session cookie and renders the authed shell.
      window.location.assign(next || "/dashboard");
    } catch (e) {
      const cancelled = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");
      setError(cancelled ? labels.cancelled : labels.generic);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 pb-1 text-xs text-text-muted">
        <span className="h-px flex-1 bg-border" aria-hidden />
        <span>{labels.divider}</span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>
      <button
        type="button"
        onClick={run}
        disabled={busy || pending}
        aria-busy={busy}
        aria-describedby="passkey-hint"
        className="btn-secondary min-h-12 w-full justify-center gap-2.5"
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        ) : (
          <Fingerprint className="w-4 h-4" aria-hidden />
        )}
        <span aria-live="polite">{busy ? labels.busy : labels.button}</span>
      </button>
      <p id="passkey-hint" className="text-xs leading-5 text-text-muted">{labels.hint}</p>
      {error && (
        <p role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2.5 text-xs leading-5 text-danger">{error}</p>
      )}
    </div>
  );
}
