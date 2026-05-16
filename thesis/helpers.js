const {
  Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat,
  Table, TableRow, TableCell, BorderStyle, WidthType, ShadingType,
  PageBreak, TabStopType, TabStopPosition,
} = require("docx");

// 한국 학위논문 표준 — 신명조 10pt 본문, 줄간격 200%, 양쪽 정렬, 첫 줄 들여쓰기 2 글자
// 장 제목 : 신명조 16pt bold, 가운데 정렬, 페이지 분리
// 절 제목 : 신명조 13pt bold, 왼쪽 정렬
// 항 제목 : 신명조 11pt bold, 왼쪽 정렬

const KFONT_BODY    = "신명조";  // body Korean
const KFONT_HEAD    = "신명조";  // headings Korean (some 학교 uses 휴먼고딕)
const EFONT         = "Times New Roman";

const border = { style: BorderStyle.SINGLE, size: 4, color: "888888" };
const borders = { top: border, bottom: border, left: border, right: border };

// 장 (Chapter) — 제○장 형식, 가운데, 페이지 분리, 위 큰 여백
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    alignment: AlignmentType.CENTER,
    spacing: { before: 1440, after: 720, line: 400 },  // 1 inch top, 0.5 inch bottom
    children: [new TextRun({ text, bold: true, size: 32, font: KFONT_HEAD })],  // 16pt
  });
}

// 절 (Section) — 1.1, 1.2 등
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    alignment: AlignmentType.LEFT,
    spacing: { before: 480, after: 240, line: 400 },
    children: [new TextRun({ text, bold: true, size: 26, font: KFONT_HEAD })],  // 13pt
  });
}

// 항 (Subsection) — 1.1.1 등
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    alignment: AlignmentType.LEFT,
    spacing: { before: 360, after: 180, line: 400 },
    children: [new TextRun({ text, bold: true, size: 22, font: KFONT_HEAD })],  // 11pt
  });
}

// 목 (Sub-subsection)
function h4(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_4,
    alignment: AlignmentType.LEFT,
    spacing: { before: 240, after: 120, line: 400 },
    children: [new TextRun({ text, bold: true, italics: true, size: 20, font: KFONT_HEAD })],  // 10pt
  });
}

// 본문 paragraph — 양쪽 정렬, 첫 줄 들여쓰기 2 글자(약 200 DXA), 줄간격 200%
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { line: 400, after: 0 },  // 200% line spacing (Korean standard)
    alignment: opts.center ? AlignmentType.CENTER
              : opts.left ? AlignmentType.LEFT
              : AlignmentType.JUSTIFIED,
    indent: opts.noIndent || opts.center ? undefined : { firstLine: 400 },
    children: [new TextRun({
      text,
      bold: opts.bold,
      italics: opts.italic,
      size: opts.size || 20,  // 10pt default
      font: KFONT_BODY,
    })],
  });
}

function blank() {
  return new Paragraph({
    spacing: { line: 400 },
    children: [new TextRun({ text: "", size: 20, font: KFONT_BODY })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { line: 360, after: 80 },
    children: [new TextRun({ text, size: 20, font: KFONT_BODY })],
  });
}

function num(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "numbers", level },
    spacing: { line: 360, after: 80 },
    children: [new TextRun({ text, size: 20, font: KFONT_BODY })],
  });
}

function code(text) {
  return new Paragraph({
    spacing: { line: 280, before: 120, after: 120 },
    shading: { type: ShadingType.CLEAR, fill: "F2F2F2" },
    children: [new TextRun({ text, font: "Consolas", size: 18 })],
  });
}

function quote(text) {
  return new Paragraph({
    indent: { left: 720, right: 720 },
    spacing: { line: 360, before: 120, after: 120 },
    alignment: AlignmentType.JUSTIFIED,
    children: [new TextRun({ text, italics: true, size: 20, font: KFONT_BODY })],
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function cell(text, opts = {}) {
  return new TableCell({
    borders,
    width: { size: opts.width || 2340, type: WidthType.DXA },
    shading: opts.header ? { type: ShadingType.CLEAR, fill: "D9E2F3" } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { line: 280 },
      children: [new TextRun({
        text, bold: opts.header || opts.bold,
        size: 18, font: KFONT_BODY,
      })],
    })],
  });
}

function table(rows, widths) {
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) =>
      new TableRow({
        children: r.map((c, j) =>
          cell(c, { header: i === 0, width: widths[j], center: i === 0 })
        ),
      })
    ),
  });
}

// 표 / 그림 캡션 — 표 X-Y 형식, 가운데, 작은 글씨, bold
function caption(label, title, kind = "표") {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120, line: 320 },
    children: [
      new TextRun({ text: `<${kind} ${label}> `, bold: true, size: 19, font: KFONT_BODY }),
      new TextRun({ text: title, size: 19, font: KFONT_BODY }),
    ],
  });
}

// 표 + 캡션을 하나로
function captionedTable(label, title, rows, widths) {
  return [caption(label, title, "표"), table(rows, widths)];
}

function tocLine(label, page, opts = {}) {
  return new Paragraph({
    spacing: { line: 360, after: 80 },
    indent: opts.indent ? { left: opts.indent } : undefined,
    tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
    children: [
      new TextRun({ text: label, size: 20, font: KFONT_BODY, bold: opts.bold }),
      new TextRun({ text: `\t${page}`, size: 20, font: KFONT_BODY, bold: opts.bold }),
    ],
  });
}

// 표지용 매우 큰 가운데 텍스트
function bigCenter(text, size = 40, bold = true, font = KFONT_HEAD) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { line: 480, after: 240 },
    children: [new TextRun({ text, bold, size, font })],
  });
}

module.exports = {
  h1, h2, h3, h4, p, blank, bullet, num, code, quote, pageBreak,
  cell, table, tocLine, caption, captionedTable, bigCenter,
  KFONT_BODY, KFONT_HEAD, EFONT,
};
