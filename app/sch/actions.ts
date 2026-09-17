"use server";

/**
 * SCH Esports — public registration server actions.
 *
 * Everything here runs with the service role because the tables have no
 * anon policy on purpose (registrant data is personal). The public surface
 * is therefore exactly these functions: a read-only event loader, the
 * signed-upload minting step for the payment receipt, and the submit step
 * that re-validates everything before rows are written. Nothing returned to
 * the browser contains a secret; the service key never leaves the server.
 */
import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/log";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.generated";
import {
  RECEIPT_MAX_BYTES,
  RECEIPT_MIME_EXT,
  RECEIPT_PATH_RE,
  SCH_DEFAULT_GAME_DATES,
  SCH_GAMES,
  SCH_RECEIPT_BUCKET,
  isReceiptMime,
  isReceiptUploadMime,
  isSchGame,
  receiptPath,
  registrationRow,
  schSubmissionSchema,
  type ReceiptMime,
  type SchGame,
} from "@/lib/sch/schema";
import {
  SCH_PREPARE_LIMIT,
  SCH_SUBMIT_LIMIT,
  classifyInsertError,
  invalidFields,
  rateLimitVerdict,
  replayOutcome,
  type RateVerdict,
  type SchFieldKey,
} from "@/lib/sch/submit";

/* ─────────────────────────── event ─────────────────────────── */

export type SchEventView = {
  /** false when `sch_event` could not be read — defaults are shown. */
  loaded: boolean;
  title: string;
  intro: string | null;
  /** The organiser's switch combined with the deadline. */
  isOpen: boolean;
  deadline: string | null;
  feeKrw: number;
  feeMnt: number;
  paymentInfo: string | null;
  contact: string | null;
  gameDates: Record<SchGame, string>;
  teamsPublished: Record<SchGame, boolean>;
};

const DEFAULT_TITLE = "Chuseok 2026 SCH Esport тэмцээн";

function defaultEvent(): SchEventView {
  return {
    loaded: false,
    title: DEFAULT_TITLE,
    intro: null,
    isOpen: true,
    deadline: null,
    feeKrw: 5000,
    feeMnt: 12000,
    paymentInfo: null,
    contact: null,
    gameDates: { ...SCH_DEFAULT_GAME_DATES },
    teamsPublished: { mobile_legends: false, cs2: false, dota2: false },
  };
}

function parseGameDates(raw: unknown): Record<SchGame, string> {
  const out = { ...SCH_DEFAULT_GAME_DATES };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isSchGame(k) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = v;
    }
  }
  return out;
}

function parseTeamsPublished(raw: unknown): Record<SchGame, boolean> {
  const out: Record<SchGame, boolean> = { mobile_legends: false, cs2: false, dota2: false };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isSchGame(k)) out[k] = v === true;
    }
  }
  return out;
}

/**
 * Public view of the singleton `sch_event` row. Never throws: when the
 * database is unreachable the defaults from lib/sch/schema.ts are returned
 * with `loaded: false`, registration is treated as open and the payment
 * details are "to be announced".
 */
export async function readSchEvent(): Promise<SchEventView> {
  try {
    const svc = createServiceClient();
    const { data, error } = await svc.from("sch_event").select("*").eq("id", 1).maybeSingle();
    if (error || !data) {
      if (error) log.warn("sch_event read failed — using defaults", { error: error.message });
      return defaultEvent();
    }
    const deadline = data.registration_deadline;
    const deadlineMs = deadline ? new Date(deadline).getTime() : NaN;
    const pastDeadline = Number.isFinite(deadlineMs) && deadlineMs <= Date.now();
    return {
      loaded: true,
      title: data.title?.trim() || DEFAULT_TITLE,
      intro: data.intro?.trim() || null,
      isOpen: data.registration_open && !pastDeadline,
      deadline: deadline ?? null,
      feeKrw: data.fee_krw,
      feeMnt: data.fee_mnt,
      paymentInfo: data.payment_info?.trim() || null,
      contact: data.contact?.trim() || null,
      gameDates: parseGameDates(data.game_dates),
      teamsPublished: parseTeamsPublished(data.teams_published),
    };
  } catch (err) {
    log.exception("sch_event read threw — using defaults", err);
    return defaultEvent();
  }
}

/* ─────────────────────────── request context ─────────────────────────── */

type RateBudget = typeof SCH_PREPARE_LIMIT | typeof SCH_SUBMIT_LIMIT;

async function requestContext() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipHash = createHash("sha256").update(ip).digest("hex");
  const userAgent = (h.get("user-agent") ?? "").slice(0, 300) || null;
  return { ipHash, userAgent };
}

/**
 * Spends one unit of `budget` for this IP and says whether it may proceed.
 * The mint step and the submit step have separate buckets
 * (lib/sch/submit.ts), so one registration costs one unit of each — never
 * two of the same.
 *
 * Three answers, not two: "limited" is the registrant's own doing and is
 * told as such; "unavailable" means the counter could not be consulted
 * (database outage — `checkRateLimit` fails closed with `count: -1`, or the
 * call threw). Both refuse, but the second must be reported as a service
 * problem so nobody is told to wait an hour for a fault that is not theirs.
 */
async function withinRateLimit(ipHash: string, budget: RateBudget): Promise<RateVerdict> {
  try {
    return rateLimitVerdict(await checkRateLimit(`sch:${ipHash}`, budget));
  } catch (err) {
    log.exception("sch rate limit check threw", err);
    return "unavailable";
  }
}

/* ─────────────────────────── 1. receipt upload ─────────────────────────── */

export type PrepareReceiptResult =
  | { ok: true; submissionId: string; path: string; token: string; signedUrl: string }
  | { error: "invalid" | "closed" | "rate_limited" | "unavailable" };

/**
 * Mints the submission id and a signed upload URL for its receipt. The
 * browser uploads straight to storage (Vercel caps request bodies at
 * 4.5 MB), then calls `submitSchRegistration` with the same ids.
 */
export async function prepareReceiptUpload(input: unknown): Promise<PrepareReceiptResult> {
  const mime = (input as { mime?: unknown } | null)?.mime;
  const bytes = (input as { bytes?: unknown } | null)?.bytes;
  // Upload allow-list, not the stored-mime list: HEIC is only kept for legacy rows.
  if (!isReceiptUploadMime(mime)) return { error: "invalid" };
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0 || bytes > RECEIPT_MAX_BYTES) {
    return { error: "invalid" };
  }

  const event = await readSchEvent();
  if (!event.isOpen) return { error: "closed" };

  const { ipHash } = await requestContext();
  const verdict = await withinRateLimit(ipHash, SCH_PREPARE_LIMIT);
  if (verdict === "limited") return { error: "rate_limited" };
  if (verdict === "unavailable") return { error: "unavailable" };

  const submissionId = randomUUID().toLowerCase();
  const path = receiptPath(submissionId, mime);
  try {
    const svc = createServiceClient();
    // `upsert: true` is carried INSIDE the signed token (storage-js only
    // sends x-upsert to the mint endpoint when asked here; the header the
    // browser adds to its PUT is ignored). Without it a retry after a PUT
    // whose response was lost answers 409 forever. The path is server-chosen
    // and single-purpose, so overwriting the same object is safe.
    const { data, error } = await svc.storage
      .from(SCH_RECEIPT_BUCKET)
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !data?.token || !data.signedUrl) {
      log.error("sch receipt signed upload url failed", { error: error?.message ?? "empty" });
      return { error: "unavailable" };
    }
    return { ok: true, submissionId, path, token: data.token, signedUrl: data.signedUrl };
  } catch (err) {
    log.exception("sch receipt signed upload url threw", err);
    return { error: "unavailable" };
  }
}

/* ─────────────────────────── 2. submit ─────────────────────────── */

export type SubmitSchResult =
  | {
      ok: true;
      submissionId: string;
      games: SchGame[];
      feeKrw: number;
      feeMnt: number;
      paymentInfo: string | null;
    }
  | { error: "duplicate"; game: SchGame }
  /** `fields` names the rejected answers (form keys) when the issue paths allow it. */
  | { error: "invalid"; fields?: SchFieldKey[] }
  | { error: "closed" | "rate_limited" | "receipt_missing" | "conflict" | "unavailable" };

type Verified = { mime: ReceiptMime; bytes: number };
type ReceiptCheck = { ok: true; receipt: Verified } | { ok: false; reason: "missing" | "unavailable" };

const EXT_TO_MIME: Record<string, ReceiptMime> = Object.fromEntries(
  (Object.entries(RECEIPT_MIME_EXT) as [ReceiptMime, string][]).map(([m, e]) => [e, m]),
) as Record<string, ReceiptMime>;

/**
 * The receipt must exist under the submission's folder, within limits.
 * "The object is not there" and "storage could not be asked" are different
 * answers: the first sends the registrant back to the upload step, the
 * second must not (their image is most likely in place).
 */
async function verifyReceipt(
  svc: ReturnType<typeof createServiceClient>,
  path: string,
): Promise<ReceiptCheck> {
  const m = RECEIPT_PATH_RE.exec(path);
  if (!m) return { ok: false, reason: "missing" };
  const folder = `submissions/${m[1]}`;
  const name = `receipt.${m[2]}`;
  let listed: Awaited<ReturnType<ReturnType<typeof svc.storage.from>["list"]>>;
  try {
    listed = await svc.storage.from(SCH_RECEIPT_BUCKET).list(folder, { limit: 20 });
  } catch (err) {
    log.exception("sch receipt list threw", err);
    return { ok: false, reason: "unavailable" };
  }
  if (listed.error) {
    log.error("sch receipt list failed", { error: listed.error.message });
    return { ok: false, reason: "unavailable" };
  }
  const obj = (listed.data ?? []).find((o) => o.name === name);
  if (!obj) return { ok: false, reason: "missing" };
  const meta = (obj.metadata ?? {}) as { size?: unknown; mimetype?: unknown };
  const bytes = typeof meta.size === "number" ? meta.size : Number(meta.size);
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > RECEIPT_MAX_BYTES) return { ok: false, reason: "missing" };
  const mime = isReceiptMime(meta.mimetype) ? meta.mimetype : EXT_TO_MIME[m[2]!];
  if (!mime) return { ok: false, reason: "missing" };
  return { ok: true, receipt: { mime, bytes: Math.round(bytes) } };
}

async function removeReceipt(svc: ReturnType<typeof createServiceClient>, path: string): Promise<void> {
  try {
    await svc.storage.from(SCH_RECEIPT_BUCKET).remove([path]);
  } catch (err) {
    log.exception("sch receipt cleanup failed", err);
  }
}

/**
 * Validates a whole submission and writes one `sch_registrations` row per
 * game in ONE insert (PostgREST multi-row inserts are atomic, so there is
 * never a partial submission to clean up). Duplicates are checked before the
 * insert so the registrant is told which game clashes; the unique indexes
 * remain the authority when two calls race.
 *
 * The receipt is removed only when the registrant can never use it
 * (registration closed). Every other failure keeps it in place so the retry
 * re-submits without re-uploading; anything abandoned is collected by the
 * organiser's sweep (sch_orphan_receipts). A replay of an already stored
 * submission (double click, retried request) returns the original success.
 */
export async function submitSchRegistration(input: unknown): Promise<SubmitSchResult> {
  const parsed = schSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    const fields = invalidFields(parsed.error.issues, input);
    return fields.length > 0 ? { error: "invalid", fields } : { error: "invalid" };
  }
  const { submission_id: submissionId, receipt_path: path, person, entries } = parsed.data;

  const svc = createServiceClient();
  const event = await readSchEvent();
  const games = entries.map((e) => e.game);
  const success = (stored: SchGame[]): SubmitSchResult => ({
    ok: true,
    submissionId,
    games: SCH_GAMES.filter((g) => stored.includes(g)),
    feeKrw: event.feeKrw,
    feeMnt: event.feeMnt,
    paymentInfo: event.paymentInfo,
  });

  /** Rows already stored under this id: a replay of this person's own submission, or a collision. */
  const settleExisting = async (): Promise<SubmitSchResult | null> => {
    const existing = await svc
      .from("sch_registrations")
      .select("game, email")
      .eq("submission_id", submissionId);
    if (existing.error) {
      log.error("sch submission lookup failed", { error: existing.error.message });
      return { error: "unavailable" };
    }
    const outcome = replayOutcome(existing.data ?? [], person.email);
    if (outcome.kind === "none") return null;
    if (outcome.kind === "conflict") return { error: "conflict" };
    return success(outcome.games);
  };

  try {
    // A replay must answer before the open/deadline gate: the rows exist.
    const replayed = await settleExisting();
    if (replayed) return replayed;

    if (!event.isOpen) {
      await removeReceipt(svc, path);
      return { error: "closed" };
    }

    const { ipHash, userAgent } = await requestContext();
    // Refused either way, the receipt stays — neither "try again in an hour"
    // nor "try again in a moment" may mean "upload the screenshot again".
    const verdict = await withinRateLimit(ipHash, SCH_SUBMIT_LIMIT);
    if (verdict === "limited") return { error: "rate_limited" };
    if (verdict === "unavailable") return { error: "unavailable" };

    // The receipt must already be in the bucket under this submission's folder.
    const check = await verifyReceipt(svc, path);
    if (!check.ok) return { error: check.reason === "missing" ? "receipt_missing" : "unavailable" };
    const { receipt } = check;

    // Pre-check game + email so a multi-game submit never half-succeeds.
    const dup = await svc
      .from("sch_registrations")
      .select("game")
      .eq("email", person.email)
      .in("game", games);
    if (dup.error) {
      log.error("sch duplicate pre-check failed", { error: dup.error.message });
      return { error: "unavailable" };
    }
    const taken = new Set((dup.data ?? []).map((r) => r.game));
    const clash = games.find((g) => taken.has(g));
    if (clash) return { error: "duplicate", game: clash };

    const rows = entries.map((entry) => {
      const row = registrationRow(entry);
      return {
        submission_id: submissionId,
        full_name: person.full_name,
        email: person.email,
        facebook: person.facebook,
        phone: person.phone,
        status: "pending",
        ip_hash: ipHash,
        user_agent: userAgent,
        receipt_path: path,
        receipt_mime: receipt.mime,
        receipt_bytes: receipt.bytes,
        ...row,
        answers: row.answers as Json,
      };
    });

    const { error } = await svc.from("sch_registrations").insert(rows);
    if (error) {
      const kind = classifyInsertError(error);
      if (kind.kind === "replay") {
        // A concurrent call with the same submission id won the race — its
        // rows are this person's; report them rather than touching them.
        const settled = await settleExisting();
        return settled ?? { error: "conflict" };
      }
      if (kind.kind === "duplicate") return { error: "duplicate", game: kind.game ?? games[0]! };
      log.error("sch registration insert failed", { code: error.code, error: error.message });
      return { error: "unavailable" };
    }
  } catch (err) {
    log.exception("sch registration submit threw", err);
    return { error: "unavailable" };
  }

  revalidatePath("/sch/admin");
  return success(games);
}
