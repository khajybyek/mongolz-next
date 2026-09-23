"use server";

/**
 * SCH Esports organiser console — server actions.
 *
 * Every mutation: admin with second factor or the organiser role (`requireSchOrganiser`), input validated
 * with zod / the guards in `lib/sch/schema.ts`, data written with the
 * service client AFTER that gate, one `audit_log` row, then `revalidatePath`.
 * The sch_* tables are service-role-write only (20260923170000): the
 * organiser works without a second factor, so a user token that PostgREST
 * accepts must not be able to change the payment account or the roster
 * behind the ledger and the security_event alarm. Every CAS predicate below
 * is kept as it was — the service role skips RLS, not the filters.
 * Results are plain objects — nothing throws to the client. Audit details
 * carry ids only, never a registrant's name, email or phone.
 */

import { isIP } from "node:net";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import type { Database, Json } from "@/lib/database.generated";
import { log } from "@/lib/log";
import { requireSchOrganiser, type AuthCtx } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/workflow-query";
import {
  SCH_DRAW_STATUSES,
  SCH_GAMES,
  SCH_LIMITS,
  SCH_RECEIPT_BUCKET,
  SCH_TEAM_SIZE,
  isSchGame,
  isSchStatus,
  registrationRow,
  schGameEntrySchema,
  schPersonSchema,
  type SchGame,
  type SchStatus,
} from "@/lib/sch/schema";
import { drawTeams, type DrawPlayer } from "@/lib/sch/teams";
import { scheduleSecurityEvent } from "@/lib/notify";
import { classifyInsertError } from "@/lib/sch/submit";
import { SCH_CLOSE_OUT_WORD, closeOutAllowed } from "@/lib/sch/close-out";
import { ensureFreshReauth } from "@/lib/auth/step-up";

export type SchActionResult =
  | { ok: true }
  | { error: "invalid" | "conflict" | "unavailable" }
  /**
   * Edit only: the unique index refused the correction — the e-mail is
   * already registered for that game (`duplicate_email`), or the same
   * submission already holds an entry for that game (`duplicate_game`).
   * Retrying cannot help; the organiser has to change the value.
   */
  | { error: "duplicate_email" | "duplicate_game" }
  /** A game was ticked as published while it has no saved teams. */
  | { error: "no_teams"; game: SchGame };

export type SchSweepResult = { ok: true; removed: number } | { error: "unavailable" };

export interface SchRegistrationEditInput {
  id: string;
  full_name: string;
  email: string;
  facebook: string;
  phone: string;
  game: string;
  in_game_id: string;
  rank_label: string;
  roles: string[];
  premier_rank: string;
  faceit: string;
  /**
   * `updated_at` of the row as the dialog saw it when it opened. The save is
   * refused (conflict) if anyone changed the row since, so a stale dialog can
   * never silently overwrite another organiser's correction.
   */
  expected_updated_at: string;
}

/**
 * JSON with object keys sorted recursively. jsonb hands keys back in its own
 * order (shorter keys first), so `{premier_rank, faceit}` written by the
 * action reads back as `{faceit, premier_rank}` — a plain JSON.stringify
 * comparison would call every CS2 row "changed". Array order is kept: it is
 * stored data (roles are shown in the order they were picked).
 */
function stableJson(value: unknown): string {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, norm(x)]),
          )
        : v ?? null;
  return JSON.stringify(norm(value));
}

/** Same instant, whatever precision/offset notation each side used. */
function sameInstant(a: string, b: string): boolean {
  if (a === b) return true;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

const MAX_DRAW_PLAYERS = 500;
/** Receipts younger than this are never swept (see sch_orphan_receipts). */
const SWEEP_OLDER_THAN_HOURS = 24;
const SWEEP_BATCH = 200;

async function audit(action: string, detail: string, ctx: AuthCtx): Promise<void> {
  try {
    const h = await headers();
    // `audit_log.ip` is inet: an unparsable forwarded-for value would reject
    // the whole ledger row, so only a literal address is stored (same guard
    // as the receipt viewer route).
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ip = isIP(forwarded) ? forwarded : null;
    const { error } = await createServiceClient().from("audit_log").insert({
      action,
      detail: detail.slice(0, 500),
      user_id: ctx.user.id,
      user_email: ctx.user.email,
      ip,
    });
    if (error) log.error("sch audit row rejected", { action, error: error.message });
  } catch (err) {
    // The ledger must never turn a finished write into a client error —
    // but a dropped row must at least be visible in the logs.
    log.exception("sch audit row failed", err, { action });
  }
}

function refreshAdmin(): void {
  revalidatePath("/sch/admin");
}

function refreshPublic(): void {
  revalidatePath("/sch");
  revalidatePath("/sch/teams");
}

// ── Registrations ─────────────────────────────────────────────────────

/** Organisers move rows between pending / paid / waitlist / rejected. */
const ORGANISER_STATUSES: readonly SchStatus[] = ["pending", "paid", "waitlist", "rejected"];

/**
 * Correct a submitted registration from the organiser console. The public
 * form schemas remain the single source of truth, so an admin cannot save a
 * combination that the registrant could not have submitted themselves.
 */
export async function updateRegistrationAction(input: SchRegistrationEditInput): Promise<SchActionResult> {
  const ctx = await requireSchOrganiser();
  if (!UUID_RE.test(input?.id ?? "") || !isSchGame(input?.game)) return { error: "invalid" };
  const expectedUpdatedAt = input.expected_updated_at;
  if (
    typeof expectedUpdatedAt !== "string" ||
    expectedUpdatedAt.length > 64 ||
    !Number.isFinite(Date.parse(expectedUpdatedAt))
  ) {
    return { error: "invalid" };
  }

  const person = schPersonSchema.safeParse({
    full_name: input.full_name,
    email: input.email,
    facebook: input.facebook,
    phone: input.phone,
  });
  const entry = schGameEntrySchema.safeParse(
    input.game === "mobile_legends"
      ? { game: input.game, rank: input.rank_label, roles: input.roles, in_game_id: input.in_game_id }
      : input.game === "dota2"
        ? { game: input.game, rank: input.rank_label, roles: input.roles, steam_url: input.in_game_id }
        : { game: input.game, premier_rank: input.premier_rank, steam_url: input.in_game_id, faceit: input.faceit },
  );
  if (!person.success || !entry.success) return { error: "invalid" };

  const id = input.id.toLowerCase();
  const gameFields = registrationRow(entry.data);
  try {
    const supabase = createServiceClient();
    const { data: current, error: readError } = await supabase
      .from("sch_registrations")
      .select("id, game, full_name, email, facebook, phone, in_game_id, rank_label, rank_score, roles, answers, team_id, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (readError) return { error: "unavailable" };
    if (!current) return { error: "conflict" };
    // Before the no-op shortcut: a stale dialog is a conflict even when its
    // draft happens to equal the row as it is now.
    if (!sameInstant(current.updated_at, expectedUpdatedAt)) return { error: "conflict" };

    const gameChanged = current.game !== gameFields.game;
    const patch: Database["public"]["Tables"]["sch_registrations"]["Update"] = {
      ...person.data,
      ...gameFields,
      answers: gameFields.answers as Json,
      ...(gameChanged && current.team_id ? { team_id: null } : {}),
    };
    const changed = Object.keys(patch).filter((key) => {
      const column = key as keyof typeof patch;
      return stableJson(current[column as keyof typeof current]) !== stableJson(patch[column]);
    });
    if (changed.length === 0) return { ok: true };

    const { data: updated, error } = await supabase
      .from("sch_registrations")
      .update(patch)
      .eq("id", id)
      .eq("updated_at", current.updated_at)
      .select("id")
      .maybeSingle();
    if (error) {
      if (error.code !== "23505") return { error: "unavailable" };
      // sch_registrations_submission_game_idx → this submission already has
      // the target game; sch_registrations_game_email_idx → the e-mail does.
      return { error: classifyInsertError(error).kind === "replay" ? "duplicate_game" : "duplicate_email" };
    }
    if (!updated) return { error: "conflict" };

    await audit(
      "SCH_REGISTRATION_EDITED",
      `registration=${id} game=${current.game}→${gameFields.game} fields=${changed.sort().join(",")}`,
      ctx,
    );
    refreshAdmin();
    // Names, game ids, ranks and team membership appear on the public roster.
    refreshPublic();
    return { ok: true };
  } catch {
    return { error: "unavailable" };
  }
}

export async function setRegistrationStatusAction(input: {
  id: string;
  status: string;
}): Promise<SchActionResult> {
  const ctx = await requireSchOrganiser();
  if (!UUID_RE.test(input?.id ?? "") || !isSchStatus(input?.status) || !ORGANISER_STATUSES.includes(input.status)) {
    return { error: "invalid" };
  }
  const id = input.id.toLowerCase();
  const next = input.status;
  try {
    const supabase = createServiceClient();
    const { data: row, error: readError } = await supabase
      .from("sch_registrations")
      .select("id, game, status, paid_at, team_id")
      .eq("id", id)
      .maybeSingle();
    if (readError) return { error: "unavailable" };
    if (!row) return { error: "conflict" };

    // Team membership is a paid player's seat. Leaving the draw statuses
    // (reject, cancel, waitlist, reopen) gives the seat up at once, so the
    // public roster never keeps showing someone the organiser withdrew.
    const dropsTeam = Boolean(row.team_id) && !SCH_DRAW_STATUSES.includes(next);
    const patch: { status: SchStatus; paid_at: string | null; team_id?: null } = {
      status: next,
      paid_at: next === "paid" ? row.paid_at ?? new Date().toISOString() : null,
      ...(dropsTeam ? { team_id: null } : {}),
    };
    const { data: updated, error } = await supabase
      .from("sch_registrations")
      .update(patch)
      .eq("id", id)
      .eq("status", row.status)
      .select("id")
      .maybeSingle();
    if (error) return { error: "unavailable" };
    if (!updated) return { error: "conflict" };

    await audit(
      "SCH_REGISTRATION_STATUS",
      `registration=${id} game=${row.game} ${row.status}→${next}${dropsTeam ? ` team=${row.team_id} cleared` : ""}`,
      ctx,
    );
    refreshAdmin();
    // The public roster filters members by draw status as well; revalidate
    // so a withdrawn player disappears without waiting for the cache.
    revalidatePath("/sch/teams");
    return { ok: true };
  } catch {
    return { error: "unavailable" };
  }
}

export async function setCheckInAction(input: {
  id: string;
  checkedIn: boolean;
}): Promise<SchActionResult> {
  const ctx = await requireSchOrganiser();
  if (!UUID_RE.test(input?.id ?? "") || typeof input?.checkedIn !== "boolean") return { error: "invalid" };
  const id = input.id.toLowerCase();
  try {
    const supabase = createServiceClient();
    const { data: updated, error } = await supabase
      .from("sch_registrations")
      .update({ checked_in_at: input.checkedIn ? new Date().toISOString() : null })
      .eq("id", id)
      .select("id, game")
      .maybeSingle();
    if (error) return { error: "unavailable" };
    if (!updated) return { error: "conflict" };
    await audit("SCH_REGISTRATION_CHECKIN", `registration=${id} game=${updated.game} checked_in=${input.checkedIn}`, ctx);
    refreshAdmin();
    return { ok: true };
  } catch {
    return { error: "unavailable" };
  }
}

export async function setRegistrationNoteAction(input: {
  id: string;
  note: string;
}): Promise<SchActionResult> {
  const ctx = await requireSchOrganiser();
  const parsed = z
    .object({
      id: z.string().regex(UUID_RE),
      note: z.string().max(SCH_LIMITS.notes.max),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const id = parsed.data.id.toLowerCase();
  const note = parsed.data.note.trim() || null;
  try {
    const supabase = createServiceClient();
    const { data: updated, error } = await supabase
      .from("sch_registrations")
      .update({ notes: note })
      .eq("id", id)
      .select("id, game")
      .maybeSingle();
    if (error) return { error: "unavailable" };
    if (!updated) return { error: "conflict" };
    await audit("SCH_REGISTRATION_NOTE", `registration=${id} game=${updated.game} note=${note ? "set" : "cleared"}`, ctx);
    refreshAdmin();
    return { ok: true };
  } catch {
    return { error: "unavailable" };
  }
}

export async function deleteRegistrationAction(input: { id: string }): Promise<SchActionResult> {
  const ctx = await requireSchOrganiser();
  if (!UUID_RE.test(input?.id ?? "")) return { error: "invalid" };
  const id = input.id.toLowerCase();
  try {
    const supabase = createServiceClient();
    const { data: row, error: readError } = await supabase
      .from("sch_registrations")
      .select("id, game, submission_id, receipt_path, team_id")
      .eq("id", id)
      .maybeSingle();
    if (readError) return { error: "unavailable" };
    if (!row) return { error: "conflict" };

    const { data: deleted, error } = await supabase
      .from("sch_registrations")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) return { error: "unavailable" };
    if (!deleted) return { error: "conflict" };

    // The receipt is shared by every row of the submission (one screenshot
    // for the total); drop the object only once the last row is gone.
    // A count that could not be read (`error` set, `count` null) is NOT
    // "no rows left": a sibling row of a multi-game submission may still
    // reference the object. On doubt the image stays; an orphan is picked up
    // later by sweepOrphanReceiptsAction, a deleted receipt is gone for good.
    if (row.receipt_path) {
      const { count, error: countError } = await supabase
        .from("sch_registrations")
        .select("id", { count: "exact", head: true })
        .eq("submission_id", row.submission_id);
      if (countError) log.warn("sch receipt sibling count failed — keeping the object", { error: countError.message });
      if (!countError && count === 0) {
        try {
          // Service role: the receipts bucket has no storage policy (20260917110000).
          const svc = createServiceClient();
          await svc.storage.from(SCH_RECEIPT_BUCKET).remove([row.receipt_path]);
        } catch {
          // Best effort — the row is gone; an orphaned object is not a data leak.
        }
      }
    }

    const deletedDetail = `registration=${id} game=${row.game} submission=${row.submission_id}`;
    await audit("SCH_REGISTRATION_DELETED", deletedDetail, ctx);
    scheduleSecurityEvent({
      action: "SCH_REGISTRATION_DELETED",
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      detail: `role=${ctx.profile.role} ${deletedDetail}`,
    });
    refreshAdmin();
    if (row.team_id) revalidatePath("/sch/teams");
    return { ok: true };
  } catch {
    return { error: "unavailable" };
  }
}

// ── Event settings ────────────────────────────────────────────────────

const KST_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const optionalText = (max: number) =>
  z.string().max(max * 2).transform((v) => v.trim().slice(0, max)).transform((v) => (v ? v : null));

const feeSchema = z.number().int().min(0).max(100_000_000);

const settingsSchema = z.object({
  title: z.string().trim().min(3).max(120),
  intro: optionalText(4000),
  registration_open: z.boolean(),
  /** KST wall-clock "YYYY-MM-DDTHH:mm" from a datetime-local input, or "". */
  registration_deadline: z
    .string()
    .trim()
    .max(32)
    .refine((v) => v === "" || KST_LOCAL_RE.test(v), { message: "deadline" })
    .transform((v) => {
      if (!v) return null;
      const d = new Date(`${v}+09:00`);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    })
    .refine((v) => v !== undefined, { message: "deadline" }),
  fee_krw: feeSchema,
  fee_mnt: feeSchema,
  payment_info: optionalText(1000),
  contact: optionalText(300),
  game_dates: z.object({
    mobile_legends: z.string().regex(DAY_RE),
    cs2: z.string().regex(DAY_RE),
    dota2: z.string().regex(DAY_RE),
  }),
  teams_published: z.object({
    mobile_legends: z.boolean(),
    cs2: z.boolean(),
    dota2: z.boolean(),
  }),
});
export type SchEventSettingsInput = z.input<typeof settingsSchema>;

export async function updateEventSettingsAction(input: SchEventSettingsInput): Promise<SchActionResult> {
  const ctx = await requireSchOrganiser();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const v = parsed.data;
  try {
    const supabase = createServiceClient();
    const { data: before } = await supabase
      .from("sch_event")
      .select("registration_open, teams_published, payment_info")
      .eq("id", 1)
      .maybeSingle();

    // Same guard as setTeamsPublishedAction: a game cannot be published
    // without saved teams, whichever control flips the flag.
    const wantsPublished = SCH_GAMES.filter((g) => v.teams_published[g]);
    if (wantsPublished.length > 0) {
      const { data: teamRows, error: teamsError } = await supabase
        .from("sch_teams")
        .select("game")
        .in("game", wantsPublished);
      if (teamsError) return { error: "unavailable" };
      const withTeams = new Set((teamRows ?? []).map((t) => t.game));
      const missing = wantsPublished.find((g) => !withTeams.has(g));
      if (missing) return { error: "no_teams", game: missing };
    }

    const { data: updated, error } = await supabase
      .from("sch_event")
      .update({
        title: v.title,
        intro: v.intro,
        registration_open: v.registration_open,
        registration_deadline: v.registration_deadline ?? null,
        fee_krw: v.fee_krw,
        fee_mnt: v.fee_mnt,
        payment_info: v.payment_info,
        contact: v.contact,
        game_dates: v.game_dates,
        teams_published: v.teams_published,
        updated_by: ctx.user.id,
      })
      .eq("id", 1)
      .select("id")
      .maybeSingle();
    if (error) return { error: "unavailable" };
    if (!updated) return { error: "conflict" };

    const published = SCH_GAMES.filter((g) => v.teams_published[g]).join(",") || "none";
    // The payment details are what registrants send money to — the one field
    // a hijacked (TOTP-less) organiser session would change. The ledger says
    // whether it changed (never the account numbers), and the admins are told
    // in real time.
    const paymentChanged =
      JSON.stringify(before?.payment_info ?? null) !== JSON.stringify(v.payment_info ?? null);
    const eventDetail = `open=${v.registration_open} deadline=${v.registration_deadline ?? "none"} fee_krw=${v.fee_krw} fee_mnt=${v.fee_mnt} published=${published} payment_info_changed=${paymentChanged}`;
    await audit("SCH_EVENT_UPDATED", eventDetail, ctx);
    if (paymentChanged) {
      scheduleSecurityEvent({
        action: "SCH_PAYMENT_INFO_CHANGED",
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        detail: `role=${ctx.profile.role} ${eventDetail}`,
      });
    }
    const publishedBefore = publishedMap(before?.teams_published);
    const publishChanged = SCH_GAMES.some((g) => publishedBefore[g] !== v.teams_published[g]);
    if (publishChanged) {
      await audit("SCH_TEAMS_PUBLISHED", `published=${published} (via settings)`, ctx);
    }
    refreshAdmin();
    refreshPublic();
    return { ok: true };
  } catch {
    return { error: "unavailable" };
  }
}

function publishedMap(value: unknown): Record<SchGame, boolean> {
  const src = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    mobile_legends: src.mobile_legends === true,
    cs2: src.cs2 === true,
    dota2: src.dota2 === true,
  };
}

// ── Team draw ─────────────────────────────────────────────────────────

const saveTeamsSchema = z.object({
  game: z.string().refine(isSchGame, { message: "game" }),
  seed: z.number().int().min(0).max(0xffffffff),
  /** The eligible ids the organiser previewed — the server refuses to save a draw over a changed pool. */
  playerIds: z.array(z.string().regex(UUID_RE)).max(MAX_DRAW_PLAYERS),
  /**
   * The rosters the organiser previewed, as player ids per team in seed
   * order. A rank or role edit after the preview changes what the seed
   * produces; the save is refused instead of storing teams nobody saw.
   */
  teams: z.array(z.array(z.string().regex(UUID_RE)).max(MAX_DRAW_PLAYERS)).max(MAX_DRAW_PLAYERS),
});

/** Same teams in the same seed order, member order irrelevant. */
function sameRosters(previewed: readonly string[][], drawn: readonly { players: readonly { id: string }[] }[]): boolean {
  if (previewed.length !== drawn.length) return false;
  const key = (ids: readonly string[]) => ids.map((id) => id.toLowerCase()).sort().join(",");
  return drawn.every((t, i) => key(t.players.map((p) => p.id)) === key(previewed[i]));
}

/**
 * Replace the saved teams of one game with the draw for `seed`. The draw is
 * recomputed here from the live eligible pool (drawTeams is deterministic)
 * and compared with the rosters the organiser previewed, so what they saw is
 * exactly what gets saved. If the pool changed under them (someone marked
 * paid meanwhile) or a rank / role edit changed what the seed produces, it
 * is a conflict.
 */
export async function saveTeamsAction(input: {
  game: string;
  seed: number;
  playerIds: string[];
  teams: string[][];
}): Promise<SchActionResult> {
  const ctx = await requireSchOrganiser();
  const parsed = saveTeamsSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const game = parsed.data.game as SchGame;
  const { seed } = parsed.data;
  const expected = new Set(parsed.data.playerIds.map((id) => id.toLowerCase()));

  try {
    const supabase = createServiceClient();
    const { data: rows, error: readError } = await supabase
      .from("sch_registrations")
      .select("id, full_name, rank_score, roles")
      .eq("game", game)
      .in("status", [...SCH_DRAW_STATUSES])
      .order("created_at", { ascending: true })
      .limit(MAX_DRAW_PLAYERS + 1);
    if (readError) return { error: "unavailable" };
    const pool = rows ?? [];
    if (pool.length > MAX_DRAW_PLAYERS) return { error: "invalid" };
    if (pool.length !== expected.size || pool.some((r) => !expected.has(r.id.toLowerCase()))) {
      return { error: "conflict" };
    }

    const players: DrawPlayer[] = pool.map((r) => ({
      id: r.id,
      name: r.full_name,
      score: r.rank_score,
      roles: r.roles ?? [],
    }));
    const result = drawTeams(players, { seed, teamSize: SCH_TEAM_SIZE });
    if (result.teams.length === 0) return { error: "invalid" };
    if (!sameRosters(parsed.data.teams, result.teams)) return { error: "conflict" };

    // Old teams go first; the FK (on delete set null) clears every team_id of
    // this game, including players that are no longer eligible.
    const { error: deleteError } = await supabase.from("sch_teams").delete().eq("game", game);
    if (deleteError) return { error: "unavailable" };

    const { data: inserted, error: insertError } = await supabase
      .from("sch_teams")
      .insert(
        result.teams.map((t) => ({
          game,
          name: t.name,
          seed: t.seed,
          strength: t.strength,
          created_by: ctx.user.id,
        })),
      )
      .select("id, seed");
    if (insertError || !inserted || inserted.length !== result.teams.length) return { error: "unavailable" };

    const idBySeed = new Map(inserted.map((t) => [t.seed, t.id]));
    for (const team of result.teams) {
      const teamId = idBySeed.get(team.seed);
      if (!teamId) return { error: "unavailable" };
      const { error: linkError } = await supabase
        .from("sch_registrations")
        .update({ team_id: teamId })
        .in("id", team.players.map((p) => p.id));
      if (linkError) return { error: "unavailable" };
    }

    await audit(
      "SCH_TEAMS_DRAWN",
      `game=${game} seed=${result.seed} teams=${result.teams.length} substitutes=${result.substitutes.length} players=${players.length}`,
      ctx,
    );
    refreshAdmin();
    refreshPublic();
    return { ok: true };
  } catch {
    return { error: "unavailable" };
  }
}

export async function setTeamsPublishedAction(input: {
  game: string;
  published: boolean;
}): Promise<SchActionResult> {
  const ctx = await requireSchOrganiser();
  if (!isSchGame(input?.game) || typeof input?.published !== "boolean") return { error: "invalid" };
  const game: SchGame = input.game;
  try {
    const supabase = createServiceClient();
    if (input.published) {
      const { count, error: countError } = await supabase
        .from("sch_teams")
        .select("id", { count: "exact", head: true })
        .eq("game", game);
      if (countError) return { error: "unavailable" };
      if ((count ?? 0) === 0) return { error: "invalid" };
    }
    const { data: event, error: readError } = await supabase
      .from("sch_event")
      .select("teams_published")
      .eq("id", 1)
      .maybeSingle();
    if (readError) return { error: "unavailable" };
    if (!event) return { error: "conflict" };
    const next = { ...publishedMap(event.teams_published), [game]: input.published };
    const { data: updated, error } = await supabase
      .from("sch_event")
      .update({ teams_published: next, updated_by: ctx.user.id })
      .eq("id", 1)
      .select("id")
      .maybeSingle();
    if (error) return { error: "unavailable" };
    if (!updated) return { error: "conflict" };

    await audit("SCH_TEAMS_PUBLISHED", `game=${game} published=${input.published}`, ctx);
    refreshAdmin();
    refreshPublic();
    return { ok: true };
  } catch {
    return { error: "unavailable" };
  }
}

// ── Receipt hygiene ───────────────────────────────────────────────────

type OrphanRpcClient = {
  rpc: (
    fn: "sch_orphan_receipts",
    args: { p_older_than_hours: number; p_limit: number },
  ) => PromiseLike<{ data: unknown; error: { message?: string | null } | null }>;
};

/**
 * Remove receipt images that no registration references and that are older
 * than a day. The browser uploads the screenshot BEFORE the rows exist, so
 * an abandoned form (validation error, closed tab, lost connection) leaves a
 * bank screenshot in the private bucket with no owner. `sch_orphan_receipts`
 * (20260917120000) lists them; the objects are removed with the service
 * client because the bucket has no storage policy by design.
 */
export async function sweepOrphanReceiptsAction(): Promise<SchSweepResult> {
  const ctx = await requireSchOrganiser();
  try {
    // Service role: the receipts bucket has no storage policy (20260917110000).
    const svc = createServiceClient();
    const { data, error } = await (svc as unknown as OrphanRpcClient).rpc("sch_orphan_receipts", {
      p_older_than_hours: SWEEP_OLDER_THAN_HOURS,
      p_limit: SWEEP_BATCH,
    });
    if (error) return { error: "unavailable" };
    const names = (Array.isArray(data) ? data : [])
      .map((r) => (r && typeof r === "object" ? (r as { name?: unknown }).name : null))
      .filter((n): n is string => typeof n === "string" && n.startsWith("submissions/"));

    let removed = 0;
    for (let i = 0; i < names.length; i += 100) {
      const batch = names.slice(i, i + 100);
      const { data: gone, error: removeError } = await svc.storage.from(SCH_RECEIPT_BUCKET).remove(batch);
      if (removeError) break;
      removed += gone?.length ?? 0;
    }

    await audit(
      "SCH_RECEIPTS_SWEPT",
      `removed=${removed} candidates=${names.length} older_than=${SWEEP_OLDER_THAN_HOURS}h`,
      ctx,
    );
    return { ok: true, removed };
  } catch {
    return { error: "unavailable" };
  }
}

// ── Close-out (post-event purge) ──────────────────────────────────────

export type SchCloseOutResult =
  | { ok: true; registrations: number; teams: number; receipts: number }
  | { error: "REAUTH_REQUIRED" | "forbidden" | "too_early" | "invalid" | "unavailable" };

const CLOSE_OUT_CHUNK = 100;

/**
 * Delete the tournament's personal data once it is over: every receipt image
 * in the private bucket, every registration and every team, and close the
 * form. Admin only, with a fresh TOTP step-up (the organiser role has no
 * second factor), a typed confirmation, and only from 00:00 KST on the day
 * after the last game day — it cannot run while the tournament does.
 *
 * Receipts go first: a receipt path is found through its row, so deleting
 * the rows first would turn a failed removal into an object nobody can find.
 * Anything left after the rows are gone is an orphan by definition and one
 * `sch_orphan_receipts` pass picks it up. Imported rows point at the Google
 * Form owner's Drive, which only that owner can delete (the console says so).
 * The ledger row and the alarm carry counts only.
 */
export async function closeOutEventAction(input: { confirm: string }): Promise<SchCloseOutResult> {
  const ctx = await requireSchOrganiser();
  if (ctx.profile.role !== "admin") return { error: "forbidden" };
  if (input?.confirm !== SCH_CLOSE_OUT_WORD) return { error: "invalid" };
  const reauth = await ensureFreshReauth(ctx.user.id);
  if (reauth) return reauth;

  try {
    const svc = createServiceClient();
    const { data: event, error: eventError } = await svc
      .from("sch_event")
      .select("game_dates")
      .eq("id", 1)
      .maybeSingle();
    if (eventError) return { error: "unavailable" };
    if (!closeOutAllowed(event?.game_dates)) return { error: "too_early" };

    // 1. Nobody can register (or be shown on a roster) while the purge runs.
    const { error: closeError } = await svc
      .from("sch_event")
      .update({
        registration_open: false,
        teams_published: { mobile_legends: false, cs2: false, dota2: false },
        updated_by: ctx.user.id,
      })
      .eq("id", 1);
    if (closeError) return { error: "unavailable" };

    const { data: rows, error: readError } = await svc
      .from("sch_registrations")
      .select("id, receipt_path");
    if (readError) return { error: "unavailable" };
    const ids = (rows ?? []).map((r) => r.id);
    const paths = [...new Set((rows ?? []).map((r) => r.receipt_path).filter((p): p is string => Boolean(p)))];

    // 2. Receipt images while their rows still point at them.
    let receipts = 0;
    for (let i = 0; i < paths.length; i += CLOSE_OUT_CHUNK) {
      const { data: gone, error } = await svc.storage.from(SCH_RECEIPT_BUCKET).remove(paths.slice(i, i + CLOSE_OUT_CHUNK));
      if (error) return { error: "unavailable" };
      receipts += gone?.length ?? 0;
    }

    // 3. Registrations, then teams (the FK would null the seats anyway).
    let registrations = 0;
    for (let i = 0; i < ids.length; i += CLOSE_OUT_CHUNK) {
      const { data: deleted, error } = await svc
        .from("sch_registrations")
        .delete()
        .in("id", ids.slice(i, i + CLOSE_OUT_CHUNK))
        .select("id");
      if (error) return { error: "unavailable" };
      registrations += deleted?.length ?? 0;
    }
    const { data: teamsGone, error: teamsError } = await svc
      .from("sch_teams")
      .delete()
      .in("game", [...SCH_GAMES])
      .select("id");
    if (teamsError) return { error: "unavailable" };

    // 4. Abandoned uploads that never had a row (best effort).
    try {
      const { data: orphans } = await (svc as unknown as OrphanRpcClient).rpc("sch_orphan_receipts", {
        p_older_than_hours: 2,
        p_limit: 1000,
      });
      const names = (Array.isArray(orphans) ? orphans : [])
        .map((r) => (r && typeof r === "object" ? (r as { name?: unknown }).name : null))
        .filter((n): n is string => typeof n === "string" && n.startsWith("submissions/"));
      for (let i = 0; i < names.length; i += CLOSE_OUT_CHUNK) {
        const { data: gone, error } = await svc.storage.from(SCH_RECEIPT_BUCKET).remove(names.slice(i, i + CLOSE_OUT_CHUNK));
        if (error) break;
        receipts += gone?.length ?? 0;
      }
    } catch (err) {
      log.exception("sch close-out orphan sweep failed", err);
    }

    const teams = teamsGone?.length ?? 0;
    const detail = `registrations=${registrations} teams=${teams} receipts=${receipts}`;
    await audit("SCH_EVENT_CLOSED", detail, ctx);
    scheduleSecurityEvent({
      action: "SCH_EVENT_CLOSED",
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      detail: `role=${ctx.profile.role} ${detail}`,
    });
    refreshAdmin();
    refreshPublic();
    return { ok: true, registrations, teams, receipts };
  } catch (err) {
    log.exception("sch close-out failed", err);
    return { error: "unavailable" };
  }
}
