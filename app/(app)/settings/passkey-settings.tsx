"use client";

import { useEffect, useRef, useState } from "react";
import { Fingerprint, Trash2, Loader2, Plus, AlertCircle, CheckCircle2 } from "lucide-react";
import { TotpPrompt } from "@/components/totp-prompt";
import { useT } from "@/lib/i18n/client";

interface Credential {
  id: string;
  credential_id: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
  transports: string[];
}

/** Convert base64url string → ArrayBuffer (browser WebAuthn API expects buffers) */
function b64uToBuf(b64u: string): ArrayBuffer {
  const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
  const b64 = (b64u + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** ArrayBuffer → base64url (no padding) */
function bufToB64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function PasskeySettings() {
  const { t } = useT();
  const [creds, setCreds] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Enrol/delete need fresh step-up; on REAUTH_REQUIRED we open the TOTP
  // prompt and replay the interrupted action afterwards.
  const [needsTotp, setNeedsTotp] = useState(false);
  const retryRef = useRef<(() => Promise<void>) | null>(null);

  // Resolved in an effect so the server render and first client render
  // agree (reading `window` during render caused a hydration mismatch).
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setSupported(typeof window.PublicKeyCredential !== "undefined");
  }, []);

  function requireStepUp(retry: () => Promise<void>) {
    retryRef.current = retry;
    setNeedsTotp(true);
  }

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/auth/passkey");
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed to load");
      setCreds(j.credentials ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function enroll() {
    setError(null);
    setSuccess(null);
    setEnrolling(true);
    try {
      // 1. Get options from server
      const beginRes = await fetch("/api/auth/passkey/register/begin", {
        method: "POST",
      });
      const opts = await beginRes.json();
      if (beginRes.status === 403 && opts?.error === "REAUTH_REQUIRED") {
        requireStepUp(enroll);
        return;
      }
      if (!beginRes.ok) throw new Error(opts?.error ?? "Cannot start");

      // 2. Call the browser API. Convert base64url → ArrayBuffer for
      //    `challenge` + `user.id` + each excludeCredentials.id.
      const publicKey: PublicKeyCredentialCreationOptions = {
        ...opts,
        challenge: b64uToBuf(opts.challenge),
        user: { ...opts.user, id: b64uToBuf(opts.user.id) },
        excludeCredentials: (opts.excludeCredentials ?? []).map(
          (c: { id: string; type: string; transports?: string[] }) => ({
            ...c,
            id: b64uToBuf(c.id),
          }),
        ),
      };
      const cred = (await navigator.credentials.create({ publicKey })) as
        | PublicKeyCredential
        | null;
      if (!cred) throw new Error("User cancelled");

      const att = cred.response as AuthenticatorAttestationResponse;
      const clientDataJSON = bufToB64u(att.clientDataJSON);
      const attestationObject = bufToB64u(att.attestationObject);
      const transports = (att as unknown as {
        getTransports?: () => string[];
      }).getTransports?.() ?? [];

      // 3. Send back to server for verification
      const finishRes = await fetch("/api/auth/passkey/register/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_name: detectDeviceLabel(),
          response: {
            id: cred.id,
            rawId: bufToB64u(cred.rawId),
            type: cred.type,
            authenticatorAttachment: (cred as unknown as {
              authenticatorAttachment?: string;
            }).authenticatorAttachment ?? null,
            clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
            response: {
              clientDataJSON,
              attestationObject,
              transports,
            },
          },
        }),
      });
      const finishJson = await finishRes.json();
      if (!finishRes.ok) throw new Error(finishJson?.error ?? "Verify failed");
      setSuccess("Passkey бүртгэгдсэн");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enrollment failed");
    } finally {
      setEnrolling(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    setSuccess(null);
    setDeleting(id);
    try {
      const r = await fetch(`/api/auth/passkey?id=${id}`, { method: "DELETE" });
      const j = await r.json();
      if (r.status === 403 && j?.error === "REAUTH_REQUIRED") {
        requireStepUp(() => remove(id));
        return;
      }
      if (!r.ok) throw new Error(j?.error ?? "Delete failed");
      setSuccess("Passkey устгасан");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  if (supported === null) return null;
  if (!supported) {
    return (
      <div className="card border border-warning/30 bg-warning/5">
        <div className="flex items-start gap-2 text-xs text-text-soft">
          <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-warning mb-1">
              Энэ browser passkey дэмждэггүй
            </div>
            WebAuthn API байхгүй — Safari 15+, Chrome 108+, Firefox 122+
            эсвэл Edge ашиглана уу.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <TotpPrompt
        open={needsTotp}
        onClose={() => {
          setNeedsTotp(false);
          retryRef.current = null;
        }}
        onSuccess={() => {
          setNeedsTotp(false);
          const retry = retryRef.current;
          retryRef.current = null;
          if (retry) void retry();
        }}
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Fingerprint className="w-4 h-4 text-accent" />
            Passkey
          </h3>
          <p className="text-xs text-text-soft mt-1 max-w-md leading-relaxed">
            Phishing-эсэргүүцэх hardware-backed login — iCloud Keychain,
            Windows Hello, Android, YubiKey. PIN / biometric шаардлагатай тул
            passkey нь өөрөө хоёр дахь фактор болно; нэмэх, устгахад шинэ TOTP
            баталгаажуулалт ({t("step_up_required")}).
          </p>
        </div>
        <button
          type="button"
          onClick={enroll}
          disabled={enrolling}
          className="btn-primary btn-sm shrink-0"
        >
          {enrolling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Passkey нэмэх
        </button>
      </div>

      {error && (
        <div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded p-2 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      {success && (
        <div className="text-xs text-success bg-success/10 border border-success/30 rounded p-2 flex items-start gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {success}
        </div>
      )}

      {loading ? (
        <div className="text-xs text-text-muted py-4 text-center">
          <Loader2 className="w-4 h-4 animate-spin inline" /> Уншиж байна…
        </div>
      ) : creds.length === 0 ? (
        <p className="text-xs text-text-muted py-3 text-center border border-dashed border-border rounded">
          Passkey бүртгэгдээгүй
        </p>
      ) : (
        <ul className="space-y-2">
          {creds.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 text-xs border border-border rounded p-2.5"
            >
              <Fingerprint className="w-4 h-4 text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-text truncate">
                  {c.device_name ?? "Unnamed passkey"}
                </div>
                <div className="text-text-muted">
                  {new Date(c.created_at).toLocaleDateString()} ·{" "}
                  {c.transports.length > 0 ? c.transports.join(", ") : "—"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(c.id)}
                disabled={deleting === c.id}
                className="text-text-muted hover:text-danger p-1.5 rounded"
                title="Устгах"
              >
                {deleting === c.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function detectDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Unknown device";
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iPhone / iPad (iCloud Keychain)";
  if (/Macintosh/.test(ua)) return "Mac (Touch ID / iCloud Keychain)";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows Hello";
  if (/Linux/.test(ua)) return "Linux";
  return "Browser passkey";
}
