// Build Korean 졸업논문 standard .docx
// - Section 1: 표지/속표지/인준서 (no page number)
// - Section 2: 감사의 글/국문초록/목차/표목차/그림목차 (Roman numerals ⅰ, ⅱ, ⅲ ...)
// - Section 3: 본문 + 참고문헌 + 부록 + Abstract (Arabic numerals 1, 2, 3 ...)
//
// Page setup : A4 (11906 × 16838 DXA)
//   여백 : 위 30mm(1701), 아래 25mm(1418), 좌 30mm(1701), 우 25mm(1418)
// Fonts : 본문 신명조 10pt, 장 제목 16pt bold, 절 13pt, 항 11pt
// Line spacing : 줄간격 200% (line=400 DXA)

const path = require("path");
const fs = require("fs");

const {
  Document, Packer, Paragraph, TextRun, Header, Footer, AlignmentType,
  PageOrientation, LevelFormat, PageNumber, HeadingLevel,
  TabStopType, TabStopPosition, SectionType, NumberFormat,
  PageBreak,
} = require("docx");

const {
  cover, innerCover, approval, acknowledgments,
  abstractKR, toc, listOfTables, listOfFigures,
} = require("./frontmatter");
const ch1 = require("./ch1");
const ch2 = require("./ch2");
const ch3 = require("./ch3");
const ch4 = require("./ch4");
const ch5 = require("./ch5");
const ch6 = require("./ch6");
const ch7 = require("./ch7");
const ch8 = require("./ch8");
const ch9 = require("./ch9");
const { references, appendixA, appendixB, appendixC } = require("./backmatter");
const { abstractEN } = require("./abstract_en");

// ───── 공통 페이지 속성 (A4 + 한국 학위논문 표준 여백) ─────
const PAGE_A4 = {
  size: { width: 11906, height: 16838 },
  margin: {
    top:    1701,   // 30 mm
    right:  1418,   // 25 mm
    bottom: 1418,   // 25 mm
    left:   1701,   // 30 mm
    header:  720,
    footer:  720,
  },
};

// ───── Section 1 : 표지/속표지/인준서  ─────  (페이지 번호 없음)
const section1 = {
  properties: {
    type: SectionType.NEXT_PAGE,
    page: PAGE_A4,
    titlePage: false,
  },
  children: [
    ...cover,
    ...innerCover,
    ...approval,
  ],
};

// ───── Section 2 : 감사의 글 ~ 그림 목차  ─────  (로마자 ⅰ, ⅱ, ⅲ ...)
const section2 = {
  properties: {
    type: SectionType.NEXT_PAGE,
    page: {
      ...PAGE_A4,
      pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN },
    },
  },
  footers: {
    default: new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "- ", size: 20, font: "신명조" }),
            new TextRun({ children: [PageNumber.CURRENT], size: 20, font: "신명조" }),
            new TextRun({ text: " -", size: 20, font: "신명조" }),
          ],
        }),
      ],
    }),
  },
  children: [
    ...acknowledgments,
    ...abstractKR,
    ...toc,
    ...listOfTables,
    ...listOfFigures,
  ],
};

// ───── Section 3 : 본문 + 참고문헌 + 부록 + Abstract  ─────  (아라비아 숫자 1, 2, 3 ...)
const section3 = {
  properties: {
    type: SectionType.NEXT_PAGE,
    page: {
      ...PAGE_A4,
      pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
    },
  },
  headers: {
    default: new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 0 },
          children: [
            new TextRun({
              text: "MONGOLZ Security — 다중 권한 마스킹 및 복원이 가능한 지능형 네트워크 카메라 및 통합관제 서버",
              size: 18, italics: true, font: "신명조",
            }),
          ],
        }),
      ],
    }),
  },
  footers: {
    default: new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "- ", size: 20, font: "신명조" }),
            new TextRun({ children: [PageNumber.CURRENT], size: 20, font: "신명조" }),
            new TextRun({ text: " -", size: 20, font: "신명조" }),
          ],
        }),
      ],
    }),
  },
  children: [
    ...ch1, ...ch2, ...ch3, ...ch4, ...ch5,
    ...ch6, ...ch7, ...ch8, ...ch9,
    ...references,
    ...appendixA, ...appendixB, ...appendixC,
    ...abstractEN,
  ],
};

const doc = new Document({
  creator: "MONGOLZ Security Capstone",
  title: "다중 권한 마스킹 및 복원이 가능한 지능형 네트워크 카메라 및 통합관제 서버 개발",
  subject: "학사학위 청구논문",
  description: "졸업논문 — Korean academic standard",
  styles: {
    default: {
      document: { run: { font: "신명조", size: 20 } },
    },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1",
        basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "신명조" },
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: 1440, after: 720, line: 400 },
          outlineLevel: 0,
        },
      },
      {
        id: "Heading2", name: "Heading 2",
        basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "신명조" },
        paragraph: {
          spacing: { before: 480, after: 240, line: 400 },
          outlineLevel: 1,
        },
      },
      {
        id: "Heading3", name: "Heading 3",
        basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "신명조" },
        paragraph: {
          spacing: { before: 360, after: 180, line: 400 },
          outlineLevel: 2,
        },
      },
      {
        id: "Heading4", name: "Heading 4",
        basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 20, bold: true, italics: true, font: "신명조" },
        paragraph: {
          spacing: { before: 240, after: 120, line: 400 },
          outlineLevel: 3,
        },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          {
            level: 0, format: LevelFormat.BULLET, text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
          {
            level: 1, format: LevelFormat.BULLET, text: "◦",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } },
          },
        ],
      },
      {
        reference: "numbers",
        levels: [
          {
            level: 0, format: LevelFormat.DECIMAL, text: "(%1)",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  },
  sections: [section1, section2, section3],
});

const outPath = path.join(__dirname, "MONGOLZ_Security_졸업논문.docx");
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  const stats = fs.statSync(outPath);
  console.log(`✓ docx written: ${outPath}`);
  console.log(`  size: ${(stats.size / 1024).toFixed(1)} KB`);
}).catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
