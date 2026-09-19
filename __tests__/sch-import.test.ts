/**
 * SCH Esports — sheet import (pure part): delimited parser, header / mapping
 * guess, normalisation, timestamps and the deterministic submission ids.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCandidates,
  firstHttpsUrl,
  guessMapping,
  isTrustedReceiptUrl,
  looksLikeHeader,
  normaliseDotaRank,
  normaliseDotaRoles,
  normaliseFaceit,
  normaliseMlRank,
  normaliseMlRoles,
  parseDelimited,
  parseDelimitedDetailed,
  parseGames,
  parseTimestamp,
  schImportInputSchema,
} from "@/lib/sch/import";
import { importSubmissionId } from "@/lib/sch/import-id";
import {
  IMPORT_MAX_CELL,
  IMPORT_MAX_COLS,
  IMPORT_MAX_ROWS,
  type ImportField,
  type ImportMapping,
} from "@/lib/sch/import-types";
import { UUID_V4_RE } from "@/lib/sch/schema";

const FIXTURE = readFileSync(join(__dirname, "fixtures", "sch-google-form.csv"), "utf8");

const FORM_MAPPING: ImportMapping = [
  "timestamp", "full_name", "email", "facebook", "phone", "game",
  "ml_rank", "ml_roles", "ml_id",
  "cs2_premier", "cs2_steam", "cs2_faceit",
  "dota_roles", "dota_rank", "dota_steam",
  "receipt",
];

/** One data row laid out like FORM_MAPPING. */
function formRow(cells: Partial<Record<ImportField, string>>): string[] {
  return FORM_MAPPING.map((f) => cells[f] ?? "");
}
const PERSON = { timestamp: "9/17/2026 14:03:22", full_name: "Тест Хүн", email: "test@example.com", facebook: "fb.com/test" };
const one = (cells: Partial<Record<ImportField, string>>) =>
  buildCandidates({ table: [formRow({ ...PERSON, ...cells })], mapping: FORM_MAPPING, hasHeader: false })[0];

describe("parseDelimited", () => {
  test("plain CSV, CRLF / LF / CR line ends, trimmed cells", () => {
    expect(parseDelimited("a, b ,c\r\n1,2,3\n4,5,6\r7,8,9")).toEqual([
      ["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"],
    ]);
  });

  test("quoted cells: delimiter, doubled quote, embedded newline", () => {
    const t = parseDelimited('name,note\r\n"Bold, Bat","said ""hi""\r\nsecond line"\r\n');
    expect(t).toEqual([["name", "note"], ["Bold, Bat", 'said "hi"\nsecond line']]);
  });

  test("strips a BOM and drops fully empty rows", () => {
    expect(parseDelimited("\uFEFFa,b\n,\n\n  ,  \n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("detects tab, semicolon and comma from the first record outside quotes", () => {
    expect(parseDelimited("a\tb, c\td\n1\t2\t3")).toEqual([["a", "b, c", "d"], ["1", "2", "3"]]);
    expect(parseDelimited("a;b;c\n1,5;2;3")).toEqual([["a", "b", "c"], ["1,5", "2", "3"]]);
    expect(parseDelimited('"x;y;z;w",b\n1,2')).toEqual([["x;y;z;w", "b"], ["1", "2"]]);
    expect(parseDelimited("single\nvalue")).toEqual([["single"], ["value"]]);
  });

  test("a quote inside an unquoted cell is literal", () => {
    expect(parseDelimited('5" screen,ok')).toEqual([['5" screen', "ok"]]);
  });

  test("pads short rows so the table is rectangular", () => {
    expect(parseDelimited("a,b,c\n1")).toEqual([["a", "b", "c"], ["1", "", ""]]);
  });

  test("an unterminated quote still yields the cell", () => {
    expect(parseDelimited('a,"b\nc')).toEqual([["a", "b\nc"]]);
  });

  test("caps rows, columns and cell length and says so", () => {
    expect(parseDelimitedDetailed("a,b\n1,2").truncated).toBe(false);

    const rows = ["h"].concat(Array.from({ length: IMPORT_MAX_ROWS + 5 }, (_, i) => `r${i}`)).join("\n");
    const byRows = parseDelimitedDetailed(rows);
    expect(byRows.table).toHaveLength(IMPORT_MAX_ROWS + 1);
    expect(byRows.truncated).toBe(true);

    const wide = Array.from({ length: IMPORT_MAX_COLS + 3 }, (_, i) => `c${i}`).join(",");
    const byCols = parseDelimitedDetailed(wide);
    expect(byCols.table[0]).toHaveLength(IMPORT_MAX_COLS);
    expect(byCols.truncated).toBe(true);

    const long = parseDelimitedDetailed(`${"x".repeat(IMPORT_MAX_CELL + 10)},y`);
    expect(long.table[0][0]).toHaveLength(IMPORT_MAX_CELL);
    expect(long.truncated).toBe(true);
  });

  test("the fixture parses to a 16-column table with its quoted cells intact", () => {
    const t = parseDelimited(FIXTURE);
    expect(t).toHaveLength(13);
    expect(t.every((r) => r.length === 16)).toBe(true);
    expect(t[2][9]).toBe("15,200");
    expect(t[8][3]).toBe('fb.com/saraa.m,\nSaraa "Sara" Munkh');
    expect(t[2][15]).toContain("1AbCdEfGh02, https://");
  });

  test("the same sheet pasted from Google Sheets (TSV, only multi-line cells quoted)", () => {
    const t = parseDelimited(FIXTURE);
    const tsv = t
      .map((r) => r.map((c) => (/[\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join("\t"))
      .join("\n");
    expect(parseDelimited(tsv)).toEqual(t);
  });
});

describe("looksLikeHeader", () => {
  test("form headers in mn / en / kr", () => {
    expect(looksLikeHeader(parseDelimited(FIXTURE)[0])).toBe(true);
    expect(looksLikeHeader(["Timestamp", "Full name", "Email address"])).toBe(true);
    expect(looksLikeHeader(["타임스탬프", "이름", "이메일"])).toBe(true);
  });
  test("a data row is not a header", () => {
    expect(looksLikeHeader(parseDelimited(FIXTURE)[1])).toBe(false);
    expect(looksLikeHeader(["Бат Болд", "bat@example.com", "Mobile Legends"])).toBe(false);
    expect(looksLikeHeader(["2026-09-17 14:03:22", "Бат", "x"])).toBe(false);
    expect(looksLikeHeader(["", ""])).toBe(false);
  });
});

describe("guessMapping", () => {
  test("the Google-Form fixture: every column, including both role and both Steam columns", () => {
    const t = parseDelimited(FIXTURE);
    expect(guessMapping(t[0], t.slice(1))).toEqual(FORM_MAPPING);
  });

  test("titles alone are enough (no sample rows)", () => {
    expect(guessMapping(parseDelimited(FIXTURE)[0], [])).toEqual(FORM_MAPPING);
  });

  test("English header variant", () => {
    const headers = [
      "Timestamp", "Full name", "Email Address", "Facebook profile", "Phone number", "Which game?",
      "Highest Rank", "Role / position", "In-game ID",
      "Premier Rank", "Steam Profile URL", "Do you have FACEIT?",
      "Role / position", "MMR medal", "Steam Profile URL", "Payment receipt", "Comments",
    ];
    expect(guessMapping(headers, [])).toEqual([...FORM_MAPPING, "ignore"]);
  });

  test("Korean header variant", () => {
    const headers = [
      "타임스탬프", "이름", "이메일", "페이스북 주소", "전화번호", "참가 게임",
      "Highest Rank", "포지션", "ID",
      "Premier Rank", "Steam Profile URL", "FACEIT 있나요?",
      "포지션", "MMR medal", "Steam Profile URL", "입금 영수증",
    ];
    expect(guessMapping(headers, [])).toEqual(FORM_MAPPING);
  });

  test("a single role / Steam column goes to the section it sits in", () => {
    const headers = ["Имэйл", "Овог Нэр", "Тоглодог role/position", "MMR medal", "Steam Profile URL"];
    expect(guessMapping(headers, [])).toEqual(["email", "full_name", "dota_roles", "dota_rank", "dota_steam"]);
    const cs = ["Имэйл", "Steam Profile URL", "FACEIT байгаа юу?"];
    expect(guessMapping(cs, [])).toEqual(["email", "cs2_steam", "cs2_faceit"]);
  });

  test("values overrule a misleading order of duplicated titles", () => {
    const headers = ["Имэйл", "Тоглодог role/position", "Тоглодог role/position"];
    const sample = [
      ["a@example.com", "Position 1 (Carry)", ""],
      ["b@example.com", "", "Gold Lane, Jungle"],
    ];
    expect(guessMapping(headers, sample)).toEqual(["email", "dota_roles", "ml_roles"]);
  });

  test("a header-less paste is mapped from its values and the form order", () => {
    const rows = parseDelimited(FIXTURE).slice(1);
    expect(guessMapping([], rows)).toEqual(FORM_MAPPING);
  });

  test("Dota-only sample rows with \"Position 2 (Midlaner)\" keep both role columns in place", () => {
    const headers = parseDelimited(FIXTURE)[0];
    const dota = (n: number) => {
      const r = Array.from({ length: 16 }, () => "");
      r[2] = `d${n}@example.com`;
      r[5] = "Dota 2";
      r[12] = "Position 2 (Midlaner)";
      r[13] = "Legend 3";
      r[14] = `https://steamcommunity.com/id/d${n}`;
      return r;
    };
    const sample = [dota(1), dota(2), dota(3)];
    expect(guessMapping(headers, sample)).toEqual(FORM_MAPPING);
    // header-less: the ML role column is taken, the Dota one must not stay "ignore"
    const paste = [
      ["a@example.com", "Gold Lane, Mid Lane", "Position 2 (Midlaner)"],
      ["b@example.com", "Jungle", "Position 2 (Midlaner), Position 3 (Offlane)"],
    ];
    expect(guessMapping([], paste)).toEqual(["email", "ml_roles", "dota_roles"]);
    // untitled role columns left over after the by-value pass are still paired
    expect(guessMapping(["Имэйл", "", ""], [["a@example.com", "Mid Lane", "Exp Lane"]])).toEqual([
      "email", "ml_roles", "dota_roles",
    ]);
  });

  test("never assigns a field twice and leaves unknown columns alone", () => {
    const m = guessMapping(["Имэйл", "Email", "Имэйл хаяг", "Сэтгэгдэл"], []);
    expect(m).toEqual(["email", "ignore", "ignore", "ignore"]);
  });
});

describe("normalisation", () => {
  test("Mobile Legends rank: longest ladder label in the cell", () => {
    expect(normaliseMlRank("Mythic (Mythical Honor)")).toBe("Mythical Honor");
    expect(normaliseMlRank("mythical glory ★")).toBe("Mythical Glory");
    expect(normaliseMlRank("Epic II")).toBe("Epic");
    expect(normaliseMlRank("GRANDMASTER 3")).toBe("Grandmaster");
    expect(normaliseMlRank("Master")).toBe("Master");
    expect(normaliseMlRank("Grand Master")).toBe("Grandmaster");
    expect(normaliseMlRank("grand-master II")).toBe("Grandmaster");
    expect(normaliseMlRank("Mythic (Immortal)")).toBe("Mythical Immortal");
    expect(normaliseMlRank("Mythic")).toBe("Mythic");
    expect(normaliseMlRank("мэдэхгүй")).toBeNull();
    expect(normaliseMlRank("")).toBeNull();
  });

  test("Dota medal with a star number", () => {
    expect(normaliseDotaRank("Legend 3")).toBe("Legend");
    expect(normaliseDotaRank("Ancient [5]")).toBe("Ancient");
    expect(normaliseDotaRank("immortal (top 1000)")).toBe("Immortal");
    expect(normaliseDotaRank("5k mmr")).toBeNull();
  });

  test("Mobile Legends roles: separators, case and keywords", () => {
    expect(normaliseMlRoles("Gold Lane, Exp Lane")).toEqual(["Gold Lane", "Exp Lane"]);
    expect(normaliseMlRoles("roam; JUNGLE / mid\ngold")).toEqual(["Gold Lane", "Mid Lane", "Jungle", "Roamer"]);
    expect(normaliseMlRoles("Exp Lane, Exp lane")).toEqual(["Exp Lane"]);
    expect(normaliseMlRoles("хамаагүй")).toEqual([]);
  });

  test("Dota roles: form labels, pos N, keywords", () => {
    expect(normaliseDotaRoles("Position 1 (Carry), Position 2 (Midlaner)")).toEqual([
      "Position 1 (Carry)", "Position 2 (Midlaner)",
    ]);
    expect(normaliseDotaRoles("pos 4 / hard support")).toEqual([
      "Position 4 (Soft Support)", "Position 5 (Hard Support)",
    ]);
    expect(normaliseDotaRoles("offlane; mid; carry")).toEqual([
      "Position 1 (Carry)", "Position 2 (Midlaner)", "Position 3 (Offlane)",
    ]);
    expect(normaliseDotaRoles("Soft Support")).toEqual(["Position 4 (Soft Support)"]);
    expect(normaliseDotaRoles("1, 5")).toEqual(["Position 1 (Carry)", "Position 5 (Hard Support)"]);
    expect(normaliseDotaRoles("any")).toEqual([]);
  });

  test("FACEIT answers in three languages", () => {
    for (const v of ["Байгаа", "тийм", "Yes", "y", "있음", "байгаа (lvl 7)"]) expect(normaliseFaceit(v)).toBe("yes");
    for (const v of ["Байхгүй", "үгүй", "NO", "n", "없음"]) expect(normaliseFaceit(v)).toBe("no");
    expect(normaliseFaceit("")).toBeNull();
    expect(normaliseFaceit("maybe")).toBeNull();
  });

  test("game cell may name several games", () => {
    expect(parseGames("Mobile Legends")).toEqual(["mobile_legends"]);
    expect(parseGames("CS2, Dota 2")).toEqual(["cs2", "dota2"]);
    expect(parseGames("MLBB / Counter-Strike 2 / DOTA2")).toEqual(["mobile_legends", "cs2", "dota2"]);
    expect(parseGames("html")).toEqual([]);
    expect(parseGames("")).toEqual([]);
  });

  test("receipt: first https URL of the cell", () => {
    expect(firstHttpsUrl("https://drive.google.com/open?id=A1, https://drive.google.com/open?id=B2")).toBe(
      "https://drive.google.com/open?id=A1",
    );
    expect(firstHttpsUrl("see http://drive.google.com/file/d/x/view.")).toBe("https://drive.google.com/file/d/x/view");
    expect(firstHttpsUrl(`https://drive.google.com/${"x".repeat(600)} https://drive.google.com/ok`)).toBe(
      "https://drive.google.com/ok",
    );
    expect(firstHttpsUrl("receipt.jpg")).toBeNull();
    expect(firstHttpsUrl("javascript:alert(1)")).toBeNull();
    // only Drive hosts, never a `user:pw@` authority — the console renders it as a link
    expect(firstHttpsUrl("https://drive.google.com@evil.example/open?id=1")).toBeNull();
    expect(firstHttpsUrl("see https://user:pw@evil.example/x")).toBeNull();
    expect(firstHttpsUrl("https://evil.example/drive.google.com")).toBeNull();
    expect(firstHttpsUrl("https://evil.example/x https://drive.google.com/open?id=ok")).toBe(
      "https://drive.google.com/open?id=ok",
    );
    expect(isTrustedReceiptUrl("https://lh3.googleusercontent.com/a")).toBe(true);
    expect(isTrustedReceiptUrl("https://user@drive.google.com/open?id=1")).toBe(false);
    expect(isTrustedReceiptUrl("http://drive.google.com/open?id=1")).toBe(false);
  });
});

describe("parseTimestamp → ISO, Asia/Seoul when the cell has no zone", () => {
  const ISO = "2026-09-17T05:03:22.000Z"; // 14:03:22 KST

  test.each([
    ["9/17/2026 14:03:22"],
    ["09/17/2026 2:03:22 PM"],
    ["17/09/2026 14:03:22"],
    ["17.09.2026 14:03:22"],
    ["2026. 9. 17 오후 2:03:22"],
    ["2026. 9. 17. 오후 2:03:22"],
    ["2026-09-17 14:03:22"],
    ["2026/09/17 14:03:22"],
    ["2026-09-17T14:03:22"],
    ["2026-09-17T05:03:22Z"],
    ["2026-09-17T14:03:22+09:00"],
    ["2026-09-17T07:03:22.000+02:00"],
  ])("%s", (cell) => {
    expect(parseTimestamp(cell)).toBe(ISO);
  });

  test("midnight / noon with a meridiem", () => {
    expect(parseTimestamp("2026. 9. 17 오전 12:00:00")).toBe("2026-09-16T15:00:00.000Z");
    expect(parseTimestamp("9/17/2026 12:30:00 PM")).toBe("2026-09-17T03:30:00.000Z");
  });

  test("ambiguous d/m: month first unless the column is known to be day-first", () => {
    expect(parseTimestamp("5/9/2026 10:00:00")).toBe("2026-05-09T01:00:00.000Z");
    expect(parseTimestamp("5/9/2026 10:00:00", { dayFirst: true })).toBe("2026-09-05T01:00:00.000Z");
  });

  test("date only and minutes only", () => {
    expect(parseTimestamp("2026-09-17")).toBe("2026-09-16T15:00:00.000Z");
    expect(parseTimestamp("9/17/2026 14:03")).toBe("2026-09-17T05:03:00.000Z");
  });

  test("garbage and impossible dates", () => {
    for (const v of ["", "yesterday", "31/02/2026 10:00:00", "13/13/2026", "2026-09-17 25:00:00", "123456789", "15,200"]) {
      expect(parseTimestamp(v)).toBeNull();
    }
  });

  test("one unmistakable day-first cell settles the whole column", () => {
    const mapping: ImportMapping = ["timestamp", "full_name", "email", "facebook", "ml_rank", "ml_roles", "ml_id"];
    const rest = ["Тест Хүн", "t@example.com", "fb", "Epic", "Jungle", "1"];
    const c = buildCandidates({
      table: [["05/09/2026 10:00:00", ...rest], ["17/09/2026 10:00:00", ...rest]],
      mapping,
      hasHeader: false,
    });
    expect(c.map((x) => x.submitted_at)).toEqual(["2026-09-05T01:00:00.000Z", "2026-09-17T01:00:00.000Z"]);
  });
});

describe("buildCandidates", () => {
  const table = parseDelimited(FIXTURE);
  const candidates = buildCandidates({ table, mapping: guessMapping(table[0], table.slice(1)), hasHeader: true });
  const byRow = (n: number) => candidates.find((c) => c.row === n)!;

  test("one candidate per data row, numbered like the sheet", () => {
    expect(candidates.map((c) => c.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  test("Mobile Legends row", () => {
    const c = byRow(2);
    expect(c.issues).toEqual([]);
    expect(c.person).toEqual({
      full_name: "Бат-Эрдэнэ Болд", email: "bat@example.com", facebook: "facebook.com/bat.bold", phone: "010-1234-5678",
    });
    expect(c.entries).toEqual([
      { game: "mobile_legends", rank: "Mythical Honor", roles: ["Gold Lane", "Exp Lane"], in_game_id: "123456789 (1234)" },
    ]);
    expect(c.submitted_at).toBe("2026-09-17T05:03:22.000Z");
    expect(c.receipt_url).toBe("https://drive.google.com/open?id=1AbCdEfGh01");
  });

  test("CS2 row: quoted premier, two Drive links → the first", () => {
    const c = byRow(3);
    expect(c.issues).toEqual([]);
    expect(c.person?.phone).toBeNull();
    expect(c.entries).toEqual([
      { game: "cs2", premier_rank: "15,200", steam_url: "https://steamcommunity.com/id/temuulen_cs/", faceit: "yes" },
    ]);
    expect(c.receipt_url).toBe("https://drive.google.com/open?id=1AbCdEfGh02");
  });

  test("Dota 2 row", () => {
    expect(byRow(4).entries).toEqual([
      {
        game: "dota2", rank: "Legend", roles: ["Position 1 (Carry)", "Position 2 (Midlaner)"],
        steam_url: "https://steamcommunity.com/profiles/76561198000000001",
      },
    ]);
  });

  test("Korean-locale timestamp row", () => {
    const c = byRow(5);
    expect(c.submitted_at).toBe("2026-09-17T05:03:22.000Z");
    expect(c.entries[0]).toMatchObject({ game: "mobile_legends", rank: "Epic", roles: ["Jungle", "Roamer"] });
  });

  test("invalid e-mail: no person, the entry is still described", () => {
    const c = byRow(6);
    expect(c.person).toBeNull();
    expect(c.issues).toEqual([{ field: "email", code: "bad_email" }]);
    expect(c.display).toEqual({ name: "Болор Сүх", email: "not-an-email" });
    expect(c.entries).toHaveLength(1);
  });

  test("duplicate e-mail + game is lower-cased so the caller can spot it", () => {
    expect(byRow(7).person?.email).toBe("bat@example.com");
    expect(byRow(7).entries[0].game).toBe("mobile_legends");
  });

  test("empty game cell: the filled section decides", () => {
    const c = byRow(8);
    expect(c.issues).toEqual([]);
    expect(c.entries).toEqual([
      { game: "dota2", rank: "Divine", roles: ["Position 3 (Offlane)"], steam_url: "https://steamcommunity.com/id/ganzo_d2" },
    ]);
  });

  test("embedded newline in a quoted cell, Steam URL without a scheme, FACEIT no", () => {
    const c = byRow(9);
    expect(c.person?.facebook).toBe('fb.com/saraa.m,\nSaraa "Sara" Munkh');
    expect(c.entries).toEqual([
      { game: "cs2", premier_rank: null, steam_url: "https://steamcommunity.com/id/saraa", faceit: "no" },
    ]);
  });

  test("bad Steam URL", () => {
    const c = byRow(10);
    expect(c.person).not.toBeNull();
    expect(c.entries).toEqual([]);
    expect(c.issues).toEqual([{ field: "cs2_steam", code: "bad_steam", game: "cs2" }]);
  });

  test("http:// Steam URL becomes https://", () => {
    expect(byRow(12).entries[0]).toMatchObject({ rank: "Ancient", steam_url: "https://steamcommunity.com/id/khuslen/" });
  });

  test("missing Facebook", () => {
    const c = byRow(13);
    expect(c.person).toBeNull();
    expect(c.issues).toEqual([{ field: "facebook", code: "missing_facebook" }]);
  });

  test("every issue code", () => {
    expect(one({ full_name: "" }).issues).toContainEqual({ field: "full_name", code: "missing_name" });
    expect(one({ full_name: "x".repeat(81), game: "CS2" }).issues).toContainEqual({ field: "full_name", code: "too_long" });
    expect(one({ facebook: "f".repeat(201) }).issues).toContainEqual({ field: "facebook", code: "too_long" });
    expect(one({}).issues).toEqual([{ field: "game", code: "no_game" }]);
    expect(one({ game: "Mobile Legends" }).issues).toEqual([
      { field: "ml_rank", code: "bad_rank", game: "mobile_legends" },
      { field: "ml_roles", code: "bad_roles", game: "mobile_legends" },
      { field: "ml_id", code: "missing_id", game: "mobile_legends" },
    ]);
    expect(
      one({ game: "Mobile Legends", ml_rank: "Epic", ml_roles: "Jungle", ml_id: "9".repeat(121) }).issues,
    ).toEqual([{ field: "ml_id", code: "too_long", game: "mobile_legends" }]);
    expect(one({ game: "CS2", cs2_steam: "steamcommunity.com/id/ok" }).issues).toEqual([
      { field: "cs2_faceit", code: "bad_faceit", game: "cs2" },
    ]);
    expect(one({ game: "Dota 2", dota_roles: "?", dota_rank: "?", dota_steam: "https://example.com/id/x" }).issues).toEqual([
      { field: "dota_roles", code: "bad_roles", game: "dota2" },
      { field: "dota_rank", code: "bad_rank", game: "dota2" },
      { field: "dota_steam", code: "bad_steam", game: "dota2" },
    ]);
    const empty = buildCandidates({
      table: [formRow({ timestamp: "9/17/2026 14:03:22" })], mapping: FORM_MAPPING, hasHeader: false,
    })[0];
    expect(empty.issues).toEqual([{ field: "row", code: "empty_row" }]);
    expect(empty.person).toBeNull();
  });

  test("a game cell naming two games: one valid entry, one issue", () => {
    const c = one({
      game: "Mobile Legends, Dota 2", ml_rank: "Legend", ml_roles: "Mid Lane", ml_id: "42",
      dota_rank: "Legend",
    });
    expect(c.entries.map((e) => e.game)).toEqual(["mobile_legends"]);
    expect(c.issues.every((i) => i.game === "dota2")).toBe(true);
    expect(c.issues.map((i) => i.code)).toEqual(["bad_roles", "bad_steam"]);
  });

  test("phone is cut to the column limit, a rambling premier cell keeps its number", () => {
    const c = one({
      phone: "0".repeat(40), game: "CS2", cs2_premier: "ойролцоогоор 12,500 орчим", cs2_faceit: "үгүй",
      cs2_steam: "https://steamcommunity.com/id/ok",
    });
    expect(c.person?.phone).toHaveLength(32);
    expect(c.entries[0]).toMatchObject({ premier_rank: "12500" });
  });

  test("tolerates a mapping that is shorter / dirtier than the table", () => {
    const c = buildCandidates({
      table: [["Тест Хүн", "t@example.com", "fb", "extra"]],
      mapping: ["full_name", "email", "facebook"],
      hasHeader: false,
    });
    expect(c[0].person?.email).toBe("t@example.com");
    const dup = buildCandidates({
      table: [["a@example.com", "b@example.com"]],
      mapping: ["email", "email"],
      hasHeader: false,
    });
    expect(dup[0].display.email).toBe("a@example.com");
  });
});

describe("schImportInputSchema", () => {
  const ok = { table: [["a"]], mapping: ["email"], hasHeader: false };
  test("accepts a sane payload", () => {
    expect(schImportInputSchema.safeParse(ok).success).toBe(true);
    expect(schImportInputSchema.safeParse({ ...ok, mapping: ["ignore", "ignore", "email"] }).success).toBe(true);
  });
  test("rejects duplicate fields, unknown fields and oversized tables", () => {
    expect(schImportInputSchema.safeParse({ ...ok, mapping: ["email", "email"] }).success).toBe(false);
    expect(schImportInputSchema.safeParse({ ...ok, mapping: ["nope"] }).success).toBe(false);
    expect(schImportInputSchema.safeParse({ ...ok, table: [] }).success).toBe(false);
    expect(schImportInputSchema.safeParse({ ...ok, table: [[1]] }).success).toBe(false);
    const tooMany = Array.from({ length: IMPORT_MAX_ROWS + 2 }, () => ["x"]);
    expect(schImportInputSchema.safeParse({ ...ok, table: tooMany }).success).toBe(false);
    expect(schImportInputSchema.safeParse({ ...ok, table: [["x".repeat(IMPORT_MAX_CELL + 1)]] }).success).toBe(false);
  });
});

describe("importSubmissionId", () => {
  test("same response → same UUID-v4-shaped id", () => {
    const a = importSubmissionId("Bat@Example.com ", "2026-09-17T05:03:22.000Z", 2);
    const b = importSubmissionId("bat@example.com", "2026-09-17T05:03:22.000Z", 99);
    expect(a).toBe(b);
    expect(a).toMatch(UUID_V4_RE);
    expect(a[14]).toBe("4");
    expect("89ab").toContain(a[19]);
  });
  test("another person or another moment → another id", () => {
    const base = importSubmissionId("bat@example.com", "2026-09-17T05:03:22.000Z", 2);
    expect(importSubmissionId("anu@example.com", "2026-09-17T05:03:22.000Z", 2)).not.toBe(base);
    expect(importSubmissionId("bat@example.com", "2026-09-18T05:03:22.000Z", 2)).not.toBe(base);
    expect(importSubmissionId("bat@example.com", null, 2)).toBe(importSubmissionId("bat@example.com", null, 7));
  });
  test("the row number only counts when there is nothing else", () => {
    expect(importSubmissionId("", null, 2)).not.toBe(importSubmissionId("", null, 3));
    expect(importSubmissionId("", "2026-09-17T05:03:22.000Z", 2)).toBe(importSubmissionId("", "2026-09-17T05:03:22.000Z", 3));
  });
});
