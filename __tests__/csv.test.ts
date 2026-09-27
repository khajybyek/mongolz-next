import { csvCell, csvDocument, CSV_CONTENT_TYPE, UTF8_BOM } from "@/lib/csv";

describe("csvDocument", () => {
  const bomCount = (s: string) => s.split(UTF8_BOM).length - 1;

  it("prepends the UTF-8 BOM so Excel decodes Cyrillic and Hangul", () => {
    const doc = csvDocument("name\nБат\n김민준\n");
    expect(doc.startsWith(UTF8_BOM)).toBe(true);
    expect(doc.slice(1)).toBe("name\nБат\n김민준\n");
    expect([...Buffer.from(doc, "utf8").subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("adds the BOM exactly once, even when applied twice", () => {
    expect(bomCount(csvDocument("a,b\n"))).toBe(1);
    expect(bomCount(csvDocument(csvDocument("a,b\n")))).toBe(1);
    expect(csvDocument("")).toBe(UTF8_BOM);
  });

  it("keeps formula neutralisation on the first cell behind the BOM", () => {
    const doc = csvDocument([csvCell("=cmd|' /C calc'!A0"), csvCell("ok")].join(","));
    expect(doc).toBe(`${UTF8_BOM}"'=cmd|' /C calc'!A0",ok`);
  });

  it("pairs with a Content-Type that names the charset", () => {
    expect(CSV_CONTENT_TYPE).toBe("text/csv; charset=utf-8");
  });
});

describe("csvCell", () => {
  it("passes plain values through", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes separators and doubles quotes", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("neutralises spreadsheet formulas", () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell("+1")).toBe('"\'+1"');
    expect(csvCell("-1")).toBe('"\'-1"');
    expect(csvCell("@SUM")).toBe('"\'@SUM"');
    expect(csvCell("\tcmd")).toBe('"\'\tcmd"');
  });
});
