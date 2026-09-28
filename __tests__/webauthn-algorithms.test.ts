/** @jest-environment node */
/**
 * Passkey key algorithms are pinned, not left to @simplewebauthn/server.
 *
 * Since v14 the library's default adds ML-DSA-44 (COSE -48) whenever the
 * runtime can verify it (Node 24.7+). A passkey enrolled that way fails
 * closed at every login once the runtime moves below that version, so
 * lib/auth/webauthn.ts offers — and accepts at enrolment — the classical
 * set only. Production and CI run Node 24.x, but whether a given 24.x build
 * verifies ML-DSA depends on its minor version, so the runtime capability is
 * simulated here rather than left to the machine running the test.
 */
import { getDefaultSupportedAlgorithmIDs } from "@simplewebauthn/server";
import { buildRegistrationOptions, finishRegistration } from "@/lib/auth/webauthn";

const USER = "11111111-2222-4333-8444-555555555555";
const CLASSICAL = [-8, -7, -257]; // EdDSA, ES256, RS256
const ML_DSA_44 = -48;

const verifyRegistrationResponse = jest.fn();
jest.mock("@simplewebauthn/server", () => ({
  ...jest.requireActual("@simplewebauthn/server"),
  verifyRegistrationResponse: (...args: unknown[]) => verifyRegistrationResponse(...args),
}));

// Every Supabase call the register path makes, answered by one stub: the
// challenge lookup finds a live row, every write succeeds.
jest.mock("@/lib/supabase/server", () => {
  const row = { id: "c1", challenge: "CHALLENGE", expires_at: new Date(Date.now() + 60_000).toISOString() };
  const result = { data: row, error: null };
  const query: Record<string, unknown> = {};
  for (const m of ["from", "select", "delete", "insert", "eq", "lt", "in", "order", "limit", "range", "maybeSingle"]) {
    query[m] = () => query;
  }
  query.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return { createServiceClient: () => query };
});

const subtle = globalThis.SubtleCrypto as unknown as { supports?: (op: string, alg: string) => boolean };
const realSupports = subtle.supports;

beforeAll(() => {
  // A runtime that can verify ML-DSA-44 — what Vercel on Node 24.7+ is.
  subtle.supports = (op: string, alg: string) => (op === "verify" && alg === "ML-DSA-44") || Boolean(realSupports?.(op, alg));
});

afterAll(() => {
  if (realSupports) subtle.supports = realSupports;
  else delete subtle.supports;
});

describe("passkey algorithm pinning", () => {
  it("runs against a runtime where the library default WOULD offer ML-DSA-44", () => {
    // Guards the test itself: without this, the assertions below would pass
    // on a runtime without ML-DSA even if the pin were removed.
    expect(getDefaultSupportedAlgorithmIDs()).toContain(ML_DSA_44);
  });

  it("offers only EdDSA, ES256 and RS256 at enrolment", async () => {
    const opts = await buildRegistrationOptions({
      user_id: USER,
      user_email: "admin@test",
      host: "aicctv.dev",
      existingCredentialIds: [],
    });
    expect(opts.pubKeyCredParams.map((p) => p.alg)).toEqual(CLASSICAL);
  });

  it("verifies enrolment against the same list it offered", async () => {
    verifyRegistrationResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo: { credential: { id: "cred", publicKey: new Uint8Array([1]), counter: 0, transports: [] } },
    });

    await finishRegistration({
      user_id: USER,
      host: "aicctv.dev",
      response: {} as Parameters<typeof finishRegistration>[0]["response"],
    });

    expect(verifyRegistrationResponse).toHaveBeenCalledTimes(1);
    const [options] = verifyRegistrationResponse.mock.calls[0] as [{ supportedAlgorithmIDs?: number[]; requireUserVerification?: boolean }];
    expect(options.supportedAlgorithmIDs).toEqual(CLASSICAL);
    expect(options.requireUserVerification).toBe(true);
  });
});
