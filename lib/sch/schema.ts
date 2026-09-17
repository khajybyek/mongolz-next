/**
 * SCH Esports registration — shared contract.
 *
 * Everything the public form, the organiser console and the team draw agree
 * on lives here: the three games, their rank ladders (with a 0–100 score the
 * balanced draw uses), the role lists, the registration statuses and the zod
 * schema that validates a submission before it reaches the database.
 * Labels are English identifiers on purpose — the ranks and roles are the
 * games' own names, and the per-surface copy files translate the chrome.
 */
import { z } from "zod";

export const SCH_GAMES = ["mobile_legends", "cs2", "dota2"] as const;
export type SchGame = (typeof SCH_GAMES)[number];
export const isSchGame = (v: unknown): v is SchGame => SCH_GAMES.includes(v as SchGame);

export const SCH_GAME_LABEL: Record<SchGame, string> = {
  mobile_legends: "Mobile Legends",
  cs2: "CS2",
  dota2: "Dota 2",
};

/** Default event days (Chuseok 2026); the organiser can change them. */
export const SCH_DEFAULT_GAME_DATES: Record<SchGame, string> = {
  mobile_legends: "2026-09-25",
  cs2: "2026-09-26",
  dota2: "2026-09-27",
};

export const SCH_TEAM_SIZE = 5;

/**
 * Organiser-editable texts as seeded by the migrations (Mongolian). While a
 * value still equals its seed, the public pages show a translation for en/kr;
 * once the organiser edits it, their text is shown in every language.
 */
export const SCH_SEED_TEXT = {
  title: "Chuseok 2026 SCH Esport тэмцээн",
  intro:
    "Тэмцээн 9/25 – 9/27-ний хооронд болно.\n" +
    "Бүх оюутныг тэгш оролцоогоор хангаж, илүү сонирхолтой, нөхөрсөг өрсөлдөөнийг бүрдүүлэхийн тулд оролцогчдыг rank-д нь үндэслэн багуудын түвшинг аль болох тэнцвэртэй байхаар тооцож, багийн хуваарилалтыг random байдлаар хийнэ.\n" +
    "Төлбөрөө төлсөн тохиолдолд л бүртгэл баталгаажна.",
  payment:
    "Солонгос данс: 토스뱅크 1001-9949-6201\n" +
    "Монгол данс: 450004000409071526 ХХБ\n" +
    "Гүйлгээний утга дээр өөрийн бүтэн нэрээ оруулна уу.",
} as const;
export type SchSeedTextKind = keyof typeof SCH_SEED_TEXT;

/** Payment receipts: private bucket, uploaded through a signed URL. */
export const SCH_RECEIPT_BUCKET = "sch-receipts";
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
} as const;
export type ReceiptMime = keyof typeof RECEIPT_MIME_EXT;
export const isReceiptMime = (v: unknown): v is ReceiptMime =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(RECEIPT_MIME_EXT, v);

/**
 * Types a NEW receipt may be uploaded as. HEIC is deliberately absent: no
 * browser except Safari can decode it, so the organiser could never see a
 * HEIC receipt in the console lightbox. Leaving it out of the form's
 * `accept` list makes iOS hand over a JPEG instead. `RECEIPT_MIME_EXT` keeps
 * "image/heic" so rows stored before this change still validate and stream.
 */
export const RECEIPT_UPLOAD_MIMES = ["image/jpeg", "image/png", "image/webp"] as const satisfies readonly ReceiptMime[];
export type ReceiptUploadMime = (typeof RECEIPT_UPLOAD_MIMES)[number];
export const isReceiptUploadMime = (v: unknown): v is ReceiptUploadMime =>
  typeof v === "string" && (RECEIPT_UPLOAD_MIMES as readonly string[]).includes(v);
export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RECEIPT_PATH_RE = /^submissions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/receipt\.(jpg|png|webp|heic)$/;
export function receiptPath(submissionId: string, mime: ReceiptMime): string {
  return `submissions/${submissionId.toLowerCase()}/receipt.${RECEIPT_MIME_EXT[mime]}`;
}

/** Ladder order matters: index → balanced-draw score (0–100). */
export const ML_RANKS = [
  "Warrior", "Elite", "Master", "Grandmaster", "Epic", "Legend",
  "Mythic", "Mythical Honor", "Mythical Glory", "Mythical Immortal",
] as const;
export const DOTA_RANKS = [
  "Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal",
] as const;
export const ML_ROLES = ["Gold Lane", "Exp Lane", "Mid Lane", "Jungle", "Roamer"] as const;
export const DOTA_ROLES = [
  "Position 1 (Carry)", "Position 2 (Midlaner)", "Position 3 (Offlane)",
  "Position 4 (Soft Support)", "Position 5 (Hard Support)",
] as const;
export const FACEIT_OPTIONS = ["yes", "no"] as const;

/** CS2 Premier rating tops out around 30 000; unknown/blank → median-ish. */
export const CS2_UNKNOWN_SCORE = 40;

function ladderScore(ladder: readonly string[], label: string): number {
  const i = ladder.indexOf(label);
  return i < 0 ? 0 : Math.round(((i + 1) / ladder.length) * 100);
}

export function cs2PremierScore(raw: string | null | undefined): number {
  const digits = (raw ?? "").replace(/[^0-9]/g, "");
  if (!digits) return CS2_UNKNOWN_SCORE;
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return CS2_UNKNOWN_SCORE;
  return Math.max(1, Math.min(100, Math.round((n / 30_000) * 100)));
}

/** 0–100 strength used by the balanced random draw. */
export function rankScore(game: SchGame, rankLabel: string | null | undefined, answers?: Record<string, unknown>): number {
  if (game === "mobile_legends") return ladderScore(ML_RANKS, rankLabel ?? "");
  if (game === "dota2") return ladderScore(DOTA_RANKS, rankLabel ?? "");
  return cs2PremierScore(typeof answers?.premier_rank === "string" ? answers.premier_rank : rankLabel);
}

export const SCH_STATUSES = ["pending", "paid", "waitlist", "rejected", "cancelled"] as const;
export type SchStatus = (typeof SCH_STATUSES)[number];
export const isSchStatus = (v: unknown): v is SchStatus => SCH_STATUSES.includes(v as SchStatus);

/** Only paid players enter the draw; everything else stays on the list. */
export const SCH_DRAW_STATUSES: readonly SchStatus[] = ["paid"];

export const SCH_LIMITS = {
  name: { min: 2, max: 80 },
  facebook: { min: 2, max: 200 },
  phone: { max: 32 },
  inGameId: { min: 1, max: 120 },
  premier: { max: 12 },
  notes: { max: 1000 },
  submitPerHourPerIp: 6,
} as const;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalTrimmed = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const schPersonSchema = z.object({
  full_name: trimmed(SCH_LIMITS.name.min, SCH_LIMITS.name.max),
  email: z.string().trim().toLowerCase().email().max(254),
  facebook: trimmed(SCH_LIMITS.facebook.min, SCH_LIMITS.facebook.max),
  phone: optionalTrimmed(SCH_LIMITS.phone.max),
});

const steamUrl = z
  .string()
  .trim()
  .min(SCH_LIMITS.inGameId.min)
  .max(SCH_LIMITS.inGameId.max)
  .refine((v) => /^(https?:\/\/)?(www\.)?steamcommunity\.com\/(id|profiles)\/[A-Za-z0-9_\-.]+\/?$/i.test(v), {
    message: "steam_url",
  })
  .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`));

export const schMobileLegendsSchema = z.object({
  game: z.literal("mobile_legends"),
  rank: z.enum(ML_RANKS),
  roles: z.array(z.enum(ML_ROLES)).min(1).max(ML_ROLES.length),
  in_game_id: trimmed(SCH_LIMITS.inGameId.min, SCH_LIMITS.inGameId.max),
});
export const schCs2Schema = z.object({
  game: z.literal("cs2"),
  premier_rank: optionalTrimmed(SCH_LIMITS.premier.max),
  steam_url: steamUrl,
  faceit: z.enum(FACEIT_OPTIONS),
});
export const schDota2Schema = z.object({
  game: z.literal("dota2"),
  roles: z.array(z.enum(DOTA_ROLES)).min(1).max(DOTA_ROLES.length),
  rank: z.enum(DOTA_RANKS),
  steam_url: steamUrl,
});
export const schGameEntrySchema = z.discriminatedUnion("game", [
  schMobileLegendsSchema,
  schCs2Schema,
  schDota2Schema,
]);
export type SchGameEntry = z.infer<typeof schGameEntrySchema>;

/** One submission = one person + one entry per chosen game (no duplicates). */
export const schSubmissionSchema = z.object({
  /** Minted by prepareReceiptUpload(); the receipt path must belong to it. */
  submission_id: z.string().regex(UUID_V4_RE).transform((v) => v.toLowerCase()),
  receipt_path: z.string().regex(RECEIPT_PATH_RE),
  person: schPersonSchema,
  entries: z
    .array(schGameEntrySchema)
    .min(1)
    .max(SCH_GAMES.length)
    .refine((es) => new Set(es.map((e) => e.game)).size === es.length, { message: "duplicate_game" }),
  /** Honeypot — real browsers leave it empty. */
  website: z.string().max(0).optional(),
}).refine((v) => v.receipt_path.startsWith(`submissions/${v.submission_id}/`), {
  message: "receipt_mismatch",
  path: ["receipt_path"],
});
export type SchSubmission = z.infer<typeof schSubmissionSchema>;

/** Row shape written to `sch_registrations` for one game entry. */
export function registrationRow(entry: SchGameEntry) {
  if (entry.game === "mobile_legends") {
    return {
      game: entry.game,
      in_game_id: entry.in_game_id,
      rank_label: entry.rank,
      rank_score: rankScore(entry.game, entry.rank),
      roles: [...entry.roles],
      answers: {} as Record<string, unknown>,
    };
  }
  if (entry.game === "dota2") {
    return {
      game: entry.game,
      in_game_id: entry.steam_url,
      rank_label: entry.rank,
      rank_score: rankScore(entry.game, entry.rank),
      roles: [...entry.roles],
      answers: {} as Record<string, unknown>,
    };
  }
  return {
    game: entry.game,
    in_game_id: entry.steam_url,
    rank_label: entry.premier_rank ? `Premier ${entry.premier_rank}` : null,
    rank_score: rankScore(entry.game, null, { premier_rank: entry.premier_rank }),
    roles: [] as string[],
    answers: { premier_rank: entry.premier_rank, faceit: entry.faceit } as Record<string, unknown>,
  };
}

/** Short human reference shown after submitting (first block of the submission id). */
export function referenceCode(submissionId: string): string {
  return submissionId.replace(/-/g, "").slice(0, 8).toUpperCase();
}
