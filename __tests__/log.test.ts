/** @jest-environment node */
import { log } from "@/lib/log";

describe("structured logger", () => {
  let stderrSpy: jest.SpyInstance;
  let stdoutSpy: jest.SpyInstance;
  const lines: string[] = [];

  beforeEach(() => {
    lines.length = 0;
    stdoutSpy = jest
      .spyOn(console, "info")
      .mockImplementation((...args) => lines.push(String(args[0])));
    jest
      .spyOn(console, "debug")
      .mockImplementation((...args) => lines.push(String(args[0])));
    jest
      .spyOn(console, "warn")
      .mockImplementation((...args) => lines.push(String(args[0])));
    stderrSpy = jest
      .spyOn(console, "error")
      .mockImplementation((...args) => lines.push(String(args[0])));
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("emits valid JSON with ts/level/msg", () => {
    log.info("hello", { request_id: "abc" });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.request_id).toBe("abc");
    expect(parsed.ts).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("redacts sensitive top-level keys", () => {
    log.info("login", {
      email: "a@b.test",
      password: "supersecret-very-long-string",
      ml_service_token: "tok_abcdef123456",
    });
    const parsed = JSON.parse(lines[0]);
    expect(parsed.email).toBe("a@b.test");
    expect(parsed.password).not.toContain("supersecret");
    expect(parsed.ml_service_token).not.toContain("abcdef");
    expect(parsed.password).toBe("[redacted]");
    expect(JSON.stringify(parsed)).not.toContain("supe");
  });

  it("redacts case-insensitively", () => {
    log.info("h", { Authorization: "Bearer abc.def.ghi.long.token" });
    const parsed = JSON.parse(lines[0]);
    expect(String(parsed.Authorization)).toContain("[redacted]");
  });

  it("redacts secret-shaped keys by substring (token/secret/password/jwt)", () => {
    log.info("ext", {
      access_token: "ya29.aaaaaaaaaaaaaaaa",
      stripe_secret: "sk_live_bbbbbbbbbbbb",
      user_password: "hunter2-very-long-value",
      id_jwt: "eyJhbGciOi.cccccccccccc",
      // not secret-shaped → must pass through untouched
      monkey: "keyboard-not-a-secret",
    });
    const parsed = JSON.parse(lines[0]);
    expect(String(parsed.access_token)).toContain("[redacted]");
    expect(String(parsed.stripe_secret)).toContain("[redacted]");
    expect(String(parsed.user_password)).toContain("[redacted]");
    expect(String(parsed.id_jwt)).toContain("[redacted]");
    expect(parsed.monkey).toBe("keyboard-not-a-secret");
  });

  it("redacts nested keys", () => {
    log.warn("payload", {
      user: { email: "x@y.test", session: "deeply-nested-secret-cookie-value" },
    });
    const parsed = JSON.parse(lines[0]);
    expect(parsed.user.email).toBe("x@y.test");
    expect(String(parsed.user.session)).toContain("[redacted]");
  });

  it("child logger inherits bound fields", () => {
    const child = log.child({ trace_id: "trace-xyz" });
    child.info("event", { kind: "open" });
    const parsed = JSON.parse(lines[0]);
    expect(parsed.trace_id).toBe("trace-xyz");
    expect(parsed.kind).toBe("open");
  });

  it("exception() captures Error fields", () => {
    log.exception("boom", new Error("kaboom"), { request_id: "r1" });
    const parsed = JSON.parse(lines[0]);
    expect(parsed.level).toBe("error");
    expect(parsed.error.name).toBe("Error");
    expect(parsed.error.message).toBe("kaboom");
    expect(parsed.request_id).toBe("r1");
  });

  it("exception() tolerates non-Error throws", () => {
    log.exception("boom", { weird: true });
    const parsed = JSON.parse(lines[0]);
    expect(parsed.error.value).toContain("object");
  });

  it("caps recursive depth so cycles can't OOM", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cycle: any = { name: "loop" };
    cycle.self = cycle;
    log.info("cycle", { cycle });
    // We don't care about the exact rendering, just that we didn't
    // explode trying to stringify it.
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });
});
