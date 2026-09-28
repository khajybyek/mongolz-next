import { pickHmacSecret } from "@/lib/auth/hmac-secret";
import { hmacEqual, hmacSign } from "@/lib/auth/hmac";
import { STREAM_TICKET_TTL_SEC } from "@/lib/stream-ticket-renewal";

// 5 minutes. Kept short on purpose: players renew before expiry
// (lib/stream-ticket-renewal.ts, which owns the constant so the renewal
// schedule and the lifetime cannot drift apart).
const TTL_SEC = STREAM_TICKET_TTL_SEC;
const PURPOSE = "mongolz-stream-ticket:v2";

function getSecret(): string {
  // Fail-closed in production (no silent reuse of the ML bearer token as a
  // signing key); the ML token stays as a local-dev fallback only.
  const secret = pickHmacSecret("STREAM_TICKET_SECRET", "ML_SERVICE_TOKEN");
  if (!secret) throw new Error("STREAM_TICKET_SECRET_MISSING");
  return secret;
}

export function issueStreamTicket(userId: string, cameraId: string): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  const payload = `${userId}:${cameraId}:${exp}`;
  const sig = hmacSign(getSecret(), PURPOSE, payload, "base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyStreamTicket(ticket: string, cameraId: string): { valid: boolean; userId?: string } {
  const dot = ticket.indexOf(".");
  if (dot < 0) return { valid: false };

  const payloadB64 = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString();
  } catch {
    return { valid: false };
  }

  let expected: string;
  try {
    expected = hmacSign(getSecret(), PURPOSE, payload, "base64url");
  } catch {
    return { valid: false };
  }
  if (!hmacEqual(sig, expected, "base64url")) return { valid: false };

  const parts = payload.split(":");
  if (parts.length !== 3) return { valid: false };
  const [userId, ticketCameraId, expStr] = parts;

  if (ticketCameraId !== cameraId) return { valid: false };
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Math.floor(Date.now() / 1000) > exp) return { valid: false };

  return { valid: true, userId };
}
