"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dices, Eye, EyeOff, Loader2, RefreshCw, Save, Shuffle, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import { cn, formatDate } from "@/lib/utils";
import { SCH_GAMES, SCH_GAME_LABEL, SCH_TEAM_SIZE, type SchGame } from "@/lib/sch/schema";
import { drawTeams, strengthLabel, type DrawPlayer, type DrawResult } from "@/lib/sch/teams";
import { playersBeyondSubstitutes, poolFingerprint } from "@/lib/sch/draw-state";
import { fill, schAdminCopy } from "./admin-copy";
import { saveTeamsAction, setTeamsPublishedAction, type SchActionResult } from "./actions";

/** A paid player as the draw sees them, plus the rank label for the cards. */
export interface DrawPlayerView extends DrawPlayer {
  rankLabel: string | null;
  teamName: string | null;
}

export interface SavedTeamView {
  id: string;
  name: string;
  seed: number;
  strength: number;
  created_at: string;
  players: DrawPlayerView[];
}

export interface TeamDrawProps {
  eligible: Record<SchGame, DrawPlayerView[]>;
  saved: Record<SchGame, SavedTeamView[]>;
  published: Record<SchGame, boolean>;
}

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

function scoreVariant(score: number): "accent" | "success" | "info" | "warning" | "muted" {
  if (score >= 80) return "accent";
  if (score >= 60) return "success";
  if (score >= 40) return "info";
  if (score > 0) return "warning";
  return "muted";
}

export function TeamDraw({ eligible, saved, published }: TeamDrawProps) {
  const { lang } = useT();
  const copy = schAdminCopy(lang);
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [game, setGame] = useState<SchGame>("mobile_legends");
  const [preview, setPreview] = useState<DrawResult | null>(null);
  const [previewGame, setPreviewGame] = useState<SchGame | null>(null);
  const [previewPool, setPreviewPool] = useState<string | null>(null);

  const pool = eligible[game] ?? [];
  const savedTeams = saved[game] ?? [];
  const isPublished = published[game] === true;
  const fullTeams = Math.floor(pool.length / SCH_TEAM_SIZE);
  const substitutes = pool.length % SCH_TEAM_SIZE;
  const fingerprint = useMemo(() => poolFingerprint(pool), [pool]);
  // A preview belongs to the pool it was drawn from. After a refresh that
  // changed a rank, a role or who is paid, the same seed would produce other
  // rosters — so the stale preview is not shown (and cannot be saved).
  const activePreview = preview && previewGame === game && previewPool === fingerprint ? preview : null;
  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const outOfTeams = useMemo(
    () => playersBeyondSubstitutes(pool, savedTeams.length, SCH_TEAM_SIZE),
    [pool, savedTeams.length],
  );

  function errorTitle(result: Exclude<SchActionResult, { ok: true }>): string {
    return result.error === "conflict" ? copy.conflict : result.error === "invalid" ? copy.invalid : copy.unavailable;
  }

  function draw() {
    if (pool.length < SCH_TEAM_SIZE) return;
    const seed = randomSeed();
    setPreview(drawTeams(pool, { seed, teamSize: SCH_TEAM_SIZE }));
    setPreviewGame(game);
    setPreviewPool(fingerprint);
  }

  function chooseGame(next: SchGame) {
    setGame(next);
  }

  function save() {
    if (!activePreview) return;
    startTransition(async () => {
      let result: SchActionResult;
      try {
        result = await saveTeamsAction({
          game,
          seed: activePreview.seed,
          playerIds: pool.map((p) => p.id),
          teams: activePreview.teams.map((t) => t.players.map((p) => p.id)),
        });
      } catch {
        result = { error: "unavailable" };
      }
      if ("error" in result) {
        // Save conflict = the pool, a rank or a role changed since the preview.
        toast({ title: result.error === "conflict" ? copy.drawConflict : errorTitle(result), tone: "danger" });
        if (result.error === "conflict") {
          setPreview(null);
          router.refresh();
        }
        return;
      }
      setPreview(null);
      toast({ title: copy.teamsSaved, tone: "success", duration: 2000 });
      router.refresh();
    });
  }

  function togglePublish() {
    const next = !isPublished;
    startTransition(async () => {
      let result: SchActionResult;
      try {
        result = await setTeamsPublishedAction({ game, published: next });
      } catch {
        result = { error: "unavailable" };
      }
      if ("error" in result) {
        toast({ title: result.error === "invalid" && next ? copy.saveFirst : errorTitle(result), tone: "danger" });
        return;
      }
      toast({ title: next ? copy.published : copy.unpublished, tone: "success", duration: 2000 });
      router.refresh();
    });
  }

  const shownTeams: Array<{ key: string; name: string; seed: number; strength: number; players: DrawPlayerView[] }> = activePreview
    ? activePreview.teams.map((t) => ({
        key: `preview-${t.seed}`,
        name: t.name,
        seed: t.seed,
        strength: t.strength,
        players: t.players.map((p) => byId.get(p.id) ?? { ...p, rankLabel: null, teamName: null }),
      }))
    : savedTeams.map((t) => ({ key: t.id, name: t.name, seed: t.seed, strength: t.strength, players: t.players }));
  const shownSubstitutes: DrawPlayerView[] = activePreview
    ? activePreview.substitutes.map((p) => byId.get(p.id) ?? { ...p, rankLabel: null, teamName: null })
    : savedTeams.length
      ? pool.filter((p) => !p.teamName)
      : [];

  return (
    <section className="card space-y-5" aria-labelledby="sch-draw-title">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 id="sch-draw-title" className="section-title flex items-center gap-2">
            <Dices className="h-4 w-4 text-accent" aria-hidden />{copy.drawTitle}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-muted">{fill(copy.drawDesc, { size: SCH_TEAM_SIZE })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="sch-draw-game">{copy.chooseGame}</label>
          <select id="sch-draw-game" className="select" value={game} onChange={(e) => chooseGame(e.target.value as SchGame)} disabled={pending}>
            {SCH_GAMES.map((g) => <option key={g} value={g}>{SCH_GAME_LABEL[g]}</option>)}
          </select>
          <Badge variant={isPublished ? "success" : "muted"} dot>{isPublished ? copy.publishedBadge : copy.notPublishedBadge}</Badge>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: copy.eligible, value: pool.length },
          { label: copy.fullTeams, value: fullTeams },
          { label: copy.substitutes, value: substitutes },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-bg-secondary/40 p-3">
            <dt className="text-2xs font-medium uppercase tracking-wide text-text-muted">{stat.label}</dt>
            <dd className="num mt-1 text-2xl font-semibold text-text">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={draw} disabled={pending || pool.length < SCH_TEAM_SIZE}>
          {activePreview ? <RefreshCw className="h-4 w-4" aria-hidden /> : <Shuffle className="h-4 w-4" aria-hidden />}
          {activePreview ? copy.redraw : copy.drawButton}
        </button>
        {activePreview && (
          <button type="button" className="btn-secondary" onClick={save} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            {copy.saveTeams}
          </button>
        )}
        <button
          type="button"
          className={cn("btn-outline", isPublished && "text-warning")}
          onClick={togglePublish}
          disabled={pending || (!isPublished && savedTeams.length === 0)}
          title={!isPublished && savedTeams.length === 0 ? copy.saveFirst : undefined}
        >
          {isPublished ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          {isPublished ? copy.unpublish : copy.publish}
        </button>
      </div>

      {pool.length === 0 ? (
        <p className="text-sm text-text-muted">{copy.noEligible}</p>
      ) : pool.length < SCH_TEAM_SIZE ? (
        <p className="text-sm text-warning">{fill(copy.tooFew, { size: SCH_TEAM_SIZE })}</p>
      ) : null}
      {!activePreview && outOfTeams > 0 && (
        <p className="text-sm text-warning">{fill(copy.playersOutOfTeams, { n: outOfTeams })}</p>
      )}
      <p className="text-xs text-text-muted">{copy.teamsPublicHint}</p>

      {shownTeams.length === 0 ? (
        !activePreview && pool.length >= SCH_TEAM_SIZE ? (
          <Empty icon={Users} message={copy.noTeams} size="compact" />
        ) : null
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={activePreview ? "warning" : "success"} dot>{activePreview ? copy.previewLabel : copy.savedLabel}</Badge>
            {activePreview ? (
              <span className="font-mono text-text-muted">{fill(copy.drawSeedHint, { seed: activePreview.seed })}</span>
            ) : savedTeams[0] ? (
              <span className="text-text-muted">{copy.drawnAt} {formatDate(savedTeams[0].created_at)}</span>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shownTeams.map((team) => (
              <article key={team.key} className="rounded-xl border border-border bg-bg-secondary/40 p-4">
                <header className="mb-3 flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-text">{team.name}</h3>
                  <div className="text-right text-xs text-text-muted">
                    <div><span className="text-text-soft">{copy.strength}</span> <span className="num font-medium text-text">{team.strength}</span></div>
                    <div>{copy.avg} <span className="num">{strengthLabel(team.strength, team.players.length)}</span></div>
                  </div>
                </header>
                <ul className="space-y-2">
                  {team.players.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-medium text-text">{p.name}</span>
                      <Badge variant={scoreVariant(p.score)}>{p.rankLabel ?? `${p.score}`}</Badge>
                      {p.roles.map((role) => <Badge key={role} variant="muted">{role}</Badge>)}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="rounded-xl border border-dashed border-border p-4">
            <h3 className="text-sm font-semibold text-text">{copy.substitutes}</h3>
            <p className="mt-0.5 text-xs text-text-muted">{fill(copy.substitutesHint, { size: SCH_TEAM_SIZE })}</p>
            {shownSubstitutes.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">{copy.substitutesEmpty}</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {shownSubstitutes.map((p) => (
                  <li key={p.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm">
                    <span className="text-text">{p.name}</span>
                    <Badge variant={scoreVariant(p.score)}>{p.rankLabel ?? `${p.score}`}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
