/**
 * SCH Esports — minimal XLSX reader for the sheet import.
 *
 * Google Sheets → File → Download → Microsoft Excel gives a workbook whose
 * first sheet is the form's response table. Only what that needs is read:
 * the first sheet, shared / inline strings, booleans, numbers and date-styled
 * serials (rendered "YYYY-MM-DD HH:mm:ss", which the import's timestamp
 * parser reads as Asia/Seoul wall-clock time — the same thing the sheet
 * shows). Formulas contribute their cached value, nothing is evaluated.
 *
 * Runs in the browser and in Node (JSZip + regular expressions, no DOM).
 * Guards: the file may be 5 MB at most and the entries read may inflate to
 * 20 MB in total, counted WHILE inflating so a lying zip header cannot get a
 * bomb past it.
 */
import JSZip from "jszip";
import { IMPORT_MAX_CELL, IMPORT_MAX_COLS, IMPORT_MAX_ROWS } from "./import-types";

export const XLSX_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const XLSX_MAX_INFLATED_BYTES = 20 * 1024 * 1024;

type StreamHelper = {
  on(event: "data", cb: (chunk: Uint8Array) => void): StreamHelper;
  on(event: "error", cb: (e: Error) => void): StreamHelper;
  on(event: "end", cb: () => void): StreamHelper;
  resume(): StreamHelper;
  pause(): StreamHelper;
};
type StreamableEntry = { internalStream(type: "uint8array"): StreamHelper };

/** Inflate one entry, giving up as soon as the shared budget is spent. */
function inflate(entry: JSZip.JSZipObject, budget: { left: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let done = false;
    const stream = (entry as unknown as StreamableEntry).internalStream("uint8array");
    stream
      .on("data", (chunk) => {
        if (done) return;
        size += chunk.length;
        budget.left -= chunk.length;
        if (budget.left < 0) {
          done = true;
          stream.pause();
          reject(new Error("xlsx_too_large"));
          return;
        }
        chunks.push(chunk);
      })
      .on("error", () => { if (!done) { done = true; reject(new Error("xlsx_invalid")); } })
      .on("end", () => {
        if (done) return;
        done = true;
        const all = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) { all.set(c, at); at += c.length; }
        resolve(new TextDecoder("utf-8").decode(all));
      })
      .resume();
  });
}

/* ─────────────────────────── tiny XML helpers ─────────────────────────── */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
      if (ref[0] !== "#") return ENTITIES[ref.toLowerCase()] ?? whole;
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    // OOXML escapes control characters as _xHHHH_
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return code === 0x0a || code === 0x0d || code === 0x09 ? String.fromCharCode(code) : "";
    });
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? decodeXml(m[1] ?? m[2] ?? "") : null;
}

/** Text of every <t> inside a string item; phonetic runs (<rPh>) are not text. */
function stringItemText(xml: string): string {
  const body = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
  let out = "";
  for (const m of body.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) out += decodeXml(m[1] ?? "");
  return out;
}

/* ─────────────────────────── dates ─────────────────────────── */

function isDateFormat(id: number, custom: Map<number, string>): boolean {
  if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return true;
  const code = custom.get(id);
  if (!code) return false;
  // literals ("text"), escapes (\x) and [colour]/[locale] blocks are not format letters
  const bare = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "");
  return /[dmyh]/i.test(bare);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Excel serial → "YYYY-MM-DD HH:mm:ss" (wall-clock, no zone). */
function serialToText(serial: number, date1904: boolean): string | null {
  const days = serial + (date1904 ? 1462 : 0);
  const ms = Math.round((days - 25569) * 86400) * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900 || d.getUTCFullYear() > 9999) return null;
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** "C5" → zero-based column 2; null when the reference is unusable. */
function columnOf(ref: string | null): number | null {
  const m = /^([A-Za-z]{1,3})\d*$/.exec(ref ?? "");
  if (!m) return null;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ─────────────────────────── reader ─────────────────────────── */

export type XlsxTable = { table: string[][]; truncated: boolean };

export async function readXlsxFirstSheetDetailed(data: ArrayBuffer | Uint8Array): Promise<XlsxTable> {
  if (data.byteLength > XLSX_MAX_FILE_BYTES) throw new Error("xlsx_too_large");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error("xlsx_invalid");
  }
  const budget = { left: XLSX_MAX_INFLATED_BYTES };
  const read = async (path: string, required: boolean): Promise<string | null> => {
    const entry = zip.file(path);
    if (!entry) {
      if (required) throw new Error("xlsx_invalid");
      return null;
    }
    return inflate(entry, budget);
  };

  try {
    const workbook = (await read("xl/workbook.xml", true)) as string;
    const date1904 = /<(?:\w+:)?workbookPr\b[^>]*\bdate1904\s*=\s*["'](1|true)["']/i.test(workbook);

    // first <sheet> → its relationship → the part that holds it
    const sheetTag = /<(?:\w+:)?sheet\b[^>]*>/.exec(workbook)?.[0];
    if (!sheetTag) throw new Error("xlsx_invalid");
    const relId = attr(sheetTag, "r:id") ?? attr(sheetTag, "\\w+:id");
    let sheetPath = "xl/worksheets/sheet1.xml";
    const rels = await read("xl/_rels/workbook.xml.rels", false);
    if (rels && relId) {
      for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
        if (attr(m[0], "Id") !== relId) continue;
        const target = attr(m[0], "Target");
        if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
        break;
      }
    }
    if (sheetPath.includes("..")) throw new Error("xlsx_invalid");

    const shared: string[] = [];
    const sharedXml = await read("xl/sharedStrings.xml", false);
    if (sharedXml) {
      for (const m of sharedXml.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) {
        shared.push(stringItemText(m[1] ?? ""));
      }
    }

    // cellXfs index → is that style a date?
    const dateStyle: boolean[] = [];
    const stylesXml = await read("xl/styles.xml", false);
    if (stylesXml) {
      const custom = new Map<number, string>();
      for (const m of stylesXml.matchAll(/<(?:\w+:)?numFmt\b[^>]*>/g)) {
        const id = Number(attr(m[0], "numFmtId"));
        if (Number.isInteger(id)) custom.set(id, attr(m[0], "formatCode") ?? "");
      }
      const xfs = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(stylesXml)?.[1] ?? "";
      for (const m of xfs.matchAll(/<(?:\w+:)?xf\b[^>]*>/g)) {
        dateStyle.push(isDateFormat(Number(attr(m[0], "numFmtId") ?? 0), custom));
      }
    }

    const sheet = (await read(sheetPath, true)) as string;
    const maxRows = IMPORT_MAX_ROWS + 1;
    const rows = new Map<number, string[]>();
    let truncated = false;
    let nextRow = 0;
    for (const rm of sheet.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
      const r = Number(attr(rm[1], "r"));
      const rowIndex = Number.isInteger(r) && r >= 1 ? r - 1 : nextRow;
      nextRow = rowIndex + 1;
      const cells: string[] = [];
      let nextCol = 0;
      for (const cm of (rm[2] ?? "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const col = columnOf(attr(cm[1], "r")) ?? nextCol;
        nextCol = col + 1;
        const body = cm[2] ?? "";
        const type = attr(cm[1], "t") ?? "n";
        const raw = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1];
        let text = "";
        if (type === "inlineStr") text = stringItemText(body);
        else if (raw === undefined) text = "";
        else if (type === "s") text = shared[Number(raw)] ?? "";
        else if (type === "str") text = decodeXml(raw);
        else if (type === "b") text = raw.trim() === "1" ? "TRUE" : "FALSE";
        else if (type === "e") text = "";
        else {
          const n = Number(raw);
          const style = Number(attr(cm[1], "s") ?? -1);
          if (!Number.isFinite(n)) text = decodeXml(raw);
          else text = (dateStyle[style] ? serialToText(n, date1904) : null) ?? String(n);
        }
        text = text.replace(/\r\n?/g, "\n").trim();
        if (!text) continue;
        if (col >= IMPORT_MAX_COLS) { truncated = true; continue; }
        if (text.length > IMPORT_MAX_CELL) { text = text.slice(0, IMPORT_MAX_CELL); truncated = true; }
        cells[col] = text;
      }
      if (cells.length) rows.set(rowIndex, cells);
    }

    // sheet order, empty rows dropped, rectangular — same shape parseDelimited() gives
    const ordered = [...rows.keys()].sort((a, b) => a - b);
    if (ordered.length > maxRows) truncated = true;
    const kept = ordered.slice(0, maxRows).map((i) => rows.get(i) as string[]);
    const width = kept.reduce((w, r) => Math.max(w, r.length), 0);
    const table = kept.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
    return { table, truncated };
  } catch (e) {
    if (e instanceof Error && e.message === "xlsx_too_large") throw e;
    throw new Error("xlsx_invalid");
  }
}

/** First sheet of a workbook as a table of trimmed strings. */
export async function readXlsxFirstSheet(data: ArrayBuffer | Uint8Array): Promise<string[][]> {
  return (await readXlsxFirstSheetDetailed(data)).table;
}
