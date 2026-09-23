/**
 * SCH Esports — pure state helpers behind the organiser's team-draw panel.
 */
import type { DrawPlayer } from "./teams";

/**
 * Everything `drawTeams` reads from a player. A preview is only valid for
 * the pool it was drawn from: a rank or role edit after the draw changes
 * what the same seed produces, so the preview must be dropped.
 */
export function poolFingerprint(pool: readonly Pick<DrawPlayer, "id" | "score" | "roles">[]): string {
  return pool
    .map((p) => `${p.id}:${p.score}:${[...p.roles].sort().join(",")}`)
    .sort()
    .join("|");
}

/**
 * Paid players who are outside the saved teams AND would change the draw.
 * `pool.length % teamSize` players are always left over as substitutes, so
 * they never count; only the players beyond them — enough for another team,
 * or a seat a team lost — are worth a re-draw. 0 while nothing is saved.
 */
export function playersBeyondSubstitutes(
  pool: readonly { teamName: string | null }[],
  savedTeamCount: number,
  teamSize: number,
): number {
  if (savedTeamCount === 0 || teamSize < 1) return 0;
  const unassigned = pool.filter((p) => !p.teamName).length;
  return Math.max(0, unassigned - (pool.length % teamSize));
}
