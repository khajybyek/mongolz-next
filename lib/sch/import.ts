/**
 * SCH Esports — sheet import, pure part.
 *
 * Turns a Google-Form response sheet (CSV download, or cells pasted from
 * Google Sheets = TSV) into validated registration candidates. Isomorphic on
 * purpose: the browser runs it for the mapping UI and the instant preview,
 * the server action runs it AGAIN on the same table before anything is
 * written — so no `node:` imports here.
 *
 * The Google Form has duplicated question titles («Тоглодог role/position»
 * and «Steam Profile URL» exist once per game section), so a column is
 * recognised by its title, by what its cells look like and by where it sits
 * relative to the other sections. The result is a GUESS the organiser can
 * correct in the console.
 */
import { z } from "zod";
import {
  DOTA_RANKS,
  DOTA_ROLES,
  ML_RANKS,
  ML_ROLES,
  SCH_GAMES,
  SCH_LIMITS,
  schCs2Schema,
  schDota2Schema,
  schMobileLegendsSchema,
  schPersonSchema,
  type SchGame,
  type SchGameEntry,
} from "./schema";
import {
  IMPORT_FIELDS,
  IMPORT_MAX_CELL,
  IMPORT_MAX_COLS,
  IMPORT_MAX_ROWS,
  type ImportCandidate,
  type ImportField,
  type ImportIssue,
  type ImportMapping,
  type SchImportInput,
} from "./import-types";

export type { ImportCandidate } from "./import-types";

/* ─────────────────────────── delimited text ─────────────────────────── */

export type ParsedTable = { table: string[][]; truncated: boolean };

/** Delimiter of the first record, counted outside quotes. A tab always wins:
 *  a pasted range is tab-separated and its cells may well contain commas. */
function detectDelimiter(text: string): string {
  let tabs = 0, commas = 0, semis = 0, quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted) {
      if (ch === "\n" || ch === "\r") break;
      if (ch === "\t") tabs++;
      else if (ch === ",") commas++;
      else if (ch === ";") semis++;
    }
  }
  if (tabs > 0) return "\t";
  return semis > commas ? ";" : ",";
}

/**
 * RFC-4180 CSV / TSV → rectangular table. Cells are trimmed, fully empty
 * rows dropped, and the IMPORT_MAX_* caps applied (`truncated` says so).
 */
export function parseDelimitedDetailed(input: string): ParsedTable {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const maxRows = IMPORT_MAX_ROWS + 1; // + header
  const table: string[][] = [];
  let truncated = false;

  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let cellStarted = false; // anything but leading blanks seen in this cell

  const endCell = () => {
    let v = cell.trim();
    if (v.length > IMPORT_MAX_CELL) { v = v.slice(0, IMPORT_MAX_CELL); truncated = true; }
    if (row.length < IMPORT_MAX_COLS) row.push(v);
    else if (v) truncated = true;
    cell = "";
    cellStarted = false;
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== "")) {
      if (table.length < maxRows) table.push(row);
      else truncated = true;
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else if (ch === "\r") {
        // normalise an embedded CRLF / CR to LF
        if (text[i + 1] === "\n") i++;
        cell += "\n";
      } else cell += ch;
      continue;
    }
    if (ch === '"' && !cellStarted) { quoted = true; cellStarted = true; cell = ""; continue; }
    if (ch === delimiter) { endCell(); continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    if (ch !== " ") cellStarted = true;
    cell += ch;
  }
  if (cell !== "" || row.length > 0) endRow();

  const width = table.reduce((w, r) => Math.max(w, r.length), 0);
  for (const r of table) while (r.length < width) r.push("");
  return { table, truncated };
}

export function parseDelimited(text: string): string[][] {
  return parseDelimitedDetailed(text).table;
}

/* ─────────────────────────── cell sniffers ─────────────────────────── */

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
const STEAM_RE = /steamcommunity\.com\//i;
const URL_RE = /https?:\/\/[^\s,;"'<>]+/gi;
const PHONE_RE = /^\+?[\d\s\-().]{7,24}$/;

const lower = (s: string) => s.normalize("NFKC").toLowerCase().trim();

const GAME_PATTERNS: Record<SchGame, RegExp> = {
  mobile_legends: /mobile\s*legends?|mlbb|(^|[^a-z])ml([^a-z]|$)|мобайл/i,
  cs2: /cs\s*2|counter[\s-]*strike|cs\s*:?\s*go|(^|[^a-z])cs([^a-z]|$)/i,
  dota2: /dota|дота/i,
};

/** Every game a cell names, in the canonical order. */
export function parseGames(cell: string): SchGame[] {
  const v = lower(cell);
  if (!v) return [];
  return SCH_GAMES.filter((g) => GAME_PATTERNS[g].test(v));
}

/** Longest ladder label contained in the cell (case-insensitive). */
function ladderMatch<T extends string>(ladder: readonly T[], cell: string): T | null {
  const v = lower(cell).replace(/\s+/g, " ");
  let best: T | null = null;
  for (const label of ladder) {
    if (v.includes(label.toLowerCase()) && (!best || label.length > best.length)) best = label;
  }
  return best;
}

export function normaliseMlRank(cell: string): (typeof ML_RANKS)[number] | null {
  // "Grand Master" / "Grand-Master" would otherwise match the shorter "Master".
  const hit = ladderMatch(ML_RANKS, cell.replace(/grand[\s-]+master/gi, "Grandmaster"));
  // "Mythic (Immortal)" / "glory 50★" — the tier word alone is enough.
  const v = lower(cell);
  if (!hit || hit === "Mythic") {
    if (/immortal/.test(v)) return "Mythical Immortal";
    if (/glory/.test(v)) return "Mythical Glory";
    if (/hono[u]?r/.test(v)) return "Mythical Honor";
    if (!hit && /mythic|\bgm\b/.test(v)) return /mythic/.test(v) ? "Mythic" : "Grandmaster";
  }
  return hit;
}

export function normaliseDotaRank(cell: string): (typeof DOTA_RANKS)[number] | null {
  return ladderMatch(DOTA_RANKS, cell);
}

const splitList = (cell: string) =>
  cell.split(/[,;/\n|&+]|\s+and\s+|\s+ба\s+/i).map((t) => lower(t)).filter(Boolean);

const ML_ROLE_KEYS: [RegExp, (typeof ML_ROLES)[number]][] = [
  [/gold|marksman|(^|\W)(mm|adc)(\W|$)/, "Gold Lane"],
  [/exp|fighter/, "Exp Lane"],
  [/mid|mage/, "Mid Lane"],
  [/jungl|(^|\W)jg(\W|$)/, "Jungle"],
  [/roam|tank|support/, "Roamer"],
];
const DOTA_ROLE_KEYS: [RegExp, (typeof DOTA_ROLES)[number]][] = [
  [/pos(ition)?\.?\s*#?1|carry|safe\s*lane|^1$/, "Position 1 (Carry)"],
  [/pos(ition)?\.?\s*#?2|mid|^2$/, "Position 2 (Midlaner)"],
  [/pos(ition)?\.?\s*#?3|off\s*lane|^3$/, "Position 3 (Offlane)"],
  [/pos(ition)?\.?\s*#?4|soft|^4$/, "Position 4 (Soft Support)"],
  [/pos(ition)?\.?\s*#?5|hard|^5$/, "Position 5 (Hard Support)"],
];

function matchRoles<T extends string>(keys: [RegExp, T][], order: readonly T[], cell: string): T[] {
  const found = new Set<T>();
  for (const token of splitList(cell)) {
    for (const [re, role] of keys) if (re.test(token)) found.add(role);
  }
  return order.filter((r) => found.has(r));
}

/** Checkbox cell → ML roles in ladder order; unknown tokens are ignored. */
export const normaliseMlRoles = (cell: string) => matchRoles(ML_ROLE_KEYS, ML_ROLES, cell);
export const normaliseDotaRoles = (cell: string) => matchRoles(DOTA_ROLE_KEYS, DOTA_ROLES, cell);

const FACEIT_YES = ["байгаа", "тийм", "yes", "있음", "있어", "있습", "예", "네", "true", "бий"];
const FACEIT_NO = ["байхгүй", "үгүй", "no", "없음", "없어", "없습", "아니", "false"];

export function normaliseFaceit(cell: string): "yes" | "no" | null {
  const v = lower(cell).replace(/^[\s"'(]+/, "");
  if (!v) return null;
  if (v === "y") return "yes";
  if (v === "n") return "no";
  if (FACEIT_NO.some((w) => v.startsWith(w))) return "no";
  if (FACEIT_YES.some((w) => v.startsWith(w))) return "yes";
  return null;
}

const RECEIPT_HOSTS = ["drive.google.com", "docs.google.com"];

/**
 * A receipt link the console may show as a button: https, no `user:pw@`
 * part, and a Google Drive host — a Form upload cell never holds anything
 * else, and the organiser clicks it with an admin session open.
 */
export function isTrustedReceiptUrl(value: string): boolean {
  if (value.length > 500 || !/^https:\/\//i.test(value)) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return RECEIPT_HOSTS.includes(host) || host.endsWith(".googleusercontent.com");
}

/** First trusted https:// URL of a cell (Drive upload cells hold several), ≤ 500 chars. */
export function firstHttpsUrl(cell: string): string | null {
  for (const m of cell.matchAll(URL_RE)) {
    const url = m[0].replace(/^http:\/\//i, "https://").replace(/[).\]]+$/, "");
    if (isTrustedReceiptUrl(url)) return url;
  }
  return null;
}

const cleanSteam = (cell: string) => cell.trim().replace(/^http:\/\//i, "https://");

/* ─────────────────────────── timestamps ─────────────────────────── */

const KST_OFFSET_MS = 9 * 3600 * 1000;
const DATE_RE =
  /^(\d{1,4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,4})\.?(?:[\sT,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,]\d+)?)?$/;

/** true when a d/m/y cell can only be day-first (first number > 12). */
function isDayFirst(cell: string): boolean {
  const m = DATE_RE.exec(stripMeridiem(cell).text);
  return !!m && m[1].length <= 2 && Number(m[1]) > 12 && Number(m[2]) <= 12;
}

function stripMeridiem(cell: string): { text: string; pm: boolean | null } {
  let pm: boolean | null = null;
  const text = cell
    .normalize("NFKC")
    // no lookbehind: older Safari refuses to even parse a script that has one
    .replace(/오후|(^|[^a-z])p\.?\s?m\.?(?![a-z])|ү\.?\s?х\.?/gi, (_, pre?: string) => { pm = true; return `${pre ?? ""} `; })
    .replace(/오전|(^|[^a-z])a\.?\s?m\.?(?![a-z])|ү\.?\s?ө\.?/gi, (_, pre?: string) => { pm = false; return `${pre ?? ""} `; })
    .replace(/\s+/g, " ")
    .trim();
  return { text, pm };
}

/**
 * Sheet timestamp → ISO instant. Understands ISO (with or without zone),
 * "9/17/2026 14:03:22", "17/09/2026 14:03:22" (`dayFirst`, or first number
 * > 12), "2026. 9. 17 오후 2:03:22", "17.09.2026 14:03" and AM/PM. A cell
 * without a zone is wall-clock time in Asia/Seoul (UTC+9, no DST).
 */
export function parseTimestamp(cell: string, opts: { dayFirst?: boolean } = {}): string | null {
  const raw = cell.trim();
  if (!raw || raw.length > 64) return null;
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const { text, pm } = stripMeridiem(raw);
  const m = DATE_RE.exec(text);
  if (!m) return null;
  let y: number, mo: number, d: number;
  if (m[1].length === 4) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if (m[3].length === 4) {
    const dotted = /^\d{1,2}\s*\./.test(text); // 17.09.2026 is always day-first
    const dayFirst = dotted || opts.dayFirst || +m[1] > 12;
    y = +m[3];
    mo = dayFirst ? +m[2] : +m[1];
    d = dayFirst ? +m[1] : +m[2];
  } else return null;
  let h = m[4] ? +m[4] : 0;
  const mi = m[5] ? +m[5] : 0;
  const s = m[6] ? +m[6] : 0;
  if (pm !== null) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (pm ? 12 : 0);
  }
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(utc);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null; // 31/02
  return new Date(utc - KST_OFFSET_MS).toISOString();
}

/* ─────────────────────────── header / mapping guess ─────────────────────────── */

/** What a header title says on its own; the ambiguous kinds are resolved later. */
type TitleKind = ImportField | "roles" | "steam" | "rank" | null;

const TITLE_RULES: [RegExp, TitleKind][] = [
  [/time\s*stamp|цагийн тэмдэг|хугацааны тэмдэг|타임\s*스탬프|^(date|огноо|날짜)$/, "timestamp"],
  [/e-?mail|и-?мэйл|имэйл|имейл|цахим шуудан|이메일|메일/, "email"],
  [/facebook|(^|\W)fb(\W|$)|фэйсбүүк|фейсбүүк|фэйсбук|페이스북/, "facebook"],
  [/phone|утас|전화|휴대폰|핸드폰|연락처/, "phone"],
  [/баримт|receipt|төлбөр|payment|screenshot|гүйлгээ|хуулга|영수증|입금|결제|proof/, "receipt"],
  [/face\s*it/, "cs2_faceit"],
  [/premier/, "cs2_premier"],
  [/steam/, "steam"],
  [/mmr|medal/, "dota_rank"],
  [/rank|цол|랭크|티어|tier/, "rank"],
  [/role|position|роль|үүрэг|포지션|역할/, "roles"],
  [/(^|[^a-z])id([^a-z]|$)|айди|아이디/, "ml_id"],
  [/тоглоом|game|게임|종목|төрөл/, "game"],
  [/овог|нэр|name|이름|성명/, "full_name"],
];

function titleKind(title: string): TitleKind {
  const t = lower(title);
  if (!t) return null;
  for (const [re, kind] of TITLE_RULES) if (re.test(t)) return kind;
  return null;
}

type ValueKind =
  | "timestamp" | "email" | "steam" | "facebook" | "receipt" | "faceit" | "game"
  | "ml_roles" | "dota_roles" | "ml_rank" | "dota_rank" | "rank_any" | "number_short" | "number_long" | "text";

const ML_ONLY_RANK = /warrior|elite|master|epic|mythic/;
const DOTA_ONLY_RANK = /herald|guardian|crusader|archon|ancient|divine/;

function cellKind(cell: string): ValueKind {
  const v = lower(cell);
  if (EMAIL_RE.test(v)) return "email";
  if (STEAM_RE.test(v)) return "steam";
  if (/facebook\.com|fb\.com|fb\.me/.test(v)) return "facebook";
  if (/^https?:\/\//.test(v)) return "receipt";
  if (parseTimestamp(cell)) return "timestamp";
  if (normaliseFaceit(cell) && v.length <= 24) return "faceit";
  if (ML_ONLY_RANK.test(v) && normaliseMlRank(cell)) return "ml_rank";
  if (DOTA_ONLY_RANK.test(v)) return "dota_rank";
  if (/^(legend|immortal)\b/.test(v)) return "rank_any";
  // Dota first: "Position 2 (Midlaner)" also carries the ML words "mid" and "lane".
  if (/pos(ition)?\.?\s*#?\d|carry|off\s*lane|midlaner|support\)/.test(v) && normaliseDotaRoles(cell).length) return "dota_roles";
  if (/lane|jungl|roam/.test(v) && normaliseMlRoles(cell).length) return "ml_roles";
  if (/support/.test(v) && normaliseDotaRoles(cell).length) return "dota_roles";
  if (parseGames(cell).length && v.length <= 60) return "game";
  const digits = v.replace(/\D/g, "");
  if (digits && PHONE_RE.test(v.replace(/,/g, ""))) return digits.length >= 6 ? "number_long" : "number_short";
  if (/^\d{1,2}[,.\s]?\d{3}$|^\d{1,5}$/.test(v)) return "number_short";
  if (/^\d{6,12}\s*\(\s*\d{3,6}\s*\)$/.test(v)) return "number_long";
  return "text";
}

/** Dominant kind of a column's non-empty sample cells (≥ 60 %), else "text". */
function columnKind(sample: string[][], col: number): ValueKind | null {
  const counts = new Map<ValueKind, number>();
  let filled = 0;
  for (const r of sample) {
    const c = r[col] ?? "";
    if (!c) continue;
    filled++;
    const k = cellKind(c);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (!filled) return null;
  // "Legend" / "Immortal" alone side with whichever ladder the column already shows.
  const any = counts.get("rank_any") ?? 0;
  if (any) {
    const ml = counts.get("ml_rank") ?? 0, dota = counts.get("dota_rank") ?? 0;
    counts.delete("rank_any");
    if (ml || dota) counts.set(ml >= dota ? "ml_rank" : "dota_rank", Math.max(ml, dota) + any);
    else counts.set("rank_any", any);
  }
  let best: ValueKind = "text", n = 0;
  for (const [k, c] of counts) if (c > n) { best = k; n = c; }
  return n / filled >= 0.6 ? best : "text";
}

/** First row is a header when no cell looks like an answer and a title is recognised. */
export function looksLikeHeader(firstRow: string[]): boolean {
  let titled = 0;
  for (const c of firstRow) {
    if (!c) continue;
    const v = lower(c);
    if (EMAIL_RE.test(v) || /https?:\/\/|steamcommunity\.com/.test(v) || parseTimestamp(c)) return false;
    if (titleKind(c)) titled++;
  }
  return titled > 0;
}

/**
 * Column → field guess. Titles first (mn / en / kr), then what the sample
 * cells look like, then the section order of the form (Mobile Legends → CS2
 * → Dota 2) for the duplicated titles. Unknown columns stay "ignore" and no
 * field is handed out twice.
 */
export function guessMapping(headers: string[], sample: string[][]): ImportMapping {
  const width = Math.min(
    IMPORT_MAX_COLS,
    Math.max(headers.length, sample.reduce((w, r) => Math.max(w, r.length), 0)),
  );
  const mapping: ImportMapping = Array.from({ length: width }, () => "ignore");
  const used = new Set<ImportField>();
  const assign = (col: number, field: ImportField) => {
    if (field === "ignore" || used.has(field) || mapping[col] !== "ignore") return false;
    mapping[col] = field;
    used.add(field);
    return true;
  };

  const titles = Array.from({ length: width }, (_, i) => titleKind(headers[i] ?? ""));
  const values = Array.from({ length: width }, (_, i) => columnKind(sample, i));

  // 1 — unambiguous titles, unless the cells plainly say otherwise.
  const contradicts = (field: ImportField, v: ValueKind | null) =>
    (field !== "email" && v === "email") || (field !== "timestamp" && v === "timestamp" && field !== "ignore");
  for (let i = 0; i < width; i++) {
    const t = titles[i];
    if (!t || t === "roles" || t === "steam" || t === "rank") continue;
    if (!contradicts(t, values[i])) assign(i, t);
  }
  // 2 — values that identify a field on their own.
  const BY_VALUE: Partial<Record<ValueKind, ImportField>> = {
    email: "email", faceit: "cs2_faceit", game: "game", ml_roles: "ml_roles", dota_roles: "dota_roles",
    ml_rank: "ml_rank", dota_rank: "dota_rank", receipt: "receipt", facebook: "facebook",
  };
  for (let i = 0; i < width; i++) {
    const v = values[i];
    if (mapping[i] !== "ignore" || !v) continue;
    if (v === "timestamp") { if (titles[i] === null) assign(i, "timestamp"); continue; }
    const f = BY_VALUE[v];
    if (f) assign(i, f);
  }

  // 3 — duplicated titles: form order, then the nearest already-known section column.
  const SECTION: Partial<Record<ImportField, SchGame>> = {
    ml_rank: "mobile_legends", ml_roles: "mobile_legends", ml_id: "mobile_legends",
    cs2_premier: "cs2", cs2_steam: "cs2", cs2_faceit: "cs2",
    dota_roles: "dota2", dota_rank: "dota2", dota_steam: "dota2",
  };
  const nearestSection = (col: number, among: SchGame[]): SchGame => {
    let best: SchGame = among[0], dist = Infinity;
    for (let i = 0; i < width; i++) {
      const g = SECTION[mapping[i]];
      if (!g || !among.includes(g)) continue;
      const d = Math.abs(i - col);
      if (d < dist) { dist = d; best = g; }
    }
    return best;
  };
  const open = (kind: TitleKind, byValue: ValueKind[]) =>
    Array.from({ length: width }, (_, i) => i).filter(
      (i) => mapping[i] === "ignore" && (titles[i] === kind || (titles[i] === null && byValue.includes(values[i] as ValueKind))),
    );
  const pair = (cols: number[], a: ImportField, b: ImportField, among: [SchGame, SchGame]) => {
    const free = [a, b].filter((f) => !used.has(f));
    if (cols.length >= 2 && free.length === 2) { assign(cols[0], a); assign(cols[1], b); }
    else if (cols.length >= 1 && free.length === 2) assign(cols[0], nearestSection(cols[0], among) === among[0] ? a : b);
    else if (cols.length >= 1 && free.length === 1) assign(cols[0], free[0]);
  };
  pair(open("rank", ["rank_any"]), "ml_rank", "dota_rank", ["mobile_legends", "dota2"]);
  pair(open("roles", ["ml_roles", "dota_roles"]), "ml_roles", "dota_roles", ["mobile_legends", "dota2"]);
  pair(open("steam", ["steam"]), "cs2_steam", "dota_steam", ["cs2", "dota2"]);

  // 4 — header-less leftovers: numbers and free text, by position.
  const firstSection = mapping.findIndex((f) => SECTION[f] !== undefined || f === "game");
  const beforeSections = (i: number) => firstSection < 0 || i < firstSection;
  for (let i = 0; i < width; i++) {
    if (mapping[i] !== "ignore" || titles[i] !== null) continue;
    const v = values[i];
    if (v === "number_long") {
      if (!assign(i, beforeSections(i) ? "phone" : "ml_id")) assign(i, "ml_id");
    } else if (v === "number_short" && !beforeSections(i)) assign(i, "cs2_premier");
  }
  for (let i = 0; i < width; i++) {
    if (mapping[i] !== "ignore" || titles[i] !== null || values[i] !== "text" || !beforeSections(i)) continue;
    if (!assign(i, "full_name")) assign(i, "facebook");
  }
  return mapping;
}

/* ─────────────────────────── candidates ─────────────────────────── */

const MAPPING_FIELD = z.enum(IMPORT_FIELDS);

/** Shape + caps of what the console sends to a server action. */
export const schImportInputSchema = z.object({
  table: z
    .array(z.array(z.string().max(IMPORT_MAX_CELL)).max(IMPORT_MAX_COLS))
    .min(1)
    .max(IMPORT_MAX_ROWS + 1),
  mapping: z
    .array(MAPPING_FIELD)
    .max(IMPORT_MAX_COLS)
    .refine((m) => {
      const real = m.filter((f) => f !== "ignore");
      return new Set(real).size === real.length;
    }, { message: "duplicate_field" }),
  hasHeader: z.boolean(),
});

const SECTION_REQUIRED: Record<SchGame, ImportField[]> = {
  mobile_legends: ["ml_rank", "ml_roles", "ml_id"],
  cs2: ["cs2_steam", "cs2_faceit"],
  dota2: ["dota_roles", "dota_rank", "dota_steam"],
};

/**
 * Normalise + validate every data row. Never throws on sheet content: what
 * cannot be used becomes an issue on the row. A row may carry valid entries
 * AND issues (one game fine, another broken) — the caller decides what that
 * means (`partial`).
 */
export function buildCandidates(input: SchImportInput): ImportCandidate[] {
  const col = new Map<ImportField, number>();
  input.mapping.forEach((f, i) => {
    if (f !== "ignore" && (IMPORT_FIELDS as readonly string[]).includes(f) && !col.has(f)) col.set(f, i);
  });
  const start = input.hasHeader ? 1 : 0;
  const get = (r: string[], f: ImportField) => {
    const i = col.get(f);
    const v = i === undefined ? "" : r[i];
    return typeof v === "string" ? v.trim() : "";
  };

  // One sheet = one locale: a single unmistakable day-first cell settles the column.
  const tsCol = col.get("timestamp");
  const dayFirst = tsCol !== undefined && input.table.slice(start).some((r) => isDayFirst(r[tsCol] ?? ""));

  const out: ImportCandidate[] = [];
  for (let idx = start; idx < input.table.length; idx++) {
    const r = input.table[idx] ?? [];
    const issues: ImportIssue[] = [];
    const candidate: ImportCandidate = {
      row: idx + 1,
      submitted_at: parseTimestamp(get(r, "timestamp"), { dayFirst }),
      person: null,
      display: { name: get(r, "full_name").slice(0, SCH_LIMITS.name.max), email: get(r, "email").toLowerCase().slice(0, 254) },
      entries: [],
      receipt_url: firstHttpsUrl(get(r, "receipt")),
      issues,
    };
    out.push(candidate);

    const answered = [...col.keys()].some((f) => f !== "timestamp" && get(r, f) !== "");
    if (!answered) { issues.push({ field: "row", code: "empty_row" }); continue; }

    /* person */
    const name = get(r, "full_name").replace(/\s+/g, " ");
    const facebook = get(r, "facebook");
    if (name.length < SCH_LIMITS.name.min) issues.push({ field: "full_name", code: "missing_name" });
    else if (name.length > SCH_LIMITS.name.max) issues.push({ field: "full_name", code: "too_long" });
    if (facebook.length < SCH_LIMITS.facebook.min) issues.push({ field: "facebook", code: "missing_facebook" });
    else if (facebook.length > SCH_LIMITS.facebook.max) issues.push({ field: "facebook", code: "too_long" });
    const person = schPersonSchema.safeParse({
      full_name: name,
      email: get(r, "email"),
      facebook,
      phone: get(r, "phone").slice(0, SCH_LIMITS.phone.max),
    });
    if (person.success) candidate.person = person.data;
    else if (person.error.issues.some((i) => i.path[0] === "email")) issues.push({ field: "email", code: "bad_email" });

    /* games: the game cell when it names one, otherwise every section with an answer */
    let games = parseGames(get(r, "game"));
    if (!games.length) games = SCH_GAMES.filter((g) => SECTION_REQUIRED[g].some((f) => get(r, f) !== ""));
    if (!games.length) { issues.push({ field: "game", code: "no_game" }); continue; }

    for (const game of games) {
      const before = issues.length;
      let parsed: { success: true; data: SchGameEntry } | { success: false } = { success: false };
      if (game === "mobile_legends") {
        const rank = normaliseMlRank(get(r, "ml_rank"));
        const roles = normaliseMlRoles(get(r, "ml_roles"));
        const id = get(r, "ml_id");
        if (!rank) issues.push({ field: "ml_rank", code: "bad_rank", game });
        if (!roles.length) issues.push({ field: "ml_roles", code: "bad_roles", game });
        if (!id) issues.push({ field: "ml_id", code: "missing_id", game });
        else if (id.length > SCH_LIMITS.inGameId.max) issues.push({ field: "ml_id", code: "too_long", game });
        if (issues.length === before) parsed = schMobileLegendsSchema.safeParse({ game, rank, roles, in_game_id: id });
      } else if (game === "cs2") {
        const faceit = normaliseFaceit(get(r, "cs2_faceit"));
        const steam = schCs2Schema.shape.steam_url.safeParse(cleanSteam(get(r, "cs2_steam")));
        if (!steam.success) issues.push({ field: "cs2_steam", code: "bad_steam", game });
        if (!faceit) issues.push({ field: "cs2_faceit", code: "bad_faceit", game });
        if (issues.length === before) {
          parsed = schCs2Schema.safeParse({
            game, faceit, steam_url: cleanSteam(get(r, "cs2_steam")), premier_rank: cleanPremier(get(r, "cs2_premier")),
          });
        }
      } else {
        const rank = normaliseDotaRank(get(r, "dota_rank"));
        const roles = normaliseDotaRoles(get(r, "dota_roles"));
        const steam = schDota2Schema.shape.steam_url.safeParse(cleanSteam(get(r, "dota_steam")));
        if (!roles.length) issues.push({ field: "dota_roles", code: "bad_roles", game });
        if (!rank) issues.push({ field: "dota_rank", code: "bad_rank", game });
        if (!steam.success) issues.push({ field: "dota_steam", code: "bad_steam", game });
        if (issues.length === before) {
          parsed = schDota2Schema.safeParse({ game, rank, roles, steam_url: cleanSteam(get(r, "dota_steam")) });
        }
      }
      if (parsed.success) candidate.entries.push(parsed.data);
    }
  }
  return out;
}

/** Optional free text, ≤ 12 chars in the table: keep the number when the cell rambles. */
function cleanPremier(cell: string): string {
  const v = cell.trim();
  if (v.length <= SCH_LIMITS.premier.max) return v;
  const digits = v.replace(/[^0-9]/g, "");
  return (digits || v).slice(0, SCH_LIMITS.premier.max);
}
