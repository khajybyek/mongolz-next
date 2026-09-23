import type { Metadata, Route } from "next";
import Link from "next/link";
import { ArrowLeft, Gamepad2, Shield, Users } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { getServerLang } from "@/lib/i18n/server";
import { log } from "@/lib/log";
import { maskSteam } from "@/lib/sch/format";
import { SCH_DRAW_STATUSES, SCH_GAMES, SCH_GAME_LABEL, SCH_TEAM_SIZE, type SchGame } from "@/lib/sch/schema";
import { schShareMetadata } from "@/lib/sch/metadata";
import { strengthLabel, teamStrength } from "@/lib/sch/teams";
import { createServiceClient } from "@/lib/supabase/server";
import { readSchEvent } from "../actions";
import { formatGameDate, localizeEventText, schCopy } from "../sch-copy";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getServerLang();
  const c = schCopy(lang);
  return schShareMetadata({
    lang,
    title: `SCH Esports · ${c.teamsTitle}`,
    description: c.teamsSubtitle,
    path: "/sch/teams",
  });
}

/** Public projection — never email, phone, Facebook or the receipt. */
type Member = { id: string; full_name: string; in_game_id: string | null; rank_label: string | null; rank_score: number; roles: string[] };
/** `strength` is the sum over `members` as listed — not the draw-time `sch_teams.strength`. */
type Team = { id: string; game: SchGame; name: string; seed: number; strength: number; members: Member[] };

type TeamsLoad = { byGame: Map<SchGame, Team[]>; failed: boolean };

/**
 * Saved teams with their CURRENT members. Membership is `registrations.team_id`
 * filtered to the draw statuses: a player the organiser rejected, cancelled
 * or moved to the waitlist after the draw must vanish from the public roster
 * at once, whatever changed their status. A read failure is reported as
 * such — it must not look like "not published yet".
 */
async function loadTeams(games: SchGame[]): Promise<TeamsLoad> {
  const byGame = new Map<SchGame, Team[]>();
  if (games.length === 0) return { byGame, failed: false };
  try {
    const svc = createServiceClient();
    const teams = await svc
      .from("sch_teams")
      .select("id, game, name, seed, strength")
      .in("game", games)
      .order("game")
      .order("seed");
    if (teams.error) throw teams.error;
    const rows = teams.data ?? [];
    if (rows.length === 0) return { byGame, failed: false };

    const members = await svc
      .from("sch_registrations")
      .select("id, full_name, in_game_id, rank_label, rank_score, roles, team_id")
      .in("team_id", rows.map((t) => t.id))
      .in("status", [...SCH_DRAW_STATUSES])
      .order("rank_score", { ascending: false })
      .order("full_name");
    if (members.error) throw members.error;

    const memberByTeam = new Map<string, Member[]>();
    for (const m of members.data ?? []) {
      if (!m.team_id) continue;
      const list = memberByTeam.get(m.team_id) ?? [];
      list.push({ id: m.id, full_name: m.full_name, in_game_id: m.in_game_id, rank_label: m.rank_label, rank_score: m.rank_score, roles: m.roles ?? [] });
      memberByTeam.set(m.team_id, list);
    }
    for (const t of rows) {
      const game = t.game as SchGame;
      if (!games.includes(game)) continue;
      const list = byGame.get(game) ?? [];
      // `sch_teams.strength` is written once at draw time; a player withdrawn
      // afterwards leaves the roster but not that number, so the card would
      // show an average over people it no longer lists. Derive it here.
      const members = memberByTeam.get(t.id) ?? [];
      const strength = teamStrength(members.map((m) => ({ id: m.id, name: m.full_name, score: m.rank_score, roles: m.roles })));
      list.push({ id: t.id, game, name: t.name, seed: t.seed, strength, members });
      byGame.set(game, list);
    }
  } catch (err) {
    log.exception("sch teams read failed", err);
    return { byGame: new Map(), failed: true };
  }
  return { byGame, failed: false };
}

export default async function SchTeamsPage() {
  const lang = await getServerLang();
  const c = schCopy(lang);
  const event = await readSchEvent();
  const published = SCH_GAMES.filter((g) => event.teamsPublished[g]);
  const { byGame: teamsByGame, failed } = await loadTeams(published);
  const gamesWithTeams = published.filter((g) => (teamsByGame.get(g)?.length ?? 0) > 0);

  return (
    <div className="pt-10 md:pt-14">
      <div className="mb-8 flex flex-col gap-4 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
        <div>
          <div className="mb-3 inline-flex items-center gap-2.5 text-xs font-semibold tracking-wide text-accent">
            <span className="h-px w-6 bg-accent" aria-hidden />
            {localizeEventText(event.title, "title", lang) ?? event.title}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-text sm:text-4xl">{c.teamsTitle}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">{c.teamsSubtitle}</p>
        </div>
        <Link href={"/sch" as Route} className="btn-secondary btn-sm self-center sm:self-auto">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {c.navRegister}
        </Link>
      </div>

      {failed ? (
        <Alert variant="warning">{c.teamsLoadFailed}</Alert>
      ) : gamesWithTeams.length === 0 ? (
        <Empty icon={Users} message={c.teamsEmpty} description={c.teamsEmptyDesc} />
      ) : (
        <div className="space-y-12">
          {gamesWithTeams.map((g) => {
            const teams = teamsByGame.get(g) ?? [];
            const maxStrength = Math.max(1, ...teams.map((t) => t.strength));
            const playerCount = teams.reduce((n, t) => n + t.members.length, 0);
            return (
              <section key={g} aria-labelledby={`sch-teams-${g}`}>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <span className="icon-tile h-10 w-10"><Gamepad2 className="h-4 w-4" aria-hidden /></span>
                  <div>
                    <h2 id={`sch-teams-${g}`} className="text-xl font-semibold tracking-tight text-text">{SCH_GAME_LABEL[g]}</h2>
                    <p className="text-xs text-text-muted">
                      {formatGameDate(event.gameDates[g], lang)} · {teams.length} {c.teamsWord} · {playerCount} {c.players}
                      {playerCount !== teams.length * SCH_TEAM_SIZE && ` (${teams.length} × ${SCH_TEAM_SIZE})`}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {teams.map((team) => (
                    <TeamCard key={team.id} team={team} maxStrength={maxStrength} avgLabel={c.avgRank} playersLabel={c.players} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeamCard({ team, maxStrength, avgLabel, playersLabel }: { team: Team; maxStrength: number; avgLabel: string; playersLabel: string }) {
  const size = team.members.length;
  const avg = strengthLabel(team.strength, size);
  const width = Math.max(6, Math.round((team.strength / maxStrength) * 100));
  return (
    <article className="card flex flex-col gap-4 p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-tight text-text">{team.name}</h3>
          <p className="text-xs text-text-muted">{size} {playersLabel}</p>
        </div>
        <Badge variant="accent" className="shrink-0 gap-1">
          <Shield className="h-3 w-3" aria-hidden />
          {avg} {avgLabel}
        </Badge>
      </header>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-text-muted/15" aria-hidden>
        <div className="h-full rounded-full bg-accent/70" style={{ width: `${width}%` }} />
      </div>
      <ul className="divide-y divide-border">
        {team.members.map((m, i) => (
          <li key={m.id} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-elevated font-mono text-[11px] text-text-muted">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium text-text">{m.full_name}</span>
                {m.rank_label && <Badge variant="muted">{m.rank_label}</Badge>}
              </div>
              {m.in_game_id && (
                <div className="truncate font-mono text-xs text-text-muted">{maskSteam(m.in_game_id)}</div>
              )}
              {m.roles.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.roles.map((r) => (
                    <span key={r} className="rounded-md border border-border bg-surface-elevated/60 px-1.5 py-0.5 text-[11px] text-text-soft">{r}</span>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
