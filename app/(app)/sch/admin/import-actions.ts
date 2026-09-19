"use server";

/**
 * SCH Esports organiser console — Google-Form sheet import.
 *
 * The console parses the downloaded response sheet in the browser and sends
 * the raw cells + the column mapping here. NOTHING the browser concluded is
 * trusted: both actions re-validate the payload and run `buildCandidates()`
 * again on the server. `previewSchImportAction` only reads (no row, no ledger
 * entry); `commitSchImportAction` inserts the new valid entries and writes one
 * `SCH_REGISTRATIONS_IMPORTED` ledger row that carries counts only — never a
 * registrant's name, e-mail or phone.
 *
 * Idempotent by construction: (game, lower(email)) is unique, and an imported
 * response gets a deterministic submission id (lib/sch/import-id.ts), so
 * uploading the same — or a grown — sheet again only adds the new people.
 *
 * Writes go through the RLS client like every other console action: the
 * "sch_registrations: organiser" policy (20260917131000) is `for all` and the
 * table grants INSERT to `authenticated`; the admin-privilege hardening
 * migration did not touch the sch_* tables. The ledger uses the service role.
 */

import { isIP } from "node:net";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { log } from "@/lib/log";
import { requireSchOrganiser, type AuthCtx } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/database.generated";
import { registrationRow, type SchGame } from "@/lib/sch/schema";
import { buildCandidates, schImportInputSchema } from "@/lib/sch/import";
import { importSubmissionId } from "@/lib/sch/import-id";
import {
  IMPORT_MAX_PAYLOAD_BYTES,
  type ImportCandidate,
  type SchImportPreview,
  type SchImportResult,
  type SchImportRowState,
  type SchImportRowVerdict,
  type SchImportTotals,
} from "@/lib/sch/import-types";

type RegistrationInsert = Database["public"]["Tables"]["sch_registrations"]["Insert"];
type RlsClient = Awaited<ReturnType<typeof createClient>>;

/** E-mails per existence lookup — one query per chunk, never one per row. */
const LOOKUP_CHUNK = 200;
const INSERT_BATCH = 100;
const UNIQUE_VIOLATION = "23505";

const commitInputSchema = schImportInputSchema.extend({ status: z.enum(["pending", "paid"]) });

/** One sheet row while it is being settled. `dup` = games seen earlier in the file. */
type Working = {
  candidate: ImportCandidate;
  verdict: SchImportRowVerdict;
  dup: SchGame[];
};

const pairKey = (game: string, email: string) => `${game}|${email.toLowerCase()}`;

/** Serialised size of what the client sent; anything unserialisable counts as oversized. */
function payloadBytes(input: unknown): number {
  try {
    const json = JSON.stringify(input);
    return typeof json === "string" ? Buffer.byteLength(json, "utf8") : 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * State rules. invalid: the person did not validate or no entry did.
 * Otherwise the first occurrence of (game, e-mail) in the sheet owns the pair
 * (as the unique index would decide); a later one is a duplicate. A row with
 * nothing new is `already_registered` when the database holds its entries and
 * `duplicate_in_file` when only the sheet does; a row that still adds
 * something is `partial` as soon as anything about it was dropped.
 */
function stateOf(w: Working): SchImportRowState {
  const { candidate: c, verdict: v } = w;
  if (!c.person || c.entries.length === 0) return "invalid";
  const existing = v.games_existing.length - w.dup.length;
  if (v.games_new.length === 0) return existing > 0 ? "already_registered" : "duplicate_in_file";
  return existing > 0 || w.dup.length > 0 || c.issues.length > 0 ? "partial" : "ready";
}

function totalsOf(work: Working[]): SchImportTotals {
  const totals: SchImportTotals = {
    rows: work.length, ready: 0, partial: 0, invalid: 0, duplicate_in_file: 0, already_registered: 0, entries_new: 0,
  };
  for (const w of work) {
    totals[w.verdict.state] += 1;
    totals.entries_new += w.verdict.games_new.length;
  }
  return totals;
}

/** (game, e-mail) pairs the database already holds, for the e-mails of this sheet. */
async function existingPairs(supabase: RlsClient, candidates: ImportCandidate[]): Promise<Set<string> | null> {
  const emails = [
    ...new Set(candidates.filter((c) => c.person && c.entries.length > 0).map((c) => c.person!.email)),
  ];
  const found = new Set<string>();
  for (let i = 0; i < emails.length; i += LOOKUP_CHUNK) {
    // Web and imported rows both store the e-mail lower-cased (zod transform),
    // so an `in` on the column sees what the lower(email) index would.
    const { data, error } = await supabase
      .from("sch_registrations")
      .select("game, email")
      .in("email", emails.slice(i, i + LOOKUP_CHUNK));
    if (error) {
      log.error("sch import lookup failed", { code: error.code, error: error.message });
      return null;
    }
    for (const r of data ?? []) found.add(pairKey(r.game, r.email));
  }
  return found;
}

function settle(candidates: ImportCandidate[], existing: Set<string>): Working[] {
  const seen = new Set<string>();
  return candidates.map((candidate) => {
    const verdict: SchImportRowVerdict = {
      row: candidate.row,
      // Name + e-mail only: the organiser uploaded them. No phone, no Facebook.
      name: candidate.person?.full_name ?? candidate.display.name,
      email: candidate.person?.email ?? candidate.display.email,
      games_new: [],
      games_existing: [],
      state: "invalid",
      issues: candidate.issues,
      has_receipt: candidate.receipt_url !== null,
    };
    const w: Working = { candidate, verdict, dup: [] };
    if (candidate.person) {
      for (const entry of candidate.entries) {
        const key = pairKey(entry.game, candidate.person.email);
        if (seen.has(key)) {
          w.dup.push(entry.game);
          verdict.games_existing.push(entry.game);
        } else if (existing.has(key)) {
          verdict.games_existing.push(entry.game);
        } else {
          verdict.games_new.push(entry.game);
        }
        seen.add(key);
      }
    }
    verdict.state = stateOf(w);
    return w;
  });
}

async function audit(detail: string, ctx: AuthCtx): Promise<void> {
  try {
    const h = await headers();
    // `audit_log.ip` is inet — only a literal address is stored (as in actions.ts).
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ip = isIP(forwarded) ? forwarded : null;
    const { error } = await createServiceClient().from("audit_log").insert({
      action: "SCH_REGISTRATIONS_IMPORTED",
      detail: detail.slice(0, 500),
      user_id: ctx.user.id,
      user_email: ctx.user.email,
      ip,
    });
    if (error) log.error("sch import audit row rejected", { error: error.message });
  } catch (err) {
    log.exception("sch import audit row failed", err);
  }
}

// ── Preview ───────────────────────────────────────────────────────────

/** Read-only: what a commit of this sheet + mapping would do. Writes nothing. */
export async function previewSchImportAction(input: unknown): Promise<SchImportPreview> {
  await requireSchOrganiser();
  if (payloadBytes(input) > IMPORT_MAX_PAYLOAD_BYTES) return { error: "too_large" };
  const parsed = schImportInputSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  try {
    const candidates = buildCandidates(parsed.data);
    const existing = await existingPairs(await createClient(), candidates);
    if (!existing) return { error: "unavailable" };
    const work = settle(candidates, existing);
    return { ok: true, rows: work.map((w) => w.verdict), totals: totalsOf(work) };
  } catch (err) {
    log.exception("sch import preview threw", err);
    return { error: "unavailable" };
  }
}

// ── Commit ────────────────────────────────────────────────────────────

export async function commitSchImportAction(input: unknown): Promise<SchImportResult> {
  const ctx = await requireSchOrganiser();
  if (payloadBytes(input) > IMPORT_MAX_PAYLOAD_BYTES) return { error: "too_large" };
  const parsed = commitInputSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { status, ...sheet } = parsed.data;

  let inserted = 0;
  let failed = false;
  let work: Working[] = [];
  try {
    const supabase = await createClient();
    const candidates = buildCandidates(sheet);
    const existing = await existingPairs(supabase, candidates);
    if (!existing) return { error: "unavailable" };
    work = settle(candidates, existing);

    const paidAt = status === "paid" ? new Date().toISOString() : null;
    const pending: Array<{ w: Working; game: SchGame; row: RegistrationInsert }> = [];
    for (const w of work) {
      const { candidate: c } = w;
      if (!c.person) continue;
      for (const entry of c.entries) {
        if (!w.verdict.games_new.includes(entry.game)) continue;
        const row = registrationRow(entry);
        pending.push({
          w,
          game: entry.game,
          row: {
            ...row,
            answers: row.answers as Json,
            submission_id: importSubmissionId(c.person.email, c.submitted_at, c.row),
            full_name: c.person.full_name,
            email: c.person.email,
            facebook: c.person.facebook,
            phone: c.person.phone,
            source: "import",
            // The receipt of an imported row is the form owner's Drive link.
            receipt_url: c.receipt_url,
            receipt_path: null,
            submitted_at: c.submitted_at,
            status,
            paid_at: paidAt,
            ip_hash: null,
            user_agent: null,
          },
        });
      }
    }

    /** Someone registered this pair between the lookup and the insert. */
    const raced = (item: (typeof pending)[number]) => {
      const v = item.w.verdict;
      v.games_new = v.games_new.filter((g) => g !== item.game);
      v.games_existing.push(item.game);
      v.state = stateOf(item.w);
    };

    batches: for (let i = 0; i < pending.length; i += INSERT_BATCH) {
      const batch = pending.slice(i, i + INSERT_BATCH);
      const { error } = await supabase.from("sch_registrations").insert(batch.map((b) => b.row));
      if (!error) {
        inserted += batch.length;
        continue;
      }
      if (error.code !== UNIQUE_VIOLATION) {
        log.error("sch import insert failed", { code: error.code, error: error.message, batch: i / INSERT_BATCH });
        failed = true;
        break;
      }
      // A multi-row insert is atomic: one raced pair rejected the whole batch.
      // Replay it row by row so only that pair is skipped.
      for (const item of batch) {
        const one = await supabase.from("sch_registrations").insert(item.row);
        if (!one.error) inserted += 1;
        else if (one.error.code === UNIQUE_VIOLATION) raced(item);
        else {
          log.error("sch import row insert failed", { code: one.error.code, error: one.error.message, row: item.w.verdict.row });
          failed = true;
          break batches;
        }
      }
    }
  } catch (err) {
    log.exception("sch import commit threw", err);
    failed = true;
  }

  const totals = totalsOf(work);
  // Rows written before a failure are real: the ledger and the console must
  // show them even though the organiser is told to retry (a retry is safe —
  // the import is idempotent).
  if (inserted > 0 || !failed) {
    await audit(
      `inserted=${inserted} existing=${totals.already_registered} invalid=${totals.invalid} duplicate=${totals.duplicate_in_file} rows=${totals.rows} status=${status}${failed ? " failed=1" : ""}`,
      ctx,
    );
    revalidatePath("/sch/admin");
  }
  if (failed) return { error: "unavailable" };
  return { ok: true, inserted, totals };
}
