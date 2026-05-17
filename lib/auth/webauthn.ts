/**
 * WebAuthn / passkey helpers — uses @simplewebauthn/server for the heavy
 * cryptography (challenge generation, COSE → SPKI conversion, attestation /
 * assertion verification) and stores credentials + 5-min challenges in
 * Supabase.
 *
 * v1: registration + listing + deletion of passkeys from /settings. Login
 * flow remains email/password + TOTP; passkey-as-login is staged for a
 * future commit once UX is validated against the defense rehearsal.
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { createServiceClient } from "@/lib/supabase/server";

/** Relying-party config — derived from the production host. */
export function getRpConfig(host: string | null) {
  // Strip port for rpId (the host without :port per WebAuthn spec).
  const rpId = (host ?? "mongolz.vercel.app").split(":")[0]!;
  const origin =
    process.env.NEXT_PUBLIC_WEBAUTHN_ORIGIN ?? `https://${rpId}`;
  return {
    rpName: "MONGOLZ Security",
    rpId,
    origin,
  };
}

/** Persist a fresh challenge so /register/finish can verify it. */
export async function storeChallenge(
  user_id: string,
  challenge: string,
  kind: "register" | "auth",
): Promise<void> {
  const svc = createServiceClient();
  // Best-effort cleanup of expired rows for this user (no cron needed).
  await svc
    .from("webauthn_challenges")
    .delete()
    .eq("user_id", user_id)
    .eq("kind", kind);
  await svc.from("webauthn_challenges").insert({
    user_id,
    challenge,
    kind,
  });
}

/** Consume a stored challenge: returns the value and deletes the row. */
export async function consumeChallenge(
  user_id: string,
  kind: "register" | "auth",
): Promise<string | null> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("webauthn_challenges")
    .select("id, challenge, expires_at")
    .eq("user_id", user_id)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (!data) return null;
  // Single-use: delete regardless of whether it's expired.
  await svc.from("webauthn_challenges").delete().eq("id", data.id);
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.challenge;
}

export async function buildRegistrationOptions(args: {
  user_id: string;
  user_email: string;
  host: string | null;
  existingCredentialIds: string[];
}) {
  const rp = getRpConfig(args.host);
  const opts = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpId,
    userID: new TextEncoder().encode(args.user_id),
    userName: args.user_email,
    userDisplayName: args.user_email,
    timeout: 60_000,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials: args.existingCredentialIds.map((id) => ({
      id,
      transports: ["internal", "hybrid", "usb", "ble", "nfc"],
    })),
  });
  await storeChallenge(args.user_id, opts.challenge, "register");
  return opts;
}

export async function finishRegistration(args: {
  user_id: string;
  host: string | null;
  response: RegistrationResponseJSON;
  device_name?: string | null;
}) {
  const rp = getRpConfig(args.host);
  const expectedChallenge = await consumeChallenge(args.user_id, "register");
  if (!expectedChallenge) {
    throw new Error("Challenge expired or missing — start over");
  }

  const verification = await verifyRegistrationResponse({
    response: args.response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpId,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("WebAuthn attestation verification failed");
  }

  const { credential } = verification.registrationInfo;
  const credentialIdB64 = credential.id; // already base64url
  const publicKeyB64 = Buffer.from(credential.publicKey).toString("base64url");

  const svc = createServiceClient();
  const { error } = await svc.from("webauthn_credentials").insert({
    user_id: args.user_id,
    credential_id: credentialIdB64,
    public_key: publicKeyB64,
    counter: credential.counter,
    transports: credential.transports ?? [],
    device_name: args.device_name?.slice(0, 80) ?? null,
  });
  if (error) {
    throw new Error(`Store passkey: ${error.message}`);
  }
  return { ok: true, credential_id: credentialIdB64 };
}
