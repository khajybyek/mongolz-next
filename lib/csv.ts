/**
 * CSV cell encoder with spreadsheet-formula neutralisation.
 *
 * Excel / LibreOffice evaluate a cell that starts with `=`, `+`, `-`, `@`
 * (and after a tab / CR) even inside quotes. Audit rows contain attacker-
 * controlled text (the identifier typed at a failed login, the raw
 * User-Agent), so an export could carry `=HYPERLINK(...)` / DDE payloads to
 * the admin who opens it. Prefix such cells with a single quote (the
 * conventional "treat as text" marker) and always quote them.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : String(v);
  const risky = FORMULA_TRIGGER.test(s);
  if (risky) s = "'" + s;
  if (risky || /[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
