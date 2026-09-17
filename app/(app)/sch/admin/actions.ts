"use server";

/**
 * SCH Esports organiser console — server actions.
 *
 * Every mutation: admin + second factor (`requireAdmin`), input validated
 * with zod / the guards in `lib/sch/schema.ts`, data written through the
 * RLS client (admin policies + the mfa restrictive policy apply), one
 * `audit_log` row through the service client, then `revalidatePath`.
 * Results are plain objects — nothing throws to the client. Audit details
 * carry ids only, never a registrant's name, email or phone.
 */

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin, type AuthCtx } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/workflow-query";
import {
  SCH_DRAW_STATUSES,
  SCH_GAMES,
  SCH_LIMITS,
  SCH_RECEIPT_BUCKET,
  SCH_TEAM_SIZE,
  isSchGame,
  isSchStatus,
  type SchGame,
  type SchStatus,
} from "@/lib/sch/schema";
import { drawTeams, type DrawPlayer } from "@/lib/sch/teams";

export type SchActionResult =
  | { ok: true }
  | { error: "invalid" | "conflict" | "unavailable" }
  /** A game was ticked as published while it has no saved teams. */
  | { error: "no_teams"; game: SchGame };

export type SchSweepResult = { ok: true; removed: number } | { error: "unavailable" };

const MAX_DRAW_PLAYERS = 500;
/** Receipts younger than this are never swept (see sch_orphan_receipts). */
const SWEEP_OLDER_THAN_HOURS = 24;
const SWEEP_BATCH = 200;

async function audit(action: string, detail: string, ctx: AuthCtx): Promise<void> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await createServiceClient().from("audit_log").insert({
      action,
      detail: detail.slice(0, 500),
      user_id: ctx.user.id,
      user_email: ctx.user.email,
      ip,
    });
  } catch {
    // The ledger must never turn a finished write into a client error.
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

export async function setRegistrationStatusAction(input: {
  id: string;
  status: string;
}): Promise<SchActionResult> {
  const ctx = await requireAdmin();
  if (!UUID_RE.test(input?.id ?? "") || !isSchStatus(input?.status) || !ORGANISER_STATUSES.includes(input.status)) {
    return { error: "invalid" };
  }
  const id = input.id.toLowerCase();
  const next = input.status;
  try {
    const supabase = await createClient();
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
  const ctx = await requireAdmin();
  if (!UUID_RE.test(input?.id ?? "") || typeof input?.checkedIn !== "boolean") return { error: "invalid" };
  const id = input.id.toLowerCase();
  try {
    const supabase = await createClient();
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
  const ctx = await requireAdmin();
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
    const supabase = await createClient();
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
  const ctx = await requireAdmin();
  if (!UUID_RE.test(input?.id ?? "")) return { error: "invalid" };
  const id = input.id.toLowerCase();
  try {
    const supabase = await createClient();
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
    if (row.receipt_path) {
      const { count } = await supabase
        .from("sch_registrations")
        .select("id", { count: "exact", head: true })
        .eq("submission_id", row.submission_id);
      if ((count ?? 0) === 0) {
        try {
          // Service role: the receipts bucket has no storage policy (20260917110000).
          const svc = createServiceClient();
          await svc.storage.from(SCH_RECEIPT_BUCKET).remove([row.receipt_path]);
        } catch {
          // Best effort — the row is gone; an orphaned object is not a data leak.
        }
      }
    }

    await audit("SCH_REGISTRATION_DELETED", `registration=${id} game=${row.game} submission=${row.submission_id}`, ctx);
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
  const ctx = await requireAdmin();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const v = parsed.data;
  try {
    const supabase = await createClient();
    const { data: before } = await supabase
      .from("sch_event")
      .select("registration_open, teams_published")
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
    await audit(
      "SCH_EVENT_UPDATED",
      `open=${v.registration_open} deadline=${v.registration_deadline ?? "none"} fee_krw=${v.fee_krw} fee_mnt=${v.fee_mnt} published=${published}`,
      ctx,
    );
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
});

/**
 * Replace the saved teams of one game with the draw for `seed`. The draw is
 * recomputed here from the live eligible pool (drawTeams is deterministic),
 * so what the organiser previewed is exactly what gets saved — and if the
 * pool changed under them (someone marked paid meanwhile) it is a conflict.
 */
export async function saveTeamsAction(input: {
  game: string;
  seed: number;
  playerIds: string[];
}): Promise<SchActionResult> {
  const ctx = await requireAdmin();
  const parsed = saveTeamsSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const game = parsed.data.game as SchGame;
  const { seed } = parsed.data;
  const expected = new Set(parsed.data.playerIds.map((id) => id.toLowerCase()));

  try {
    const supabase = await createClient();
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
  const ctx = await requireAdmin();
  if (!isSchGame(input?.game) || typeof input?.published !== "boolean") return { error: "invalid" };
  const game: SchGame = input.game;
  try {
    const supabase = await createClient();
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
  const ctx = await requireAdmin();
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
