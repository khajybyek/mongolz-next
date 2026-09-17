/**
 * SCH Esports — registration draft kept in the browser's sessionStorage.
 *
 * The public language switcher persists the cookie and hard-reloads the
 * page (components/language-switcher.tsx), which would wipe a half-filled
 * form. The form therefore mirrors its answers into sessionStorage and
 * restores them on mount. The receipt File itself cannot be serialised; if
 * it was already uploaded, its server-side bookkeeping (submission id +
 * object path + file facts) is kept so the retry only re-submits.
 *
 * Nothing here is trusted: the codec re-validates every field on the way
 * back in and the server re-validates the whole submission anyway.
 */
import { SCH_GAMES, isReceiptMime, RECEIPT_MAX_BYTES, RECEIPT_PATH_RE, UUID_V4_RE, type ReceiptMime, type SchGame } from "./schema";

export const SCH_DRAFT_KEY = "sch-registration-draft:v1";
/** Answers older than this are dropped on restore. */
export const SCH_DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** An uploaded receipt is only trusted for as long as the sweep leaves it alone. */
export const SCH_DRAFT_UPLOAD_MAX_AGE_MS = 90 * 60 * 1000;

export type SchDraftUpload = {
  submissionId: string;
  path: string;
  file: { name: string; size: number; mime: ReceiptMime };
};

export type SchDraft = {
  v: 1;
  savedAt: number;
  person: { full_name: string; email: string; facebook: string; phone: string };
  games: SchGame[];
  ml: { rank: string; roles: string[]; in_game_id: string };
  cs2: { premier_rank: string; steam_url: string; faceit: string };
  dota: { roles: string[]; rank: string; steam_url: string };
  upload: SchDraftUpload | null;
};

const MAX_TEXT = 300;

function str(v: unknown, max = MAX_TEXT): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function strList(v: unknown, max = 8): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map((x) => x.slice(0, 60)) : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseUpload(v: unknown, savedAt: number, now: number): SchDraftUpload | null {
  const u = obj(v);
  if (now - savedAt > SCH_DRAFT_UPLOAD_MAX_AGE_MS) return null;
  const submissionId = str(u.submissionId, 40).toLowerCase();
  const path = str(u.path, 120);
  const file = obj(u.file);
  const size = typeof file.size === "number" ? file.size : NaN;
  if (!UUID_V4_RE.test(submissionId)) return null;
  if (!RECEIPT_PATH_RE.test(path) || !path.startsWith(`submissions/${submissionId}/`)) return null;
  if (!isReceiptMime(file.mime)) return null;
  if (!Number.isInteger(size) || size <= 0 || size > RECEIPT_MAX_BYTES) return null;
  return { submissionId, path, file: { name: str(file.name, 200) || "receipt", size, mime: file.mime } };
}

/** Whether a draft is worth restoring at all (an untouched form is not). */
export function isDraftEmpty(d: SchDraft): boolean {
  return (
    !d.person.full_name && !d.person.email && !d.person.facebook && !d.person.phone &&
    d.games.length === 0 && !d.ml.rank && d.ml.roles.length === 0 && !d.ml.in_game_id &&
    !d.cs2.premier_rank && !d.cs2.steam_url && !d.cs2.faceit &&
    d.dota.roles.length === 0 && !d.dota.rank && !d.dota.steam_url && !d.upload
  );
}

export function serialiseDraft(d: Omit<SchDraft, "v" | "savedAt">, now = Date.now()): string {
  return JSON.stringify({ v: 1, savedAt: now, ...d } satisfies SchDraft);
}

/** Parse what sessionStorage returned; null for anything stale, foreign or empty. */
export function parseDraft(raw: string | null | undefined, now = Date.now()): SchDraft | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const d = obj(data);
  if (d.v !== 1) return null;
  const savedAt = typeof d.savedAt === "number" ? d.savedAt : NaN;
  if (!Number.isFinite(savedAt) || savedAt > now + 60_000 || now - savedAt > SCH_DRAFT_MAX_AGE_MS) return null;

  const person = obj(d.person);
  const ml = obj(d.ml);
  const cs2 = obj(d.cs2);
  const dota = obj(d.dota);
  const games = Array.isArray(d.games) ? SCH_GAMES.filter((g) => (d.games as unknown[]).includes(g)) : [];

  const draft: SchDraft = {
    v: 1,
    savedAt,
    person: {
      full_name: str(person.full_name, 80),
      email: str(person.email, 254),
      facebook: str(person.facebook, 200),
      phone: str(person.phone, 32),
    },
    games,
    ml: { rank: str(ml.rank, 40), roles: strList(ml.roles), in_game_id: str(ml.in_game_id, 120) },
    cs2: { premier_rank: str(cs2.premier_rank, 12), steam_url: str(cs2.steam_url, 120), faceit: str(cs2.faceit, 3) },
    dota: { roles: strList(dota.roles), rank: str(dota.rank, 40), steam_url: str(dota.steam_url, 120) },
    upload: parseUpload(d.upload, savedAt, now),
  };
  return isDraftEmpty(draft) ? null : draft;
}
