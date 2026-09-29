/**
 * The recovery codes returned by enrolment/regeneration must actually reach
 * the operator. Before this, the settings card ignored `recovery_codes`,
 * auto-redirected after 15 s to a misleading session_pin error, and nothing
 * in the app ever called /api/auth/totp/recovery/regenerate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecoveryCodes, recoveryCodesText } from "@/app/(app)/settings/recovery-codes";
import { T } from "@/lib/i18n/translations";

const CODES = ["ABCDE-12345", "FGHIJ-67890"];

describe("RecoveryCodes", () => {
  it("renders every code and the confirmation button", () => {
    const html = renderToStaticMarkup(
      createElement(RecoveryCodes, { codes: CODES, email: "a@b", confirmLabel: "OK-SAVED", onConfirm: () => {} }),
    );
    for (const c of CODES) expect(html).toContain(c);
    expect(html).toContain("OK-SAVED");
  });

  it("builds a download file that lists the codes one per line", () => {
    const text = recoveryCodesText(CODES, "a@b");
    expect(text.split("\n")).toEqual(expect.arrayContaining(CODES));
  });
});

describe("TotpSettings wiring", () => {
  const src = readFileSync(join(__dirname, "..", "app", "(app)", "settings", "totp-settings.tsx"), "utf8");

  it("shows the enrolment codes instead of redirecting on a timer", () => {
    expect(src).toContain("data.recovery_codes");
    expect(src).not.toMatch(/setTimeout\([^)]*router\.push/);
    expect(src).not.toContain("error=session_pin");
    expect(src).toContain("/login?error=totp_enrolled");
  });

  it("offers regeneration through the regenerate route", () => {
    expect(src).toContain("/api/auth/totp/recovery/regenerate");
  });

  it("has the login message for a completed enrolment in every language", () => {
    // The ?error= code → copy map moved out of page.tsx into login-errors.ts.
    const login = readFileSync(join(__dirname, "..", "app", "login", "login-errors.ts"), "utf8");
    expect(login).toMatch(/totp_enrolled:\s*"login_err_totp_enrolled"/);
    for (const lang of ["mn", "en", "kr"] as const) {
      expect(T.login_err_totp_enrolled[lang].length).toBeGreaterThan(0);
      expect(T.set_totp_regen[lang].length).toBeGreaterThan(0);
    }
  });
});
