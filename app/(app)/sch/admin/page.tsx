import type { Route } from "next";
import Link from "next/link";
import { BadgeCheck, CalendarDays, Download, ExternalLink, Hourglass, ShieldAlert, Trophy, UserCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";
import { kstStartOfDayISO, readMfaOk, type RpcCapableClient } from "@/lib/metrics";
import {
  SCH_DEFAULT_GAME_DATES,
  SCH_DRAW_STATUSES,
  SCH_GAMES,
  SCH_GAME_LABEL,
  isSchGame,
  isSchStatus,
  referenceCode,
  type SchGame,
} from "@/lib/sch/schema";
import { schAdminCopy } from "./admin-copy";
import { ReceiptSweepButton } from "./receipt-sweep-button";
import { RegistrationsTable, type SchAdminRow } from "./registrations-table";
import { SettingsForm, type SchEventView } from "./settings-form";
import { TeamDraw, type DrawPlayerView, type SavedTeamView } from "./team-draw";

/** Rows the console lists; the CSV export is the path for anything larger. */
const ROW_CAP = 2000;

function gameDates(value: unknown): Record<SchGame, string> {
  const src = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const out = { ...SCH_DEFAULT_GAME_DATES };
  for (const g of SCH_GAMES) {
    const v = src[g];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[g] = v;
  }
  return out;
}

function publishedMap(value: unknown): Record<SchGame, boolean> {
  const src = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return { mobile_legends: src.mobile_legends === true, cs2: src.cs2 === true, dota2: src.dota2 === true };
}

function answersOf(value: unknown): { premier_rank: string | null; faceit: "yes" | "no" | null } {
  const src = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    premier_rank: typeof src.premier_rank === "string" && src.premier_rank ? src.premier_rank : null,
    faceit: src.faceit === "yes" || src.faceit === "no" ? src.faceit : null,
  };
}

function relName(value: unknown): string | null {
  const rel = Array.isArray(value) ? value[0] : value;
  return rel && typeof rel === "object" && typeof (rel as { name?: unknown }).name === "string"
    ? (rel as { name: string }).name
    : null;
}

export default async function SchAdminPage() {
  await requireAdmin();
  const { lang } = await getT();
  const copy = schAdminCopy(lang);
  const supabase = await createClient();

  const [eventRes, rowsRes, teamsRes, mfaOk] = await Promise.all([
    supabase.from("sch_event").select("*").eq("id", 1).maybeSingle(),
    supabase
      .from("sch_registrations")
      .select(
        "id, submission_id, game, full_name, email, facebook, phone, in_game_id, rank_label, rank_score, roles, answers, status, paid_at, checked_in_at, notes, team_id, receipt_path, created_at, team:sch_teams(name)",
      )
      .order("created_at", { ascending: false })
      .limit(ROW_CAP),
    supabase.from("sch_teams").select("id, game, name, seed, strength, created_at").order("seed", { ascending: true }),
    readMfaOk(supabase as unknown as RpcCapableClient),
  ]);

  const event = eventRes.data;
  const eventView: SchEventView = {
    title: event?.title ?? "SCH Esports",
    intro: event?.intro ?? null,
    registration_open: event?.registration_open ?? false,
    registration_deadline: event?.registration_deadline ?? null,
    fee_krw: event?.fee_krw ?? 0,
    fee_mnt: event?.fee_mnt ?? 0,
    payment_info: event?.payment_info ?? null,
    contact: event?.contact ?? null,
    game_dates: gameDates(event?.game_dates),
    teams_published: publishedMap(event?.teams_published),
  };

  const rows: SchAdminRow[] = (rowsRes.data ?? [])
    .filter((r) => isSchGame(r.game) && isSchStatus(r.status))
    .map((r) => {
      const answers = answersOf(r.answers);
      return {
        id: r.id,
        submission_id: r.submission_id,
        reference: referenceCode(r.submission_id),
        game: r.game as SchGame,
        full_name: r.full_name,
        email: r.email,
        facebook: r.facebook,
        phone: r.phone,
        in_game_id: r.in_game_id,
        rank_label: r.rank_label,
        rank_score: r.rank_score,
        roles: r.roles ?? [],
        premier_rank: answers.premier_rank,
        faceit: answers.faceit,
        status: isSchStatus(r.status) ? r.status : "pending",
        paid_at: r.paid_at,
        checked_in_at: r.checked_in_at,
        notes: r.notes,
        team_name: relName(r.team),
        has_receipt: Boolean(r.receipt_path),
        created_at: r.created_at,
      };
    });

  // ── Stats (Asia/Seoul day boundary, like every other console) ──
  const sinceToday = Date.parse(kstStartOfDayISO());
  const perGame: Record<SchGame, number> = { mobile_legends: 0, cs2: 0, dota2: 0 };
  let paid = 0;
  let pendingCount = 0;
  let checkedInToday = 0;
  for (const r of rows) {
    perGame[r.game] += 1;
    if (r.status === "paid") paid += 1;
    if (r.status === "pending") pendingCount += 1;
    if (r.checked_in_at && Date.parse(r.checked_in_at) >= sinceToday) checkedInToday += 1;
  }

  // ── Draw inputs: paid players per game + the saved teams with members ──
  const teamById = new Map((teamsRes.data ?? []).map((t) => [t.id, t]));
  const eligible: Record<SchGame, DrawPlayerView[]> = { mobile_legends: [], cs2: [], dota2: [] };
  const membersByTeam = new Map<string, DrawPlayerView[]>();
  for (const r of rowsRes.data ?? []) {
    if (!isSchGame(r.game) || !isSchStatus(r.status)) continue;
    const player: DrawPlayerView = {
      id: r.id,
      name: r.full_name,
      score: r.rank_score,
      roles: r.roles ?? [],
      rankLabel: r.rank_label,
      teamName: r.team_id && teamById.has(r.team_id) ? teamById.get(r.team_id)!.name : null,
    };
    if (!SCH_DRAW_STATUSES.includes(r.status)) continue;
    eligible[r.game].push(player);
    // Roster membership = a paid player's seat, exactly as the public page
    // shows it; a rejected/cancelled/waitlisted row keeps no seat.
    if (r.team_id && teamById.has(r.team_id)) {
      const list = membersByTeam.get(r.team_id) ?? [];
      list.push(player);
      membersByTeam.set(r.team_id, list);
    }
  }
  for (const g of SCH_GAMES) eligible[g].sort((a, b) => a.name.localeCompare(b.name));
  const savedTeams: Record<SchGame, SavedTeamView[]> = { mobile_legends: [], cs2: [], dota2: [] };
  for (const t of teamsRes.data ?? []) {
    if (!isSchGame(t.game)) continue;
    savedTeams[t.game].push({
      id: t.id,
      name: t.name,
      seed: t.seed,
      strength: t.strength,
      created_at: t.created_at,
      players: (membersByTeam.get(t.id) ?? []).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    });
  }

  const deadlinePassed = Boolean(
    eventView.registration_deadline && Date.parse(eventView.registration_deadline) < Date.now(),
  );
  const isOpen = eventView.registration_open && !deadlinePassed;
  const loadFailed = Boolean(rowsRes.error || teamsRes.error);

  return (
    <>
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        icon={<Trophy className="h-5 w-5" />}
        actions={
          <>
            <Link href={"/sch" as Route} className="btn-ghost" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden />{copy.publicPage}
            </Link>
            <Link href={"/sch/teams" as Route} className="btn-ghost" target="_blank" rel="noopener noreferrer">
              <Users className="h-4 w-4" aria-hidden />{copy.teamsPage}
            </Link>
            <a href="/api/sch/export" className="btn-outline" download>
              <Download className="h-4 w-4" aria-hidden />{copy.exportCsv}
            </a>
            <ReceiptSweepButton />
            <SettingsForm event={eventView} />
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-text-soft">
        <Badge variant={isOpen ? "success" : "danger"} dot>{isOpen ? copy.openBadge : copy.closedBadge}</Badge>
        {eventView.registration_deadline && (
          <span><CalendarDays className="mr-1 inline h-3.5 w-3.5" aria-hidden />{copy.deadline}: {formatDate(eventView.registration_deadline)}</span>
        )}
        <span>
          {copy.fee}: <span className="num font-medium text-text">{eventView.fee_krw.toLocaleString("en-US")} KRW</span> · <span className="num font-medium text-text">{eventView.fee_mnt.toLocaleString("en-US")} MNT</span> {copy.perGame}
        </span>
      </div>

      {!mfaOk && (
        <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-text">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p className="leading-relaxed">{copy.mfaHint}</p>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label={copy.statTotal} value={rows.length} icon={Users} hint={copy.statHint} />
        <StatCard label={copy.statPaid} value={paid} icon={BadgeCheck} accent="success" />
        <StatCard label={copy.statPending} value={pendingCount} icon={Hourglass} accent="warning" />
        <StatCard label={copy.statCheckedIn} value={checkedInToday} icon={UserCheck} accent="info" />
      </div>
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SCH_GAMES.map((g) => (
          <StatCard
            key={g}
            label={SCH_GAME_LABEL[g]}
            value={perGame[g]}
            icon={Trophy}
            hint={`${eventView.game_dates[g]} · ${eventView.teams_published[g] ? copy.publishedBadge : copy.notPublishedBadge}`}
            accent={eventView.teams_published[g] ? "success" : "default"}
          />
        ))}
      </div>

      {loadFailed ? (
        <Empty icon={ShieldAlert} message={copy.loadFailed} />
      ) : (
        <div className="space-y-8">
          <RegistrationsTable rows={rows} />
          <TeamDraw eligible={eligible} saved={savedTeams} published={eventView.teams_published} />
        </div>
      )}
    </>
  );
}
