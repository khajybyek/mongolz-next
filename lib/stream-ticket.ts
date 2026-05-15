import { createHmac, timingSafeEqual } from "crypto";

const TTL_SEC = 300; // 5 minutes

function getSecret(): string {
  const secret = process.env.STREAM_TICKET_SECRET || process.env.ML_SERVICE_TOKEN;
  if (!secret) throw new Error("STREAM_TICKET_SECRET_MISSING");
  return secret;
}

export function issueStreamTicket(userId: string, cameraId: string): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  const payload = `${userId}:${cameraId}:${exp}`;
  const sig = createHmac("sha256", getSecret()).update(payload).digest("base64url");
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
    expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  } catch {
    return { valid: false };
  }
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false };
  }

  const parts = payload.split(":");
  if (parts.length !== 3) return { valid: false };
  const [userId, ticketCameraId, expStr] = parts;

  if (ticketCameraId !== cameraId) return { valid: false };
  if (Math.floor(Date.now() / 1000) > Number(expStr)) return { valid: false };

  return { valid: true, userId };
}
