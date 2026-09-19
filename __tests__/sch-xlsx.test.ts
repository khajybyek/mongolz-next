/**
 * SCH Esports — XLSX reader: a workbook built here with JSZip goes through
 * readXlsxFirstSheet() and on into the import, plus the size guards.
 */
import JSZip from "jszip";
import { buildCandidates, guessMapping, looksLikeHeader } from "@/lib/sch/import";
import { IMPORT_MAX_COLS, IMPORT_MAX_ROWS } from "@/lib/sch/import-types";
import {
  XLSX_MAX_FILE_BYTES,
  readXlsxFirstSheet,
  readXlsxFirstSheetDetailed,
} from "@/lib/sch/xlsx";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

type Parts = {
  sheet: string;
  shared?: string[]; // raw <si> bodies
  styles?: string;
  workbook?: string;
  rels?: string | null;
  sheetPath?: string;
};

async function workbook(p: Parts): Promise<Uint8Array> {
  const zip = new JSZip();
  const sheetPath = p.sheetPath ?? "xl/worksheets/sheet1.xml";
  zip.file(
    "xl/workbook.xml",
    p.workbook ??
      `${XML}<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="Form Responses 1" sheetId="1" r:id="rId7"/><sheet name="Other" sheetId="2" r:id="rId8"/></sheets></workbook>`,
  );
  if (p.rels !== null) {
    zip.file(
      "xl/_rels/workbook.xml.rels",
      p.rels ??
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId8" Type="x" Target="worksheets/other.xml"/>` +
          `<Relationship Id="rId7" Type="x" Target="${sheetPath.replace(/^xl\//, "")}"/></Relationships>`,
    );
  }
  if (p.shared) {
    zip.file("xl/sharedStrings.xml", `${XML}<sst ${NS}>${p.shared.map((s) => `<si>${s}</si>`).join("")}</sst>`);
  }
  if (p.styles) zip.file("xl/styles.xml", p.styles);
  zip.file(sheetPath, `${XML}<worksheet ${NS}><cols><col min="1" max="1"/></cols><sheetData>${p.sheet}</sheetData></worksheet>`);
  zip.file("xl/worksheets/other.xml", `${XML}<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>WRONG SHEET</t></is></c></row></sheetData></worksheet>`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// cellXfs: 0 General, 1 built-in date-time (22), 2 custom date, 3 custom number with a quoted "d"
const STYLES =
  `${XML}<styleSheet ${NS}><numFmts count="2">` +
  `<numFmt numFmtId="164" formatCode="[$-409]m/d/yyyy\\ h:mm:ss"/>` +
  `<numFmt numFmtId="165" formatCode="0.0&quot;d&quot;"/></numFmts>` +
  `<cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs>` +
  `<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="22" applyNumberFormat="1"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs>` +
  `</styleSheet>`;

// 2026-09-17 14:03:22 as an Excel serial
const SERIAL = 46282 + (14 * 3600 + 3 * 60 + 22) / 86400;

describe("readXlsxFirstSheet", () => {
  test("shared / inline strings, rich text, entities, booleans, numbers, dates, sparse cells", async () => {
    const data = await workbook({
      shared: [
        "<t>Цагийн тэмдэг</t>",
        "<t>Овог Нэр</t>",
        '<r><rPr><b/></rPr><t xml:space="preserve">Бат </t></r><r><t>Болд</t></r><rPh sb="0" eb="1"><t>IGNORED</t></rPh>',
        "<t>Tom &amp; Jerry &lt;3 &#x41;&#66; line_x000D__x000A_two</t>",
        "<t/>",
      ],
      styles: STYLES,
      sheet:
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Inline</t></is></c></row>` +
        `<row r="2"><c r="A2" s="1"><v>${SERIAL}</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>4</v></c>` +
        `<c r="D2" t="b"><v>1</v></c><c r="E2"><v>1012345678</v></c><c r="F2" s="3"><v>1.5</v></c></row>` +
        `<row r="3"/>` +
        `<row r="5"><c r="C5" t="s"><v>3</v></c><c r="A5" s="2"><v>46282</v></c><c r="G5" t="str"><f>A1&amp;B1</f><v>calc &amp; ed</v></c>` +
        `<c r="H5" t="e"><v>#N/A</v></c><c r="I5" s="0"><v>1.2E3</v></c></row>`,
    });
    const t = await readXlsxFirstSheet(data);
    expect(t).toEqual([
      ["Цагийн тэмдэг", "Овог Нэр", "", "Inline", "", "", "", "", ""],
      ["2026-09-17 14:03:22", "Бат Болд", "", "TRUE", "1012345678", "1.5", "", "", ""],
      ["2026-09-17 00:00:00", "", "Tom & Jerry <3 AB line\ntwo", "", "", "", "calc & ed", "", "1200"],
    ]);
  });

  test("accepts an ArrayBuffer, an absolute relationship target and cells without references", async () => {
    const data = await workbook({
      sheetPath: "xl/worksheets/responses.xml",
      rels:
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId7" Target="/xl/worksheets/responses.xml"/></Relationships>`,
      sheet: `<row><c t="inlineStr"><is><t>a</t></is></c><c t="inlineStr"><is><t>b</t></is></c></row><row><c><v>1</v></c></row>`,
    });
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    expect(await readXlsxFirstSheet(buf)).toEqual([["a", "b"], ["1", ""]]);
  });

  test("falls back to sheet1.xml without a relationships part; 1904 date system", async () => {
    const data = await workbook({
      rels: null,
      styles: STYLES,
      workbook: `${XML}<workbook ${NS}><workbookPr date1904="1"/><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      sheet: `<row r="1"><c r="A1" s="1"><v>${46282 - 1462}</v></c></row>`,
    });
    expect(await readXlsxFirstSheet(data)).toEqual([["2026-09-17 00:00:00"]]);
  });

  test("a form export goes straight into the import", async () => {
    const header = ["Timestamp", "Овог Нэр", "Имэйл", "Холбоо барих Facebook хаяг", "Оролцох тоглоом", "Highest Rank", "Тоглодог role/position", "ID"];
    const values = ["Ану Цогт", "anu@example.com", "Anu Tsogt", "Mobile Legends", "Epic II", "Jungle, Roamer", "987654321 (4321)"];
    const inline = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
    const cols = "ABCDEFGH";
    const data = await workbook({
      styles: STYLES,
      sheet:
        `<row r="1">${header.map((h, i) => inline(`${cols[i]}1`, h)).join("")}</row>` +
        `<row r="2"><c r="A2" s="2"><v>${SERIAL}</v></c>${values.map((v, i) => inline(`${cols[i + 1]}2`, v)).join("")}</row>`,
    });
    const table = await readXlsxFirstSheet(data);
    expect(looksLikeHeader(table[0])).toBe(true);
    const mapping = guessMapping(table[0], table.slice(1));
    expect(mapping).toEqual(["timestamp", "full_name", "email", "facebook", "game", "ml_rank", "ml_roles", "ml_id"]);
    const [c] = buildCandidates({ table, mapping, hasHeader: true });
    expect(c.issues).toEqual([]);
    expect(c.submitted_at).toBe("2026-09-17T05:03:22.000Z"); // the sheet shows KST wall-clock time
    expect(c.entries[0]).toMatchObject({ game: "mobile_legends", rank: "Epic" });
  });

  test("caps rows and columns and reports the truncation", async () => {
    const rows = Array.from({ length: IMPORT_MAX_ROWS + 4 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`);
    const tall = await readXlsxFirstSheetDetailed(await workbook({ sheet: rows.join("") }));
    expect(tall.table).toHaveLength(IMPORT_MAX_ROWS + 1);
    expect(tall.truncated).toBe(true);

    const wide = await readXlsxFirstSheetDetailed(
      await workbook({ sheet: `<row r="1"><c r="A1"><v>1</v></c><c r="CZ1"><v>2</v></c></row>` }),
    );
    expect(wide.table).toEqual([["1"]]);
    expect(wide.table[0].length).toBeLessThanOrEqual(IMPORT_MAX_COLS);
    expect(wide.truncated).toBe(true);

    const fine = await readXlsxFirstSheetDetailed(await workbook({ sheet: `<row r="1"><c r="A1"><v>1</v></c></row>` }));
    expect(fine.truncated).toBe(false);
  });

  test("rejects a file over 5 MB before unzipping", async () => {
    await expect(readXlsxFirstSheet(new Uint8Array(XLSX_MAX_FILE_BYTES + 1))).rejects.toThrow("xlsx_too_large");
  });

  test("zip-bomb guard: a small file whose sheet inflates beyond 20 MB", async () => {
    const filler = `<row r="1"><c r="A1" t="inlineStr"><is><t>${"A".repeat(21 * 1024 * 1024)}</t></is></c></row>`;
    const data = await workbook({ sheet: filler });
    expect(data.byteLength).toBeLessThan(XLSX_MAX_FILE_BYTES);
    await expect(readXlsxFirstSheet(data)).rejects.toThrow("xlsx_too_large");
  });

  test("malformed workbooks → xlsx_invalid", async () => {
    await expect(readXlsxFirstSheet(new TextEncoder().encode("not a zip"))).rejects.toThrow("xlsx_invalid");

    const noWorkbook = new JSZip();
    noWorkbook.file("hello.txt", "hi");
    await expect(readXlsxFirstSheet(await noWorkbook.generateAsync({ type: "uint8array" }))).rejects.toThrow("xlsx_invalid");

    const noSheets = await workbook({ workbook: `${XML}<workbook ${NS}><sheets/></workbook>`, sheet: "" });
    await expect(readXlsxFirstSheet(noSheets)).rejects.toThrow("xlsx_invalid");

    const missingPart = await workbook({
      rels:
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId7" Target="worksheets/gone.xml"/></Relationships>`,
      sheet: "",
    });
    await expect(readXlsxFirstSheet(missingPart)).rejects.toThrow("xlsx_invalid");

    const traversal = await workbook({
      rels:
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId7" Target="../../etc/passwd"/></Relationships>`,
      sheet: "",
    });
    await expect(readXlsxFirstSheet(traversal)).rejects.toThrow("xlsx_invalid");
  });

  test("an empty sheet is an empty table", async () => {
    expect(await readXlsxFirstSheet(await workbook({ sheet: "" }))).toEqual([]);
  });
});
