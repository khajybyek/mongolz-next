/**
 * @jest-environment node
 *
 * POST /auth/logout — ends this browser's session only.
 *
 * A global sign-out revoked every session of the account, so logging out on a
 * laptop also kicked the same account off the camera wall. Supabase clients
 * are mocked at the module boundary; the route code runs for real.
 */
import { NextRequest } from "next/server";

const signOut = jest.fn(async (_opts?: unknown) => ({ error: null }));
const auditInsert = jest.fn(async (_row: Record<string, unknown>) => ({ error: null }));
const clearSessionPin = jest.fn(async () => undefined);
let currentUser: { id: string; email: string } | null = { id: "u-1", email: "op@x" };

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: currentUser } }),
      signOut: (opts?: unknown) => signOut(opts),
    },
  })),
  createServiceClient: jest.fn(() => ({
    from: () => ({ insert: (row: Record<string, unknown>) => auditInsert(row) }),
  })),
}));

jest.mock("@/lib/auth/session-pin", () => ({
  clearSessionPin: () => clearSessionPin(),
}));

import * as route from "@/app/auth/logout/route";

function post() {
  return route.POST(new NextRequest("https://aicctv.dev/auth/logout", { method: "POST" }));
}

beforeEach(() => {
  signOut.mockClear();
  auditInsert.mockClear();
  clearSessionPin.mockClear();
  currentUser = { id: "u-1", email: "op@x" };
});

describe("POST /auth/logout", () => {
  it("signs out with local scope so other devices keep their session", async () => {
    await post();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("redirects to /login with 303 and clears cached site data", async () => {
    const res = await post();
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
    expect(res.headers.get("clear-site-data")).toBe('"cache", "storage"');
  });

  it("writes one LOGOUT audit row and clears the session pin", async () => {
    await post();
    expect(auditInsert).toHaveBeenCalledTimes(1);
    expect(auditInsert.mock.calls[0][0]).toMatchObject({ action: "LOGOUT", user_id: "u-1" });
    expect(clearSessionPin).toHaveBeenCalledTimes(1);
  });

  it("still signs out locally and redirects when there is no user", async () => {
    currentUser = null;
    const res = await post();
    expect(auditInsert).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(res.status).toBe(303);
  });

  it("exposes no GET handler (a cross-site navigation must not log out)", () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });
});
