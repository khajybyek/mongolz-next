beforeAll(() => {
  process.env.STREAM_TICKET_SECRET = "test-secret-key-for-jest"; // pragma: allowlist secret
});

import { issueStreamTicket, verifyStreamTicket } from "@/lib/stream-ticket";

describe("stream-ticket", () => {
  const userId = "user-abc-123";
  const cameraId = "cam-xyz-456";

  it("issues and verifies a valid ticket", () => {
    const ticket = issueStreamTicket(userId, cameraId);
    const result = verifyStreamTicket(ticket, cameraId);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe(userId);
  });

  it("rejects a ticket for wrong camera", () => {
    const ticket = issueStreamTicket(userId, cameraId);
    const result = verifyStreamTicket(ticket, "other-cam");
    expect(result.valid).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const ticket = issueStreamTicket(userId, cameraId);
    const tampered = ticket.slice(0, -4) + "XXXX";
    const result = verifyStreamTicket(tampered, cameraId);
    expect(result.valid).toBe(false);
  });

  it("rejects a ticket without dot separator", () => {
    const result = verifyStreamTicket("nodotshere", cameraId);
    expect(result.valid).toBe(false);
  });

  it("rejects expired tickets", () => {
    const realNow = Date.now;
    Date.now = () => realNow() - 400 * 1000;
    const ticket = issueStreamTicket(userId, cameraId);
    Date.now = realNow;

    const result = verifyStreamTicket(ticket, cameraId);
    expect(result.valid).toBe(false);
  });

  it("fails closed when no signing secret is configured", () => {
    const oldStreamSecret = process.env.STREAM_TICKET_SECRET;
    const oldMlToken = process.env.ML_SERVICE_TOKEN;
    delete process.env.STREAM_TICKET_SECRET;
    delete process.env.ML_SERVICE_TOKEN;

    try {
      expect(() => issueStreamTicket(userId, cameraId)).toThrow("STREAM_TICKET_SECRET_MISSING");
      expect(verifyStreamTicket("payload.signature", cameraId).valid).toBe(false);
    } finally {
      if (oldStreamSecret === undefined) {
        delete process.env.STREAM_TICKET_SECRET;
      } else {
        process.env.STREAM_TICKET_SECRET = oldStreamSecret;
      }
      if (oldMlToken === undefined) {
        delete process.env.ML_SERVICE_TOKEN;
      } else {
        process.env.ML_SERVICE_TOKEN = oldMlToken;
      }
    }
  });
});
