/**
 * lib/notify — pure wire-format builders + the best-effort fan-out contract.
 * The side-effect modules (webhooks, push) are mocked at the boundary; fetch
 * is stubbed so the Telegram call shape can be asserted without any network.
 */

const webhookMock = { dispatchEvent: jest.fn(async () => undefined) };
const pushMock = {
  sendPushToAdminsExcept: jest.fn(async () => ({ delivered: 1, failed: 0, gone: 0 })),
  sendPushToUser: jest.fn(async () => ({ delivered: 1, failed: 0, gone: 0 })),
};

jest.mock("@/lib/webhooks", () => webhookMock);
jest.mock("@/lib/push", () => pushMock);

import {
  buildRevealRequestedWebhookPayload,
  buildRevealRequestedPush,
  buildRevealRequestedTelegramPayload,
  buildRevealDecisionWebhookPayload,
  buildRevealDecisionPush,
  buildRevealDecisionTelegramPayload,
  notifyRevealRequested,
  notifyRevealDecision,
  postTelegram,
  shortId,
  APPROVALS_PATH,
  JOBS_PATH,
} from "@/lib/notify";

const JOB = "aaaaaaaa-1111-4222-8333-444444444444";
const REC = "bbbbbbbb-5555-4666-8777-888888888888";
const NOW = new Date("2026-09-07T03:04:05.000Z");

const request = {
  jobId: JOB,
  recordingId: REC,
  requesterId: "user-req",
  requesterEmail: "req@mongolz.local",
  method: "suspect",
  threshold: 0.45,
};

const decision = {
  jobId: JOB,
  recordingId: REC,
  requesterId: "user-req",
  requesterEmail: "req@mongolz.local",
  approved: false,
  deciderEmail: "boss@mongolz.local",
  reason: "wrong recording",
};

describe("pure builders", () => {
  it("shortId keeps the first 8 chars of a UUID", () => {
    expect(shortId(REC)).toBe("bbbbbbbb");
  });

  it("reveal_requested webhook payload links to the approvals queue", () => {
    const p = buildRevealRequestedWebhookPayload(request, NOW);
    expect(p).toEqual({
      type: "reveal_requested",
      job_id: JOB,
      recording_id: REC,
      method: "suspect",
      threshold: 0.45,
      requested_email: "req@mongolz.local",
      created_at: NOW.toISOString(),
      url: `https://aicctv.dev${APPROVALS_PATH}`,
    });
  });

  it("reveal_requested push targets /reveal-approvals with a per-job tag", () => {
    const p = buildRevealRequestedPush(request);
    expect(p.url).toBe(APPROVALS_PATH);
    expect(p.tag).toBe(`mongolz-reveal-request-${JOB}`);
    expect(p.title).toContain("req@mongolz.local");
    expect(p.body).toContain("suspect");
    expect(p.body).toContain(shortId(REC));
  });

  it("reveal_requested telegram payload is kind-discriminated and null-safe", () => {
    const p = buildRevealRequestedTelegramPayload({ ...request, requesterEmail: undefined, threshold: undefined }, NOW);
    expect(p).toEqual({
      kind: "reveal_requested",
      job_id: JOB,
      recording_id: REC,
      requester_email: null,
      method: "suspect",
      threshold: null,
      created_at: NOW.toISOString(),
    });
  });

  it("decision webhook payload reuses reveal_completed with approved/rejected status", () => {
    const rejected = buildRevealDecisionWebhookPayload(decision);
    expect(rejected.type).toBe("reveal_completed");
    expect(rejected.status).toBe("rejected");
    expect(rejected.reason).toBe("wrong recording");
    expect(rejected.decided_email).toBe("boss@mongolz.local");
    expect(rejected.url).toBe(`https://aicctv.dev${JOBS_PATH}`);

    const approved = buildRevealDecisionWebhookPayload({ ...decision, approved: true, reason: undefined });
    expect(approved.status).toBe("approved");
    expect(approved.reason).toBeNull();
  });

  it("decision push goes to /jobs and carries the reason only when rejected", () => {
    const rejected = buildRevealDecisionPush(decision);
    expect(rejected.url).toBe(JOBS_PATH);
    expect(rejected.title).toBe("Reveal rejected");
    expect(rejected.body).toContain("wrong recording");

    const approved = buildRevealDecisionPush({ ...decision, approved: true });
    expect(approved.title).toBe("Reveal approved");
    expect(approved.body).not.toContain("wrong recording");
  });

  it("decision telegram payload is kind-discriminated", () => {
    const p = buildRevealDecisionTelegramPayload(decision, NOW);
    expect(p).toEqual({
      kind: "reveal_decided",
      job_id: JOB,
      approved: false,
      requester_email: "req@mongolz.local",
      decider_email: "boss@mongolz.local",
      reason: "wrong recording",
      decided_at: NOW.toISOString(),
    });
  });
});

describe("fan-out", () => {
  const env = { ...process.env };
  const fetchMock = jest.fn();
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    process.env = { ...env };
    warn.mockRestore();
  });

  it("postTelegram hits the edge function with the service-role bearer and a timeout signal", async () => {
    const ok = await postTelegram(buildRevealRequestedTelegramPayload(request, NOW));
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/functions/v1/telegram-alerts");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer service-key");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body)).kind).toBe("reveal_requested");
  });

  it("postTelegram skips (does not throw) when env is unset", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(postTelegram(buildRevealRequestedTelegramPayload(request, NOW))).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("notifyRevealRequested excludes the requester from push and never throws", async () => {
    webhookMock.dispatchEvent.mockRejectedValueOnce(new Error("slack down"));
    fetchMock.mockRejectedValueOnce(new Error("edge down"));
    await expect(notifyRevealRequested(request)).resolves.toBeUndefined();
    expect(webhookMock.dispatchEvent).toHaveBeenCalledWith(
      "reveal_requested",
      expect.objectContaining({ type: "reveal_requested", job_id: JOB }),
    );
    expect(pushMock.sendPushToAdminsExcept).toHaveBeenCalledWith(
      "user-req",
      expect.objectContaining({ url: APPROVALS_PATH }),
    );
    // Two failed channels → two warnings, push still delivered.
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("notifyRevealDecision pushes only the requester and skips push for legacy rows", async () => {
    await notifyRevealDecision(decision);
    expect(pushMock.sendPushToUser).toHaveBeenCalledWith("user-req", expect.objectContaining({ url: JOBS_PATH }));
    expect(pushMock.sendPushToAdminsExcept).not.toHaveBeenCalled();
    expect(webhookMock.dispatchEvent).toHaveBeenCalledWith(
      "reveal_completed",
      expect.objectContaining({ status: "rejected", recording_id: REC }),
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).kind).toBe("reveal_decided");

    jest.clearAllMocks();
    await notifyRevealDecision({ ...decision, requesterId: null });
    expect(pushMock.sendPushToUser).not.toHaveBeenCalled();
    expect(webhookMock.dispatchEvent).toHaveBeenCalledTimes(1);
  });
});
