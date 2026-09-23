/**
 * Scheduled-check alarms (failed-login spike, backup verify failure, overdue
 * key rotation) reach every admin by push and the ops chat by Telegram —
 * they used to go only to the optional, unset SLACK_ALERT_WEBHOOK.
 */
import { notifyOpsAlarm } from "@/lib/notify";
import { sendPushToAdminsExcept } from "@/lib/push";

jest.mock("next/server", () => ({ after: jest.fn() }));
jest.mock("@/lib/webhooks", () => ({ dispatchEvent: jest.fn() }));
jest.mock("@/lib/push", () => ({
  sendPushToAdminsExcept: jest.fn(async () => ({ delivered: 1, failed: 0, gone: 0 })),
  sendPushToUser: jest.fn(),
}));

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  jest.mocked(sendPushToAdminsExcept).mockClear();
});

it("pushes every admin (no exclusion) and posts a Telegram security_event", async () => {
  await notifyOpsAlarm({ action: "KEY_ROTATION_DUE", detail: "ML_SERVICE_TOKEN 136d (target 90d)" });
  expect(sendPushToAdminsExcept).toHaveBeenCalledWith(
    null,
    expect.objectContaining({ title: "Security change · KEY_ROTATION_DUE" }),
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
  expect(url).toBe("https://proj.supabase.co/functions/v1/telegram-alerts");
  expect(JSON.parse(init.body)).toMatchObject({
    kind: "security_event",
    action: "KEY_ROTATION_DUE",
    detail: "ML_SERVICE_TOKEN 136d (target 90d)",
  });
});

it("never throws when every channel fails", async () => {
  jest.mocked(sendPushToAdminsExcept).mockRejectedValueOnce(new Error("push down"));
  fetchMock.mockRejectedValueOnce(new Error("telegram down"));
  await expect(notifyOpsAlarm({ action: "MONITOR_ALARM", detail: "x" })).resolves.toBeUndefined();
});
