/**
 * Webhook delivery (lib/webhooks.ts, lib/net-guard.ts):
 *  - the /webhooks Test button reaches exactly ONE hook, enabled or not;
 *  - reveal-event payloads build for Slack/Discord (the builder used to crash
 *    on a missing recording_id and reject the whole fan-out);
 *  - redirects are never followed (a 302 to 127.0.0.1 was fetched);
 *  - IPv4-mapped IPv6 and bracketed hosts are private.
 */
import { lookup } from "node:dns/promises";
import { dispatchEvent, dispatchToHook } from "@/lib/webhooks";
import { isPrivateHost, isPrivateIp, normaliseIp } from "@/lib/net-guard";
import { WEBHOOK_EVENTS } from "@/lib/webhook-events";

jest.mock("node:dns/promises", () => ({ lookup: jest.fn() }));

type Row = { id: string; name: string; kind: string; url: string; signing_secret: string | null; events: string[]; enabled: boolean };
const rows: Row[] = [
  { id: "h1", name: "one", kind: "slack", url: "https://hooks.example.com/a", signing_secret: null, events: ["reveal_requested"], enabled: true },
  { id: "h2", name: "two", kind: "discord", url: "https://hooks.example.com/b", signing_secret: null, events: ["reveal_requested"], enabled: false },
];
const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        update: (p: Record<string, unknown>) => {
          patch = p;
          return q;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          if (patch && col === "id") {
            updates.push({ id: String(val), patch });
            return Promise.resolve({ error: null });
          }
          return q;
        },
        contains: (_c: string, v: string[]) => {
          filters.contains = v[0];
          return q;
        },
        maybeSingle: async () => ({ data: rows.find((r) => r.id === filters.id) ?? null }),
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve({
            data: rows.filter(
              (r) =>
                (filters.enabled === undefined || r.enabled === filters.enabled) &&
                (!filters.contains || r.events.includes(String(filters.contains))),
            ),
          }).then(ok),
      };
      return q;
    },
  }),
}));

const fetchMock = jest.fn();
beforeEach(() => {
  updates.length = 0;
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
});

const reveal = {
  type: "reveal_requested",
  job_id: "j",
  recording_id: "0123456789abcdef",
  method: "TEST",
  threshold: null,
  requested_email: null,
  created_at: "2026-09-23T00:00:00Z",
  url: "https://aicctv.dev/reveal-approvals",
};

describe("dispatchToHook", () => {
  it("delivers to the tested hook only — even a disabled one", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const r = await dispatchToHook("h2", reveal);
    expect(r).toEqual({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://hooks.example.com/b");
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
    expect(updates.map((u) => u.id)).toEqual(["h2"]);
  });

  it("returns null for an unknown hook", async () => {
    expect(await dispatchToHook("nope", reveal)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a redirect as a failed delivery and never follows it", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1:47992/internal" } }));
    const r = await dispatchToHook("h1", reveal);
    expect(r).toEqual({ ok: false, status: 302 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses when any resolved address is private (IPv4-mapped IPv6 included)", async () => {
    jest.mocked(lookup).mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "::ffff:7f00:1", family: 6 },
    ] as never);
    const r = await dispatchToHook("h1", reveal);
    expect(r).toEqual({ ok: false, status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a malformed reveal payload builds instead of rejecting", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const { recording_id: _drop, ...noRecording } = reveal;
    void _drop;
    await expect(dispatchToHook("h1", noRecording)).resolves.toEqual({ ok: true, status: 200 });
    await expect(dispatchToHook("h2", { ...noRecording, type: "reveal_completed", status: "approved" })).resolves.toEqual({ ok: true, status: 200 });
  });
});

describe("dispatchEvent", () => {
  it("still fans out to enabled subscribers only", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    await dispatchEvent("reveal_requested", reveal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://hooks.example.com/a");
  });
});

describe("net-guard", () => {
  it.each([
    "127.0.0.1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::1", "[::1]", "::",
    "0.0.0.0", "198.18.0.1", "224.0.0.1", "64:ff9b::7f00:1", "fe80::1%eth0", "not-an-ip",
  ])("%s is private", (ip) => expect(isPrivateIp(ip)).toBe(true));

  it.each(["93.184.216.34", "2606:4700::1111"])("%s is public", (ip) => expect(isPrivateIp(ip)).toBe(false));

  it("unwraps mapped addresses", () => {
    expect(normaliseIp("::ffff:a9fe:a9fe")).toBe("169.254.169.254");
    expect(normaliseIp("[::FFFF:127.0.0.1]")).toBe("127.0.0.1");
  });

  it("admission refuses bracketed and mapped literal hosts", () => {
    expect(isPrivateHost(new URL("https://[::ffff:127.0.0.1]/").hostname)).toBe(true);
    expect(isPrivateHost(new URL("https://[::1]/").hostname)).toBe(true);
    expect(isPrivateHost(new URL("https://2130706433/").hostname)).toBe(true);
    expect(isPrivateHost("printer.local")).toBe(true);
    expect(isPrivateHost("hooks.slack.com")).toBe(false);
  });
});

describe("event vocabulary", () => {
  it("offers only events something dispatches", () => {
    expect([...WEBHOOK_EVENTS]).toEqual(["reveal_requested", "reveal_completed"]);
  });
});
