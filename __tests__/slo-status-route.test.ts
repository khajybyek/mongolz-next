/** @jest-environment node */
/**
 * The public /api/slo-status body must not advertise a link that does not
 * resolve: it used to return `docs: "/docs/SLO.md"`, but docs/ is excluded
 * from the deployment (.vercelignore) and /docs is the admin-only in-app page,
 * so an unauthenticated monitor following it got a 307 to /login.
 */
jest.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

function failing(): unknown {
  const q: Record<string, unknown> = {};
  const self = () => q;
  for (const name of ["from", "select", "eq", "gte", "lte", "not", "is", "in", "order", "limit", "rpc"]) q[name] = self;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: { message: "offline" }, count: null });
  return q;
}

jest.mock("@/lib/supabase/server", () => ({ createServiceClient: () => failing() }));

describe("GET /api/slo-status", () => {
  it("answers without a dead docs link", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GET } = require("@/app/api/slo-status/route") as { GET: () => Promise<Response> };
    const res = await GET();
    const body = await res.json();
    expect(body).not.toHaveProperty("docs");
    expect(Array.isArray(body.slos)).toBe(true);
    expect(typeof body.status).toBe("string");
  });
});
