/**
 * WebAuthn / passkey helpers — uses @simplewebauthn/server for the heavy
 * cryptography (challenge generation, COSE → SPKI conversion, attestation /
 * assertion verification) and stores credentials + 5-min challenges in
 * Supabase.
 *
 * Passkeys are a full login factor here (a passkey login mints a session
 * without the TOTP step), so they must be a *second* factor on their own:
 * user verification (PIN / biometric) is required both at registration and
 * at every assertion — possession of the authenticator alone is not enough.
 * Enrolling or removing a passkey requires fresh step-up (see the routes).
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { createServiceClient } from "@/lib/supabase/server";

/** Relying-party config — derived from the production host. */
export function getRpConfig(host: string | null) {
  // Strip port for rpId (the host without :port per WebAuthn spec).
  const rpId = (host ?? "aicctv.dev").split(":")[0]!;
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
      userVerification: "required",
    },
    excludeCredentials: args.existingCredentialIds.map((id) => ({
      id,
      transports: ["internal", "hybrid", "usb", "ble", "nfc"],
    })),
  });
  await storeChallenge(args.user_id, opts.challenge, "register");
  return opts;
}

/**
 * Build assertion (login) options for a given user's enrolled passkeys.
 *
 * The caller must already know which user is trying to sign in (we look up
 * by email in /login/begin). We don't want to leak "user X exists" to anon
 * probes, so /login/begin returns generic options + a flag indicating
 * whether any passkeys are enrolled — the client doesn't get told why
 * login failed beyond a generic "passkey login unavailable".
 */
export async function buildAuthenticationOptions(args: {
  user_id: string;
  host: string | null;
}) {
  const rp = getRpConfig(args.host);
  const svc = createServiceClient();
  const { data: creds } = await svc
    .from("webauthn_credentials")
    .select("credential_id, transports")
    .eq("user_id", args.user_id);

  if (!creds || creds.length === 0) {
    throw new Error("No passkeys enrolled for this user");
  }

  const opts = await generateAuthenticationOptions({
    rpID: rp.rpId,
    timeout: 60_000,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? []) as ("internal" | "hybrid" | "usb" | "ble" | "nfc")[],
    })),
  });

  await storeChallenge(args.user_id, opts.challenge, "auth");
  return opts;
}

/**
 * Verify an assertion response from `navigator.credentials.get()` and bump
 * the credential's counter + last_used_at on success.
 */
export async function finishAuthentication(args: {
  user_id: string;
  host: string | null;
  response: AuthenticationResponseJSON;
}) {
  const rp = getRpConfig(args.host);
  const expectedChallenge = await consumeChallenge(args.user_id, "auth");
  if (!expectedChallenge) {
    throw new Error("Challenge expired or missing — start over");
  }

  const svc = createServiceClient();
  // The response contains the credential ID the authenticator selected.
  const credentialIdB64 = args.response.id;
  const { data: cred } = await svc
    .from("webauthn_credentials")
    .select("id, credential_id, public_key, counter, transports")
    .eq("user_id", args.user_id)
    .eq("credential_id", credentialIdB64)
    .single();
  if (!cred) {
    throw new Error("Passkey not recognised");
  }

  const verification = await verifyAuthenticationResponse({
    response: args.response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpId,
    credential: {
      id: cred.credential_id,
      publicKey: new Uint8Array(Buffer.from(cred.public_key, "base64url")),
      counter: Number(cred.counter),
      transports: (cred.transports ?? []) as ("internal" | "hybrid" | "usb" | "ble" | "nfc")[],
    },
    // Require user verification on login (PIN / biometric). Platform
    // authenticators (Touch ID, Windows Hello) always satisfy this; it stops
    // a stolen-but-unlocked key from authenticating with mere presence.
    requireUserVerification: true,
  });

  if (!verification.verified) {
    throw new Error("WebAuthn assertion verification failed");
  }

  // Clone detection: a genuine authenticator's signature counter strictly
  // increases. If the reported counter didn't advance past what we stored
  // (and isn't the always-zero case some authenticators use), the assertion
  // is likely replayed or from a cloned credential — reject it.
  const newCounter = verification.authenticationInfo.newCounter;
  const storedCounter = Number(cred.counter);
  if (newCounter !== 0 && newCounter <= storedCounter) {
    throw new Error("Passkey counter regression — possible cloned credential");
  }

  // Bump counter + touch last_used_at (best-effort).
  await svc
    .from("webauthn_credentials")
    .update({
      counter: newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", cred.id);

  return { ok: true, credential_id: cred.credential_id };
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
    // Must match the "required" hint above: a credential enrolled without UV
    // would later pass login with mere presence.
    requireUserVerification: true,
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
