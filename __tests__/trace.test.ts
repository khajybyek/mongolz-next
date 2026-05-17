/** @jest-environment node */
import { withSpan, tracedFetch, activeTraceId } from "@/lib/trace";

describe("trace helpers (no-op when OTEL not initialised)", () => {
  it("withSpan returns the fn's value", async () => {
    const out = await withSpan("test.simple", async () => 42);
    expect(out).toBe(42);
  });

  it("withSpan rethrows errors", async () => {
    await expect(withSpan("test.boom", async () => { throw new Error("kaboom"); }))
      .rejects.toThrow("kaboom");
  });

  it("withSpan passes a span object to the fn", async () => {
    await withSpan("test.span-arg", async (span) => {
      expect(typeof span.setAttribute).toBe("function");
      expect(typeof span.end).toBe("function");
      expect(typeof span.recordException).toBe("function");
    });
  });

  it("tracedFetch reaches the network (mocked) and returns the response", async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    try {
      const res = await tracedFetch("https://example.test/hello");
      expect(res.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = realFetch;
    }
  });

  it("tracedFetch surfaces 5xx via the response object (not by throwing)", async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(new Response("oops", { status: 502 })) as unknown as typeof fetch;
    try {
      const res = await tracedFetch("https://example.test/down", { method: "POST" });
      expect(res.status).toBe(502);
    } finally {
      global.fetch = realFetch;
    }
  });

  it("tracedFetch preserves caller-supplied headers", async () => {
    const realFetch = global.fetch;
    const seen: Record<string, string> = {};
    global.fetch = jest.fn(async (_url, init: RequestInit | undefined) => {
      for (const [k, v] of new Headers(init?.headers).entries()) seen[k] = v;
      return new Response("");
    }) as unknown as typeof fetch;
    try {
      await tracedFetch("https://example.test/x", {
        method: "POST",
        headers: { "x-custom": "1", authorization: "Bearer abc" },
      });
      expect(seen["x-custom"]).toBe("1");
      expect(seen["authorization"]).toBe("Bearer abc");
    } finally {
      global.fetch = realFetch;
    }
  });

  it("activeTraceId returns undefined outside an active trace", () => {
    expect(activeTraceId()).toBeUndefined();
  });
});
