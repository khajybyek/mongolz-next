/** @jest-environment node */
/**
 * Passkey login and enrolment through the REAL @simplewebauthn/server — only
 * Supabase is stubbed (in memory). A software authenticator signs every
 * assertion, so origin, RP ID, challenge, UV, counter and topOrigin are all
 * checked by the library exactly as in production.
 *
 * The credential below is a row that HEAD's finishRegistration stored under
 * @simplewebauthn/server 13.3.3 (generated once with that version, not loaded
 * here): base64url COSE public key, base64url credential id. Passkeys enrolled
 * before the v14 upgrade are rows like this one, so a future major bump that
 * changes how the stored key is read fails here instead of at the login page.
 *
 * TEST-ONLY key pair: generated for this fixture, never enrolled anywhere.
 */
import crypto from "node:crypto";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  finishAuthentication,
  finishRegistration,
} from "@/lib/auth/webauthn";

const RP_ID = "aicctv.dev";
const ORIGIN = "https://aicctv.dev";
const USER = "11111111-2222-4333-8444-555555555555";

/** ES256 key of the fixture authenticator (P-256). */
const FIXTURE_JWK: crypto.JsonWebKey = {
  kty: "EC",
  crv: "P-256",
  x: "GYDCeVLMFW--64Ku9FfSjCCeKK8fEjNWvlqSZaXWcU4",
  y: "jhADzDP5KLMraJ3vhUKS9kV8Mh6SQqBp-Z1pzbDNVhU",
  d: "9OVeANFxwHqjun0VLUXXgNdptHZCcpCfuqW6gNpajEM",
};

/** The `webauthn_credentials` columns v13 wrote for that key. */
const V13_ROW = {
  credential_id: "Brg10wmeC8rsvBtnwKn9D0BYFlbF1aai9YyVB3JXTPw",
  public_key:
    "pQECAyYgASFYIBmAwnlSzBVvvuuCrvRX0owgniivHxIzVr5akmWl1nFOIlggjhADzDP5KLMraJ3vhUKS9kV8Mh6SQqBp-Z1pzbDNVhU",
  transports: ["internal", "hybrid"],
};

// ---- in-memory Supabase: just the query shapes lib/auth/webauthn.ts uses ----
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { webauthn_challenges: [], webauthn_credentials: [] };
let seq = 0;

function from(table: string) {
  let op: "select" | "insert" | "update" | "delete" = "select";
  let payload: Row = {};
  const filters: ((r: Row) => boolean)[] = [];
  let sort: { key: string; ascending: boolean } | null = null;
  let window: [number, number] | null = null;
  let single: "single" | "maybe" | null = null;

  const run = () => {
    const rows = tables[table]!;
    if (op === "insert") {
      seq += 1;
      // created_at / expires_at mirror the table defaults (challenges live 5 min).
      rows.push({
        id: `row-${seq}`,
        created_at: new Date(Date.now() + seq).toISOString(),
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        ...payload,
      });
      return { data: null, error: null };
    }
    let hit = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "delete") {
      tables[table] = rows.filter((r) => !hit.includes(r));
      return { data: null, error: null };
    }
    if (op === "update") {
      for (const r of hit) Object.assign(r, payload);
      return { data: null, error: null };
    }
    if (sort) {
      const { key, ascending } = sort;
      hit = [...hit].sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1) * (ascending ? 1 : -1));
    }
    if (window) hit = hit.slice(window[0], window[1] + 1);
    if (single) {
      const first = hit[0] ? { ...hit[0] } : null;
      return { data: first, error: first || single === "maybe" ? null : { message: "no rows" } };
    }
    return { data: hit.map((r) => ({ ...r })), error: null };
  };

  const q: Record<string, unknown> = {
    select: () => q,
    insert: (row: Row) => ((op = "insert"), (payload = row), q),
    update: (row: Row) => ((op = "update"), (payload = row), q),
    delete: () => ((op = "delete"), q),
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
    lt: (k: string, v: string) => (filters.push((r) => String(r[k]) < v), q),
    in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
    order: (key: string, o?: { ascending?: boolean }) => ((sort = { key, ascending: o?.ascending !== false }), q),
    limit: (n: number) => ((window = [0, n - 1]), q),
    range: (a: number, b: number) => ((window = [a, b]), q),
    single: () => ((single = "single"), q),
    maybeSingle: () => ((single = "maybe"), q),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve().then(run).then(resolve, reject),
  };
  return q;
}

jest.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({ from }) }));

// ---- software authenticator ---------------------------------------------
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest();
const fixtureKey = crypto.createPrivateKey({ key: FIXTURE_JWK, format: "jwk" });
const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

function counterBytes(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

interface Tamper {
  counter?: number;
  uv?: boolean;
  origin?: string;
  rpId?: string;
  clientData?: Row;
  key?: crypto.KeyObject;
}

/** An assertion shaped exactly like the body app/login/passkey-login-button.tsx posts. */
function assertion(challenge: string, t: Tamper = {}): AuthenticationResponseJSON {
  const flags = UP | (t.uv === false ? 0 : UV);
  const authData = Buffer.concat([sha256(Buffer.from(t.rpId ?? RP_ID)), Buffer.from([flags]), counterBytes(t.counter ?? 0)]);
  const clientData = Buffer.from(
    JSON.stringify({ type: "webauthn.get", challenge, origin: t.origin ?? ORIGIN, crossOrigin: false, ...t.clientData }),
  );
  // ECDSA over authData ‖ SHA-256(clientDataJSON), DER-encoded — what a real authenticator returns.
  const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientData)]), t.key ?? fixtureKey);
  return {
    id: V13_ROW.credential_id,
    rawId: V13_ROW.credential_id,
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64u(clientData),
      authenticatorData: b64u(authData),
      signature: b64u(signature),
      userHandle: b64u(Buffer.from(USER)),
    },
  };
}

/** A "none" attestation for the fixture key, shaped like app/(app)/settings/passkey-settings.tsx posts. */
function attestation(challenge: string, t: Pick<Tamper, "uv"> = {}): RegistrationResponseJSON {
  const credId = Buffer.from(V13_ROW.credential_id, "base64url");
  const idLen = Buffer.alloc(2);
  idLen.writeUInt16BE(credId.length);
  const flags = UP | AT | (t.uv === false ? 0 : UV);
  const authData = Buffer.concat([
    sha256(Buffer.from(RP_ID)),
    Buffer.from([flags]),
    counterBytes(0),
    Buffer.alloc(16), // AAGUID
    idLen,
    credId,
    Buffer.from(V13_ROW.public_key, "base64url"),
  ]);
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin: ORIGIN, crossOrigin: false }));
  const attestationObject = isoCBOR.encode(
    new Map<string, unknown>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", new Uint8Array(authData)],
    ]) as Parameters<typeof isoCBOR.encode>[0],
  );
  return {
    id: V13_ROW.credential_id,
    rawId: V13_ROW.credential_id,
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64u(clientData),
      attestationObject: b64u(attestationObject),
      transports: ["internal", "hybrid"],
    },
  };
}

function seedV13Credential(counter: number) {
  tables.webauthn_credentials.push({ id: "cred-1", user_id: USER, ...V13_ROW, counter, last_used_at: null });
}

const storedCounter = () => tables.webauthn_credentials[0]!.counter;

/** Ask for login options (which issues the challenge), then answer them. */
async function login(t: Tamper & { challenge?: string } = {}) {
  const opts = await buildAuthenticationOptions({ user_id: USER, host: RP_ID });
  return finishAuthentication({ user_id: USER, host: RP_ID, response: assertion(t.challenge ?? opts.challenge, t) });
}

const realOrigin = process.env.NEXT_PUBLIC_WEBAUTHN_ORIGIN;
beforeAll(() => {
  delete process.env.NEXT_PUBLIC_WEBAUTHN_ORIGIN;
});
afterAll(() => {
  if (realOrigin !== undefined) process.env.NEXT_PUBLIC_WEBAUTHN_ORIGIN = realOrigin;
});

beforeEach(() => {
  tables.webauthn_challenges = [];
  tables.webauthn_credentials = [];
});

describe("passkey login with a credential stored before the v14 upgrade", () => {
  it("accepts a valid assertion and records the new counter", async () => {
    seedV13Credential(0);
    const opts = await buildAuthenticationOptions({ user_id: USER, host: RP_ID });
    expect(opts.allowCredentials?.map((c) => c.id)).toEqual([V13_ROW.credential_id]);

    await expect(
      finishAuthentication({ user_id: USER, host: RP_ID, response: assertion(opts.challenge, { counter: 1 }) }),
    ).resolves.toEqual({ ok: true, credential_id: V13_ROW.credential_id });
    expect(storedCounter()).toBe(1);
    expect(tables.webauthn_credentials[0]!.last_used_at).toEqual(expect.any(String));
  });

  it("rejects a counter that did not advance, including a drop to 0", async () => {
    seedV13Credential(5);
    await expect(login({ counter: 5 })).rejects.toThrow(/counter/);
    await expect(login({ counter: 4 })).rejects.toThrow(/counter/);
    await expect(login({ counter: 0 })).rejects.toThrow(/counter/);
    expect(storedCounter()).toBe(5);

    await expect(login({ counter: 6 })).resolves.toMatchObject({ ok: true });
    expect(storedCounter()).toBe(6);
  });

  it("keeps accepting an authenticator that always reports 0", async () => {
    seedV13Credential(0);
    await expect(login({ counter: 0 })).resolves.toMatchObject({ ok: true });
    await expect(login({ counter: 0 })).resolves.toMatchObject({ ok: true });
  });

  it("rejects an assertion without user verification", async () => {
    seedV13Credential(0);
    await expect(login({ counter: 1, uv: false })).rejects.toThrow(/user could not be verified/);
  });

  it("rejects a wrong origin and a wrong RP ID", async () => {
    seedV13Credential(0);
    await expect(login({ counter: 1, origin: "https://evil.example" })).rejects.toThrow(/origin/);
    await expect(login({ counter: 1, rpId: "evil.example" })).rejects.toThrow(/RP ID/);
  });

  it("rejects a challenge the server never issued, and a used one", async () => {
    seedV13Credential(0);
    const forged = b64u(crypto.randomBytes(32));
    await expect(login({ counter: 1, challenge: forged })).rejects.toThrow(/Challenge expired or missing/);

    const opts = await buildAuthenticationOptions({ user_id: USER, host: RP_ID });
    await finishAuthentication({ user_id: USER, host: RP_ID, response: assertion(opts.challenge, { counter: 1 }) });
    await expect(
      finishAuthentication({ user_id: USER, host: RP_ID, response: assertion(opts.challenge, { counter: 2 }) }),
    ).rejects.toThrow(/Challenge expired or missing/);
  });

  it("rejects a topOrigin, same-origin or cross-origin (no expectedTopOrigin is configured)", async () => {
    seedV13Credential(0);
    await expect(login({ counter: 1, clientData: { topOrigin: "https://evil.example" } })).rejects.toThrow(
      /top origin/,
    );
    await expect(
      login({ counter: 1, clientData: { crossOrigin: true, topOrigin: "https://evil.example" } }),
    ).rejects.toThrow(/top origin/);
  });

  it("rejects a signature from another key", async () => {
    seedV13Credential(0);
    const other = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    await expect(login({ counter: 1, key: other })).rejects.toThrow(/assertion verification failed/);
    expect(storedCounter()).toBe(0);
  });
});

describe("passkey enrolment", () => {
  it("stores the same row v13 stored for the same authenticator", async () => {
    const opts = await buildRegistrationOptions({
      user_id: USER,
      user_email: "admin@test",
      host: RP_ID,
      existingCredentialIds: [],
    });
    await finishRegistration({ user_id: USER, host: RP_ID, response: attestation(opts.challenge) });

    expect(tables.webauthn_credentials).toHaveLength(1);
    expect(tables.webauthn_credentials[0]).toMatchObject({ user_id: USER, counter: 0, ...V13_ROW });
  });

  it("refuses a credential created without user verification", async () => {
    const opts = await buildRegistrationOptions({
      user_id: USER,
      user_email: "admin@test",
      host: RP_ID,
      existingCredentialIds: [],
    });
    await expect(
      finishRegistration({ user_id: USER, host: RP_ID, response: attestation(opts.challenge, { uv: false }) }),
    ).rejects.toThrow(/user could not be verified/);
    expect(tables.webauthn_credentials).toHaveLength(0);
  });
});
