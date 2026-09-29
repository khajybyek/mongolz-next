/**
 * /login?error=… — routine forced re-logins (session_rebind after the MFA
 * session-binding deploy, totp_enrolled after turning 2FA on) are info
 * notices, not red errors; real failures stay danger. Only known codes pick
 * copy, and prototype names in the query never resolve to anything.
 */
import fs from "node:fs";
import path from "node:path";
import { LOGIN_ERROR_KEYS, loginErrorKey, loginNoticeVariant } from "@/app/login/login-errors";

describe("loginNoticeVariant", () => {
  it("renders routine re-login notices as info", () => {
    expect(loginNoticeVariant("session_rebind")).toBe("info");
    expect(loginNoticeVariant("totp_enrolled")).toBe("info");
  });

  it("a session closed for a fingerprint change is a warning", () => {
    expect(loginNoticeVariant("session_pin")).toBe("warning");
  });

  it("keeps danger for real failures and for anything unknown", () => {
    for (const code of ["invalid_credentials", "too_many_attempts", "code_invalid", "server_config", "whatever", "", null, undefined]) {
      expect(loginNoticeVariant(code)).toBe("danger");
    }
  });

  it("prototype names do not resolve to a variant or a key", () => {
    for (const code of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(loginNoticeVariant(code)).toBe("danger");
      expect(loginErrorKey(code)).toBe("login_err_generic");
    }
  });
});

describe("loginErrorKey", () => {
  it("maps every known code and falls back to the generic line", () => {
    for (const [code, key] of Object.entries(LOGIN_ERROR_KEYS)) expect(loginErrorKey(code)).toBe(key);
    expect(loginErrorKey("nope")).toBe("login_err_generic");
  });

  it("the login page uses the variant for both of its alerts", () => {
    const page = fs.readFileSync(path.resolve(__dirname, "../app/login/page.tsx"), "utf8");
    expect(page).not.toContain('<Alert variant="danger">{errorText}</Alert>');
    expect(page.match(/<Alert variant=\{errorVariant\}>\{errorText\}<\/Alert>/g)).toHaveLength(2);
  });
});
