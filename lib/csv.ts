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

/**
 * UTF-8 byte-order mark. Excel opens a BOM-less CSV in the machine's legacy
 * code page (Windows-1252, CP949, ...), so Mongolian Cyrillic and Korean
 * cells arrive as mojibake. The BOM is the signal Excel honours; other
 * readers (LibreOffice, pandas, Numbers, `TextDecoder`) strip it.
 */
export const UTF8_BOM = "\uFEFF";

/** Content-Type for every CSV the app serves; always paired with `csvDocument`. */
export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

/**
 * A finished CSV document, ready to be a response body: prefixed with the
 * UTF-8 BOM exactly once (idempotent: a body that already starts with it is
 * returned unchanged). Cells must already be encoded with `csvCell`, which is
 * where formula neutralisation happens; the BOM sits before the first cell
 * and does not change how any cell is encoded.
 *
 * A streaming export must instead enqueue `UTF8_BOM` as its first chunk.
 */
export function csvDocument(csv: string): string {
  return csv.startsWith(UTF8_BOM) ? csv : UTF8_BOM + csv;
}
