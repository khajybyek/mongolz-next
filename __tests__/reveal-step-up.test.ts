/**
 * Reveal modal step 2 — the step-up factor.
 *
 * The owner signs in with a passkey and does not remember the account
 * password, and step 2 used to accept only the password. It now offers the
 * authenticator code (POST /api/auth/reauth/totp, which mints the stronger
 * factor=totp cookie that /api/reveal/start already accepts) and keeps the
 * password as it was. No route changed and no server check was relaxed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LangProvider } from "@/lib/i18n/client";
import { T, t as translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import {
  TOTP_CODE_LENGTH,
  TOTP_INPUT_MAX_LENGTH,
  defaultRevealStepUpFactor,
  normalizeTotpInput,
  revealStep2Mode,
  revealStepUpFactors,
  revealStepUpIsFresh,
  revealStepUpReady,
  submitRevealStepUp,
  submitTotpStepUp,
  totpStepUpErrorText,
  type RevealStepUpFactor,
} from "@/lib/step-up-client";
import { REVEAL_START_ERROR_KEYS, revealStartRefusal } from "@/lib/reveal-errors";
import { RevealStepUpFields } from "@/app/(app)/playback/[id]/reveal-step-up-fields";

const en = (key: TranslationKey) => translate(key, "en");
/** React's text escaping, so copy can be looked up in static markup. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const realFetch = global.fetch;
let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});

function render(props: Partial<Parameters<typeof RevealStepUpFields>[0]> & { factor: RevealStepUpFactor }, lang: Lang = "en") {
  const el = createElement(RevealStepUpFields, {
    totpEnabled: true,
    onFactorChange: () => {},
    code: "",
    onCodeChange: () => {},
    password: "",
    onPasswordChange: () => {},
    busy: false,
    ...props,
  });
  return renderToStaticMarkup(createElement(LangProvider, { initial: lang, children: el }));
}

describe("factor choice and default", () => {
  it("an operator with TOTP enrolled gets both factors, the authenticator code first", () => {
    expect(revealStepUpFactors(true)).toEqual(["totp", "password"]);
    expect(defaultRevealStepUpFactor(true)).toBe("totp");
  });

  it("without TOTP only the password is offered", () => {
    expect(revealStepUpFactors(false)).toEqual(["password"]);
    expect(defaultRevealStepUpFactor(false)).toBe("password");
  });

  it("renders the switch with the authenticator code selected, and a one-time-code input", () => {
    const html = render({ factor: "totp" });
    expect(html).toContain("data-reveal-factors");
    expect(html).toContain(`aria-label="${esc(en("pb_reauth_factor_label"))}"`);
    expect(html).toMatch(/data-factor="totp" aria-pressed="true"/);
    expect(html).toMatch(/data-factor="password" aria-pressed="false"/);
    expect(html).toContain(esc(en("pb_reauth_factor_totp")));
    expect(html).toContain(esc(en("login_pass")));
    // The code field: numeric keypad, OTP autofill, room for a pasted code
    // with separators (normalizeTotpInput keeps the six digits).
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain(`maxLength="${TOTP_INPUT_MAX_LENGTH}"`);
    expect(html).not.toContain('type="password"');
    expect(html).toContain(esc(en("pb_reauth_note_totp")));
    expect(html).toContain('data-reauth-note="totp"');
  });

  it("switching to the password shows the unchanged password field and its note", () => {
    const html = render({ factor: "password" });
    expect(html).toMatch(/data-factor="totp" aria-pressed="false"/);
    expect(html).toMatch(/data-factor="password" aria-pressed="true"/);
    expect(html).toContain('type="password"');
    expect(html).toContain(`placeholder="${esc(en("login_pass"))}"`);
    expect(html).not.toContain("one-time-code");
    expect(html).toContain(esc(en("pb_reauth_note")));
    expect(html).toContain('data-reauth-note="password"');
  });

  it("without TOTP there is no switch — only the password", () => {
    const html = render({ totpEnabled: false, factor: "password" });
    expect(html).not.toContain("data-reveal-factors");
    expect(html).not.toContain("data-factor=");
    expect(html).toContain('type="password"');
    expect(html).not.toContain("one-time-code");
  });

  it("a busy step disables the switch and the field", () => {
    const html = render({ factor: "totp", busy: true });
    expect(html.match(/<button[^>]*disabled=""/g)?.length).toBe(2);
    expect(html).toMatch(/<input[^>]*disabled=""/);
  });

  it.each(["mn", "kr"] as const)("renders translated labels and notes in %s", (lang) => {
    const html = render({ factor: "totp" }, lang);
    expect(html).toContain(esc(T.pb_reauth_factor_totp[lang]));
    expect(html).toContain(esc(T.login_pass[lang]));
    expect(html).toContain(esc(T.pb_reauth_note_totp[lang]));
  });
});

describe("authenticator code path", () => {
  it("keeps digits only, one code long", () => {
    expect(normalizeTotpInput("12 34-56")).toBe("123456");
    expect(normalizeTotpInput("1234567890")).toBe("123456");
    expect(normalizeTotpInput("abc")).toBe("");
  });

  // The browser clips a paste to the input's maxLength BEFORE onChange runs,
  // so the helper only ever sees the clipped text. With maxLength = 6 a pasted
  // "123 456" arrived as "123 45" and Confirm stayed disabled.
  it.each(["123 456", "123-456", "12 34 56", " 123 456 ", "123456", "123\u00a0456"])(
    "a pasted %j survives the field's maxLength and becomes a full code",
    (pasted) => {
      const rendered = Number(/maxLength="(\d+)"/.exec(render({ factor: "totp" }))?.[1]);
      expect(rendered).toBe(TOTP_INPUT_MAX_LENGTH);
      const clipped = pasted.slice(0, rendered);
      expect(normalizeTotpInput(clipped)).toBe("123456");
      expect(revealStepUpReady("totp", { code: normalizeTotpInput(clipped), password: "" })).toBe(true);
    },
  );

  it("the old cap of one code length is what broke a spaced paste", () => {
    expect(normalizeTotpInput("123 456".slice(0, TOTP_CODE_LENGTH))).toBe("12345");
    expect(TOTP_INPUT_MAX_LENGTH).toBeGreaterThan(TOTP_CODE_LENGTH);
  });

  it("the TOTP prompt uses the same roomy maxLength", () => {
    const prompt = readFileSync(join(__dirname, "..", "components", "totp-prompt.tsx"), "utf8");
    expect(prompt).toContain("maxLength={TOTP_INPUT_MAX_LENGTH}");
    expect(prompt).not.toMatch(/maxLength=\{6\}/);
  });

  it("is ready only with a full code; the password needs any input", () => {
    expect(revealStepUpReady("totp", { code: "12345", password: "x" })).toBe(false);
    expect(revealStepUpReady("totp", { code: "123456", password: "" })).toBe(true);
    expect(revealStepUpReady("password", { code: "123456", password: "" })).toBe(false);
    expect(revealStepUpReady("password", { code: "", password: "p" })).toBe(true);
  });

  it("posts the code to the existing TOTP step-up route and succeeds on 200", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, expires_at: "2026-09-30T00:15:00Z" }));
    const result = await submitRevealStepUp("totp", { code: "123456", password: "ignored" }, en);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/reauth/totp");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ code: "123456" });
    // The password never leaves the page on this path.
    expect(init.body).not.toContain("ignored");
  });

  const cases: Array<[string, number, unknown, string]> = [
    ["wrong code", 401, { error: "Код буруу", code: "invalid" }, en("totp_prompt_invalid")],
    ["replayed code", 401, { error: "used", code: "replayed" }, en("totp_prompt_invalid")],
    ["session refused (no code)", 401, { error: "session_invalid" }, en("totp_prompt_session_expired")],
    ["TOTP not enabled", 400, { error: "TOTP_NOT_ENABLED" }, en("totp_prompt_not_enabled")],
    ["admin without TOTP", 403, { error: "totp_required" }, en("totp_prompt_not_enabled")],
    ["server config", 503, { error: "server_config" }, en("totp_prompt_server_config")],
    ["rate limited", 429, { error: "x", code: "rate_limited", retry_after_sec: 41.2 }, `${en("rl_too_many_attempts")} (42 s)`],
    ["rate limited without a window", 429, { code: "rate_limited" }, en("rl_too_many_attempts")],
    ["unparseable body", 500, undefined, en("totp_prompt_invalid")],
  ];

  it.each(cases)("maps a refusal: %s", async (_name, status, body, expected) => {
    fetchMock.mockResolvedValue(json(status, body));
    await expect(submitRevealStepUp("totp", { code: "123456", password: "" }, en)).resolves.toEqual({
      ok: false,
      error: expected,
    });
  });

  it("never echoes a raw server string", () => {
    expect(totpStepUpErrorText(401, { error: "Код буруу", code: "invalid" }, en)).not.toContain("Код");
  });

  it("a network failure is a translated refusal, not a throw", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(submitTotpStepUp("123456", en)).resolves.toEqual({ ok: false, error: en("totp_prompt_network_err") });
  });
});

describe("password path (unchanged)", () => {
  it("posts the password to /api/auth/reauth and succeeds on 200", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await expect(submitRevealStepUp("password", { code: "", password: "hunter22" }, en)).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/reauth");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ password: "hunter22" });
  });

  it("keeps its refusal handling: server text, server_config, generic fallback", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: "Нууц үг буруу" }));
    await expect(submitRevealStepUp("password", { code: "", password: "x" }, en)).resolves.toEqual({ ok: false, error: "Нууц үг буруу" });
    fetchMock.mockResolvedValueOnce(json(503, { error: "server_config" }));
    await expect(submitRevealStepUp("password", { code: "", password: "x" }, en)).resolves.toEqual({ ok: false, error: en("totp_prompt_server_config") });
    fetchMock.mockResolvedValueOnce(json(500, undefined));
    await expect(submitRevealStepUp("password", { code: "", password: "x" }, en)).resolves.toEqual({ ok: false, error: en("pb_reauth_failed") });
  });

  it("a network failure still throws, as it always did (the modal shows the message)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(submitRevealStepUp("password", { code: "", password: "x" }, en)).rejects.toThrow("Failed to fetch");
  });
});

describe("no second prompt within 15 minutes", () => {
  it("a live step-up of either factor still opens a reveal request", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { valid: true, factor: "totp" }));
    await expect(revealStepUpIsFresh()).resolves.toBe(true);
    fetchMock.mockResolvedValueOnce(json(200, { valid: true, factor: "password" }));
    await expect(revealStepUpIsFresh()).resolves.toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/auth/reauth");
    expect(fetchMock.mock.calls[0]![1]?.method).toBeUndefined(); // GET — mints nothing
  });

  it("passes the modal's abort signal to the GET, and an abort answers false", async () => {
    const precheck = new AbortController();
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      expect(init.signal).toBe(precheck.signal);
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    precheck.abort();
    await expect(revealStepUpIsFresh(precheck.signal)).resolves.toBe(false);
    expect(fetchMock.mock.calls[0]![1]).toEqual({ cache: "no-store", signal: precheck.signal });
  });

  it("anything else asks", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { valid: false, factor: null }));
    await expect(revealStepUpIsFresh()).resolves.toBe(false);
    fetchMock.mockResolvedValueOnce(json(403, { error: "totp_required" }));
    await expect(revealStepUpIsFresh()).resolves.toBe(false);
    fetchMock.mockResolvedValueOnce(json(200, { valid: true, factor: "passkey" }));
    await expect(revealStepUpIsFresh()).resolves.toBe(false);
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(revealStepUpIsFresh()).resolves.toBe(false);
  });

  it("each note promises only what its factor's cookie opens", () => {
    for (const lang of ["mn", "en", "kr"] as const) {
      expect(T.pb_reauth_note_totp[lang]).toContain("15");
      expect(T.pb_reauth_note[lang]).toContain("15");
    }
    // A password step-up opens reveal requests only, so its note says so.
    expect(T.pb_reauth_note.en).toMatch(/Reveal requests won't ask again/);
    expect(T.pb_reauth_note.mn).toContain("reveal хүсэлт");
    expect(T.pb_reauth_note.kr).toContain("공개 요청");
  });

  it("the stepper pill names neither factor", () => {
    expect(T.pb_step_auth.mn).not.toContain("Нууц үг");
    expect(T.pb_step_auth.en).not.toMatch(/password/i);
    expect(T.pb_step_auth.kr).not.toContain("비밀번호");
  });
});

describe("wiring", () => {
  const dir = join(__dirname, "..", "app", "(app)", "playback", "[id]");
  const modal = readFileSync(join(dir, "reveal-modal.tsx"), "utf8");

  it("the modal defaults the factor from the server-known TOTP flag", () => {
    expect(modal).toContain("useState<RevealStepUpFactor>(() => defaultRevealStepUpFactor(totpEnabled))");
    expect(modal).toContain("totpEnabled = false,");
    expect(modal).toContain("<RevealStepUpFields");
  });

  it("step 2 verifies with the chosen factor, then starts (or resumes) the job", () => {
    const body = modal.slice(modal.indexOf("async function submitReauth"), modal.indexOf("async function startRevealJob"));
    const verify = body.indexOf("submitRevealStepUp(factor, { code, password }, t)");
    const refuse = body.indexOf("if (!verified.ok) throw new Error(verified.error)");
    const start = body.indexOf("await startRevealJob()", refuse);
    expect(verify).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(verify);
    expect(start).toBeGreaterThan(refuse);
    // The route calls live in lib/step-up-client.ts, nowhere else in the modal.
    expect(modal).not.toContain('fetch("/api/auth/reauth');
  });

  it("the page passes the profile's TOTP flag through the player", () => {
    expect(readFileSync(join(dir, "page.tsx"), "utf8")).toContain("totpEnabled={profile.totp_enabled === true}");
    expect(readFileSync(join(dir, "playback-player.tsx"), "utf8")).toContain("totpEnabled={totpEnabled}");
  });

  it("the TOTP prompt reads its refusal copy from the same helper", () => {
    const prompt = readFileSync(join(__dirname, "..", "components", "totp-prompt.tsx"), "utf8");
    expect(prompt).toContain("submitTotpStepUp(code, t)");
    expect(prompt).not.toContain('fetch("/api/auth/reauth/totp"');
  });

  it("the helper only talks to the two existing step-up routes", () => {
    const lib = readFileSync(join(__dirname, "..", "lib", "step-up-client.ts"), "utf8");
    const urls = [...lib.matchAll(/fetch\("([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(urls)).toEqual(new Set(["/api/auth/reauth/totp", "/api/auth/reauth"]));
  });
});

describe("step 2 shape: a fresh step-up confirms, it never submits by itself", () => {
  it("fresh and no job yet → confirm only; otherwise verify", () => {
    expect(revealStep2Mode(true, false)).toBe("confirm");
    expect(revealStep2Mode(false, false)).toBe("verify");
    // Resuming a job: the server already refused the step-up — always verify.
    expect(revealStep2Mode(true, true)).toBe("verify");
    expect(revealStep2Mode(false, true)).toBe("verify");
  });

  it("the confirm-only step renders no factor switch and no credential field", () => {
    for (const lang of ["mn", "en", "kr"] as const) {
      const html = render({ confirmOnly: true, factor: "totp" }, lang);
      expect(html).toContain('data-reauth-note="fresh"');
      expect(html).toContain(esc(T.pb_reauth_note_fresh[lang]));
      expect(html).not.toContain("<input");
      expect(html).not.toContain("data-reveal-factors");
      expect(html).toContain("15");
    }
    // The verify shape is unchanged when the flag is off.
    expect(render({ confirmOnly: false, factor: "totp" })).toContain('id="reveal-totp-code"');
  });

  it("the confirm note says the request still goes to a second admin", () => {
    expect(T.pb_reauth_note_fresh.en).toMatch(/second admin/);
    expect(T.pb_reauth_note_fresh.mn).toContain("2 дахь админ");
    expect(T.pb_reauth_note_fresh.kr).toContain("두 번째 관리자");
  });
});

describe("reveal request refusals land where the operator can act", () => {
  it("REAUTH_REQUIRED returns to step 2 with the re-auth message", () => {
    expect(revealStartRefusal("REAUTH_REQUIRED")).toEqual({ step: "reauth", errorKey: "pb_reveal_err_reauth" });
  });

  it.each([
    ["RATE_LIMITED", "pb_reveal_err_rate"],
    ["NO_ORIGINAL", "pb_reveal_err_no_original"],
    ["START_FAILED", "pb_reveal_start_failed"],
    ["INVALID_WINDOW", "pb_reveal_err_window"],
  ] as const)("%s returns to step 1 with its own message", (code, key) => {
    expect(revealStartRefusal(code)).toEqual({ step: "method", errorKey: key });
  });

  it("no code, an unknown code or a prototype key reads as 'could not start'", () => {
    for (const code of [undefined, null, "", "SOMETHING_NEW", "constructor", "__proto__", "toString"]) {
      expect(revealStartRefusal(code)).toEqual({ step: "method", errorKey: "pb_reveal_start_failed" });
    }
  });

  it("every code the route sends is mapped, to a key that exists in mn/en/kr", () => {
    const route = readFileSync(join(__dirname, "..", "app", "api", "reveal", "start", "route.ts"), "utf8");
    const codes = new Set([...route.matchAll(/code: "([A-Z_]+)"/g)].map((m) => m[1]!));
    expect(codes.size).toBeGreaterThan(10);
    for (const code of codes) {
      const known = code === "REAUTH_REQUIRED" || Object.prototype.hasOwnProperty.call(REVEAL_START_ERROR_KEYS, code);
      expect([code, known]).toEqual([code, true]);
      const { errorKey } = revealStartRefusal(code);
      for (const lang of ["mn", "en", "kr"] as const) expect(T[errorKey][lang]).toBeTruthy();
    }
  });
});

describe("modal wiring of the fresh step-up and the refusals", () => {
  const modal = readFileSync(join(__dirname, "..", "app", "(app)", "playback", "[id]", "reveal-modal.tsx"), "utf8");
  const fn = (name: string, next: string) => modal.slice(modal.indexOf(`async function ${name}`), modal.indexOf(next));

  it("Continue checks the step-up, then always goes to step 2 — it never starts the job", () => {
    const body = fn("continueToReauth", "function chooseFactor");
    const check = body.indexOf("await revealStepUpIsFresh(precheck.signal)");
    const aborted = body.indexOf("if (precheck.signal.aborted) return;");
    const fresh = body.indexOf("setStepUpFresh(fresh)");
    const step2 = body.indexOf('setStep("reauth")');
    expect(check).toBeGreaterThan(-1);
    expect(aborted).toBeGreaterThan(check);
    expect(fresh).toBeGreaterThan(aborted);
    expect(step2).toBeGreaterThan(aborted);
    expect(body).not.toContain("startRevealJob");
  });

  it("step 2's shape comes from revealStep2Mode, and confirm mode submits without a credential", () => {
    expect(modal).toContain("const step2Mode = revealStep2Mode(stepUpFresh, job !== null);");
    expect(modal).toContain('confirmOnly={step2Mode === "confirm"}');
    const body = fn("submitReauth", "async function startRevealJob");
    const confirm = body.indexOf('if (step2Mode === "confirm")');
    const start = body.indexOf("await startRevealJob()", confirm);
    const verify = body.indexOf("submitRevealStepUp(");
    expect(confirm).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(confirm);
    expect(verify).toBeGreaterThan(start);
    // Confirm is enabled without a credential only in confirm mode.
    expect(modal).toContain('disabled={busy || (step2Mode === "verify" && !revealStepUpReady(factor, { code, password }))}');
  });

  it("nothing sends a reveal request once the modal has closed", () => {
    const body = fn("startRevealJob", "// Job status polling");
    const guard = body.indexOf("if (!aliveRef.current) return;");
    const post = body.indexOf('fetch("/api/reveal/start"');
    expect(guard).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(guard);
    // Unmount flips the flag and aborts a pre-check still in flight.
    expect(modal).toMatch(/return \(\) => \{\s*aliveRef\.current = false;\s*precheckRef\.current\?\.abort\(\);\s*\};/);
  });

  it("a refused request goes where revealStartRefusal says, REAUTH_REQUIRED clearing the fresh flag", () => {
    const body = fn("startRevealJob", "// Job status polling");
    expect(body).toContain("const refusal = revealStartRefusal(code);");
    expect(body).toContain("setError(t(refusal.errorKey));");
    expect(body).toContain('if (refusal.step === "reauth") setStepUpFresh(false);');
    expect(body).toContain("setStep(refusal.step);");
    expect(body).not.toContain('setStep("method")');
    // Network failures are refusals too, never a raw exception message.
    expect(body).toMatch(/catch \{\s*refuse\(undefined\);/);
  });

  it("step 1 shows the refusal, and its Cancel waits while busy like step 2's", () => {
    const step1 = modal.slice(modal.indexOf('{step === "method" && ('), modal.indexOf("STEP 2: Re-auth"));
    expect(step1).toMatch(/\{error && \(\s*<div role="alert"[^>]*>\s*\{error\}/);
    expect(step1).toContain('<button onClick={onClose} className="btn-ghost flex-1" disabled={busy}>');
  });
});
