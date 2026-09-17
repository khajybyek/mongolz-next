/**
 * SCH Esports — balanced random team draw.
 *
 * Pure and deterministic: the same players + seed always produce the same
 * teams, so the organiser can preview, re-draw with a new seed and only then
 * save. No `Math.random` anywhere.
 *
 * Method
 *   0. Players are ordered by id first, so the result depends on the set of
 *      players and the seed only — never on the order the caller passed.
 *   1. Fisher–Yates shuffle with a seeded PRNG (mulberry32).
 *   2. The last `n mod teamSize` players of the shuffled order sit out as
 *      substitutes (so re-draws vary who sits out, not just who plays with whom).
 *   3. The rest are sorted by score (desc, ties keep the shuffled order) and
 *      snake-drafted into `floor(n / teamSize)` teams.
 *   4. Bounded first-improvement local search swaps players between teams
 *      to minimise, lexicographically, (max − min team strength), then the
 *      number of players whose roles all collide with a teammate's roles,
 *      then Σ strength² (a plateau-escaping tie-break that never outranks
 *      the first two).
 */
import { SCH_TEAM_SIZE } from "./schema";

export type DrawPlayer = {
  id: string;
  name: string;
  /** 0–100 strength (see `rankScore`). */
  score: number;
  roles: string[];
};

export type DrawTeam = {
  /** 1-based team number; unique per game. */
  seed: number;
  name: string;
  /** Sum of member scores. */
  strength: number;
  players: DrawPlayer[];
};

export type DrawResult = {
  teams: DrawTeam[];
  substitutes: DrawPlayer[];
  seed: number;
};

export type DrawOptions = {
  teamSize?: number;
  seed: number;
  /** Upper bound on swap evaluations in the local search (default 50 000). */
  maxEvaluations?: number;
};

/** mulberry32 — small, fast, good enough for a fair shuffle. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function teamName(seed: number): string {
  return `Team ${seed}`;
}

/** Average member score, rounded to a whole number (0 for an empty team). */
export function strengthLabel(strength: number, size: number): number {
  if (!Number.isFinite(strength) || !Number.isFinite(size) || size <= 0) return 0;
  return Math.round(strength / size);
}

export function teamStrength(players: readonly DrawPlayer[]): number {
  let sum = 0;
  for (const p of players) sum += clampScore(p.score);
  return sum;
}

/** max − min team strength; 0 when there are fewer than two teams. */
export function strengthSpread(teams: readonly { strength: number }[]): number {
  if (teams.length < 2) return 0;
  let max = -Infinity;
  let min = Infinity;
  for (const t of teams) {
    if (t.strength > max) max = t.strength;
    if (t.strength < min) min = t.strength;
  }
  return max - min;
}

/**
 * Number of players on a team whose every role is also covered by a
 * teammate — i.e. players who bring nothing new to the role mix.
 * Players without roles (CS2) never count.
 */
export function roleCollisions(players: readonly DrawPlayer[]): number {
  let collisions = 0;
  for (let i = 0; i < players.length; i++) {
    const mine = players[i].roles;
    if (mine.length === 0) continue;
    const others = new Set<string>();
    for (let j = 0; j < players.length; j++) {
      if (j === i) continue;
      for (const r of players[j].roles) others.add(r);
    }
    if (mine.every((r) => others.has(r))) collisions++;
  }
  return collisions;
}

export function totalRoleCollisions(teams: readonly { players: readonly DrawPlayer[] }[]): number {
  let total = 0;
  for (const t of teams) total += roleCollisions(t.players);
  return total;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

function normalisePlayer(p: DrawPlayer): DrawPlayer {
  return { id: p.id, name: p.name, score: clampScore(p.score), roles: Array.from(new Set(p.roles ?? [])) };
}

/** Lexicographic comparison of cost tuples: true when `a` is strictly lower. */
function better(a: readonly number[], b: readonly number[]): boolean {
  for (let k = 0; k < a.length; k++) {
    if (a[k] < b[k]) return true;
    if (a[k] > b[k]) return false;
  }
  return false;
}

export function drawTeams(players: readonly DrawPlayer[], opts: DrawOptions): DrawResult {
  const teamSize = Math.max(1, Math.floor(opts.teamSize ?? SCH_TEAM_SIZE));
  const seed = Math.floor(opts.seed) >>> 0;
  const maxEvaluations = Math.max(0, Math.floor(opts.maxEvaluations ?? 50_000));
  const rng = mulberry32(seed);

  // The seed alone must decide the draw. The console previews over a pool
  // sorted by name and the save action rebuilds it in insertion order, so
  // the input order is canonicalised by id before the shuffle — otherwise
  // the same ids + seed would yield different rosters on the two sides.
  const canonical = players.map(normalisePlayer).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shuffled = shuffle(canonical, rng);
  const teamCount = Math.floor(shuffled.length / teamSize);
  if (teamCount === 0) {
    return { teams: [], substitutes: shuffled, seed };
  }

  const active = shuffled.length - (shuffled.length % teamSize);
  const pool = shuffled.slice(0, active);
  const substitutes = shuffled.slice(active);

  // Stable sort by score desc; ties keep the shuffled order.
  const ranked = pool
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.score - a.p.score || a.i - b.i)
    .map((x) => x.p);

  // Snake draft: 0..T-1, T-1..0, 0..T-1, …
  const rosters: DrawPlayer[][] = Array.from({ length: teamCount }, () => []);
  for (let k = 0; k < ranked.length; k++) {
    const round = Math.floor(k / teamCount);
    const pos = k % teamCount;
    const team = round % 2 === 0 ? pos : teamCount - 1 - pos;
    rosters[team].push(ranked[k]);
  }

  localSearch(rosters, maxEvaluations);

  const teams: DrawTeam[] = rosters.map((roster, i) => ({
    seed: i + 1,
    name: teamName(i + 1),
    strength: teamStrength(roster),
    players: roster.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
  }));

  return { teams, substitutes, seed };
}

/**
 * First-improvement local search over pairwise player swaps.
 * Deterministic: iterates team pairs and member pairs in a fixed order and
 * takes the first swap that lowers the cost, restarting the scan after every
 * accepted swap until nothing improves or the evaluation budget ends.
 *
 * Cost is lexicographic: (max − min strength, role collisions, Σ strength²).
 * The third term never overrides the first two; it only lets the search walk
 * across plateaus (swaps that keep the spread but pull the middle teams
 * towards the mean), which is what frees the extreme teams to improve next.
 */
function localSearch(rosters: DrawPlayer[][], maxEvaluations: number): void {
  const T = rosters.length;
  if (T < 2 || maxEvaluations === 0) return;

  const strengths = rosters.map(teamStrength);
  const collisions = rosters.map(roleCollisions);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  let spread = strengthSpread(strengths.map((s) => ({ strength: s })));
  let roleCost = sum(collisions);
  let sumSq = sum(strengths.map((s) => s * s));
  let evaluations = 0;

  let improved = true;
  while (improved && evaluations < maxEvaluations) {
    improved = false;
    scan: for (let a = 0; a < T - 1; a++) {
      for (let b = a + 1; b < T; b++) {
        for (let i = 0; i < rosters[a].length; i++) {
          for (let j = 0; j < rosters[b].length; j++) {
            if (evaluations >= maxEvaluations) break scan;
            evaluations++;
            const pa = rosters[a][i];
            const pb = rosters[b][j];
            const delta = pb.score - pa.score;
            if (delta === 0 && pa.roles.length === 0 && pb.roles.length === 0) continue;

            const nextA = strengths[a] + delta;
            const nextB = strengths[b] - delta;
            let max = -Infinity;
            let min = Infinity;
            for (let t = 0; t < T; t++) {
              const s = t === a ? nextA : t === b ? nextB : strengths[t];
              if (s > max) max = s;
              if (s < min) min = s;
            }
            const nextSpread = max - min;
            if (nextSpread > spread) continue;
            const nextSumSq = sumSq - strengths[a] * strengths[a] - strengths[b] * strengths[b] + nextA * nextA + nextB * nextB;

            // Apply tentatively to measure the role cost.
            rosters[a][i] = pb;
            rosters[b][j] = pa;
            const ca = roleCollisions(rosters[a]);
            const cb = roleCollisions(rosters[b]);
            const nextRoles = roleCost - collisions[a] - collisions[b] + ca + cb;

            if (better([nextSpread, nextRoles, nextSumSq], [spread, roleCost, sumSq])) {
              strengths[a] = nextA;
              strengths[b] = nextB;
              collisions[a] = ca;
              collisions[b] = cb;
              spread = nextSpread;
              roleCost = nextRoles;
              sumSq = nextSumSq;
              improved = true;
              break scan;
            }
            rosters[a][i] = pa;
            rosters[b][j] = pb;
          }
        }
      }
    }
  }
}

/** Naive reference used by tests and the UI copy: chunk the given order. */
export function sequentialSplit(players: readonly DrawPlayer[], teamSize = SCH_TEAM_SIZE): DrawTeam[] {
  const teamCount = Math.floor(players.length / teamSize);
  const teams: DrawTeam[] = [];
  for (let t = 0; t < teamCount; t++) {
    const members = players.slice(t * teamSize, (t + 1) * teamSize).map(normalisePlayer);
    teams.push({ seed: t + 1, name: teamName(t + 1), strength: teamStrength(members), players: members });
  }
  return teams;
}
