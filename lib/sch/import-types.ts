/**
 * SCH Esports — sheet import contract.
 *
 * The organiser also collected registrations with the original Google Form.
 * They download the response sheet (CSV / XLSX) or paste its cells (TSV) into
 * /sch/admin; the browser parses it, the server re-validates every row and
 * writes the new ones. These types are what the parser (lib/sch/import.ts),
 * the server actions and the console UI agree on — nobody redefines them.
 */
import type { SchGame, SchGameEntry, SchStatus } from "@/lib/sch/schema";

export const IMPORT_MAX_ROWS = 500; // data rows
export const IMPORT_MAX_COLS = 60;
export const IMPORT_MAX_CELL = 2000; // characters per cell, longer cells are truncated by the parser
export const IMPORT_MAX_PAYLOAD_BYTES = 900_000; // JSON sent to a server action (Next default body limit is 1 MB)

export const IMPORT_FIELDS = [
  "ignore", "timestamp", "full_name", "email", "facebook", "phone", "game",
  "ml_rank", "ml_roles", "ml_id",
  "cs2_premier", "cs2_steam", "cs2_faceit",
  "dota_roles", "dota_rank", "dota_steam",
  "receipt",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const isImportField = (v: unknown): v is ImportField =>
  typeof v === "string" && (IMPORT_FIELDS as readonly string[]).includes(v);

/** index = column index; every non-"ignore" field at most once */
export type ImportMapping = ImportField[];

export type ImportIssueCode =
  | "missing_name" | "bad_email" | "missing_facebook" | "no_game"
  | "bad_rank" | "bad_roles" | "missing_id" | "bad_steam" | "bad_faceit"
  | "too_long" | "empty_row";
export type ImportIssue = { field: ImportField | "row"; code: ImportIssueCode; game?: SchGame };

export type SchImportInput = { table: string[][]; mapping: ImportMapping; hasHeader: boolean };
export type SchImportCommitInput = SchImportInput & { status: Extract<SchStatus, "pending" | "paid"> };

export type SchImportRowState = "ready" | "partial" | "invalid" | "duplicate_in_file" | "already_registered";
export type SchImportRowVerdict = {
  /** 1-based sheet row incl. header */
  row: number;
  name: string;
  email: string;
  games_new: SchGame[];
  games_existing: SchGame[];
  state: SchImportRowState;
  issues: ImportIssue[];
  has_receipt: boolean;
};
export type SchImportTotals = {
  rows: number;
  ready: number;
  partial: number;
  invalid: number;
  duplicate_in_file: number;
  already_registered: number;
  entries_new: number;
};
export type SchImportPreview =
  | { ok: true; rows: SchImportRowVerdict[]; totals: SchImportTotals }
  | { error: "invalid" | "too_large" | "unavailable" };
export type SchImportResult =
  | { ok: true; inserted: number; totals: SchImportTotals }
  | { error: "invalid" | "too_large" | "unavailable" };

/** One sheet row after normalisation — what buildCandidates() returns. */
export type ImportCandidate = {
  /** 1-based sheet row incl. header */
  row: number;
  /** ISO instant; a cell without a zone is read as Asia/Seoul. */
  submitted_at: string | null;
  /** null when name / e-mail / Facebook did not validate (see `issues`). */
  person: { full_name: string; email: string; facebook: string; phone: string | null } | null;
  /** Best-effort name / e-mail for the preview even when `person` is null. */
  display: { name: string; email: string };
  /** Validated with the zod schemas from lib/sch/schema.ts; one per game at most. */
  entries: SchGameEntry[];
  /** first https:// URL in the receipt cell, ≤ 500 chars */
  receipt_url: string | null;
  issues: ImportIssue[];
};
