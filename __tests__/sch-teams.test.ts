import {
  drawTeams,
  mulberry32,
  roleCollisions,
  sequentialSplit,
  strengthLabel,
  strengthSpread,
  teamName,
  teamStrength,
  totalRoleCollisions,
  type DrawPlayer,
} from "@/lib/sch/teams";
import { ML_ROLES, SCH_TEAM_SIZE } from "@/lib/sch/schema";
import { facebookHref, isSteamUrl, maskSteam } from "@/lib/sch/format";

const ROLES = [...ML_ROLES];

/** 25 Mobile Legends players, scores 10..100, one role each; sequential chunks are badly unbalanced. */
function fixture(count = 25): DrawPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    score: 10 + (i % 10) * 10,
    roles: [ROLES[Math.floor(i / 5) % ROLES.length]],
  }));
}

const rosterIds = (r: ReturnType<typeof drawTeams>) => r.teams.map((t) => t.players.map((p) => p.id));

describe("teamStrength (roster-derived)", () => {
  it("sums the listed members' clamped scores, so the card describes the roster it shows", () => {
    // The pages derive strength from the members they list instead of the
    // draw-time `sch_teams.strength`: reject one player and both the sum
    // and the average follow the roster instead of rising.
    const five: DrawPlayer[] = [
      { id: "a", name: "A", score: 80, roles: [] },
      { id: "b", name: "B", score: 70, roles: [] },
      { id: "c", name: "C", score: 60, roles: [] },
      { id: "d", name: "D", score: 50, roles: [] },
      { id: "e", name: "E", score: 40, roles: [] },
    ];
    expect(teamStrength(five)).toBe(300);
    expect(strengthLabel(teamStrength(five), five.length)).toBe(60);
    const four = five.filter((p) => p.id !== "c");
    expect(teamStrength(four)).toBe(240);
    expect(strengthLabel(teamStrength(four), four.length)).toBe(60); // not 300 / 4 = 75
    expect(teamStrength([])).toBe(0);
    expect(teamStrength([{ id: "x", name: "X", score: 250, roles: [] }, { id: "y", name: "Y", score: -5, roles: [] }])).toBe(100);
  });
});

describe("mulberry32", () => {
  it("is deterministic per seed and yields values in [0, 1)", () => {
    const a = mulberry32(2026);
    const b = mulberry32(2026);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("drawTeams", () => {
  it("is deterministic for a given seed", () => {
    const players = fixture();
    const a = drawTeams(players, { seed: 42 });
    const b = drawTeams(players, { seed: 42 });
    expect(a).toEqual(b);
    expect(a.seed).toBe(42);
  });

  it("does not depend on the input order — same ids + seed give the same rosters", () => {
    // The console previews over a name-sorted pool and the save action
    // rebuilds it in insertion order; the saved draw must equal the preview.
    const byCreated = fixture(12);
    const byName = byCreated.slice().sort((a, b) => a.name.localeCompare(b.name));
    const reversed = byCreated.slice().reverse();
    const a = drawTeams(byCreated, { seed: 12345 });
    expect(drawTeams(byName, { seed: 12345 })).toEqual(a);
    expect(drawTeams(reversed, { seed: 12345 })).toEqual(a);
    expect(a.substitutes.map((p) => p.id)).toEqual(drawTeams(reversed, { seed: 12345 }).substitutes.map((p) => p.id));
  });

  it("varies with the seed", () => {
    const players = fixture(23);
    const seeds = [1, 2, 3, 4, 5];
    const rosters = new Set(seeds.map((seed) => JSON.stringify(rosterIds(drawTeams(players, { seed })))));
    const subs = new Set(
      seeds.map((seed) => JSON.stringify(drawTeams(players, { seed }).substitutes.map((p) => p.id).sort())),
    );
    expect(rosters.size).toBeGreaterThan(1);
    expect(subs.size).toBeGreaterThan(1);
  });

  it("never uses Math.random", () => {
    const spy = jest.spyOn(Math, "random");
    drawTeams(fixture(), { seed: 7 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("builds floor(n / teamSize) full teams and leaves the remainder as substitutes", () => {
    const players = fixture(23);
    const r = drawTeams(players, { seed: 11 });
    expect(r.teams).toHaveLength(4);
    expect(r.substitutes).toHaveLength(3);
    for (const t of r.teams) expect(t.players).toHaveLength(SCH_TEAM_SIZE);

    const ids = [...r.teams.flatMap((t) => t.players.map((p) => p.id)), ...r.substitutes.map((p) => p.id)];
    expect(ids.sort()).toEqual(players.map((p) => p.id).sort());
    expect(new Set(ids).size).toBe(players.length);
  });

  it("honours a custom team size", () => {
    const r = drawTeams(fixture(14), { seed: 3, teamSize: 4 });
    expect(r.teams).toHaveLength(3);
    expect(r.substitutes).toHaveLength(2);
    for (const t of r.teams) expect(t.players).toHaveLength(4);
  });

  it("numbers teams 1..N with default names and summed strength", () => {
    const r = drawTeams(fixture(), { seed: 9 });
    r.teams.forEach((t, i) => {
      expect(t.seed).toBe(i + 1);
      expect(t.name).toBe(teamName(i + 1));
      expect(t.strength).toBe(t.players.reduce((s, p) => s + p.score, 0));
    });
  });

  it("balances strength far better than a naive sequential split", () => {
    const players = fixture();
    const naive = sequentialSplit(players);
    const naiveSpread = strengthSpread(naive);
    expect(naiveSpread).toBe(250); // sanity: the fixture really is lopsided

    for (const seed of [1, 2, 3, 42, 77, 1234]) {
      const r = drawTeams(players, { seed });
      const spread = strengthSpread(r.teams);
      expect(spread).toBeLessThan(naiveSpread);
      // Total 1250 over 5 teams is divisible → a perfect split exists; the search must find it.
      expect(spread).toBeLessThanOrEqual(10);
    }
  });

  it("reaches the minimum possible spread when the total is not divisible", () => {
    // Sum 1390 over 5 teams → best achievable spread is 10 (scores are multiples of 10).
    const scores = [100, 100, 90, 90, 80, 80, 70, 70, 60, 60, 50, 50, 40, 40, 30, 30, 20, 20, 10, 10, 100, 10, 60, 60, 60];
    const players = scores.map((score, i) => ({ id: `q${i}`, name: `Q${i}`, score, roles: [ROLES[i % 5]] }));
    for (const seed of [1, 2, 2026]) {
      expect(strengthSpread(drawTeams(players, { seed }).teams)).toBe(10);
    }
  });

  it("uses role diversity as a secondary objective", () => {
    // Everyone equal → strength cannot discriminate; each block of five shares one role.
    const flat = Array.from({ length: 25 }, (_, i) => ({
      id: `f${i}`,
      name: `F${i}`,
      score: 50,
      roles: [ROLES[Math.floor(i / 5)]],
    }));
    expect(totalRoleCollisions(sequentialSplit(flat))).toBe(25);
    for (const seed of [1, 2, 3, 42]) {
      const r = drawTeams(flat, { seed });
      expect(strengthSpread(r.teams)).toBe(0);
      expect(totalRoleCollisions(r.teams)).toBe(0);
      for (const t of r.teams) {
        expect(new Set(t.players.flatMap((p) => p.roles)).size).toBe(5);
      }
    }
  });

  it("stays within a tight spread on random rosters (regression guard for the local search)", () => {
    const rng = mulberry32(2026);
    for (let seed = 0; seed < 60; seed++) {
      const n = 15 + Math.floor(rng() * 30);
      const players: DrawPlayer[] = Array.from({ length: n }, (_, i) => ({
        id: `r${i}`,
        name: `R${i}`,
        score: Math.round(rng() * 100),
        roles: [ROLES[Math.floor(rng() * ROLES.length)]],
      }));
      const r = drawTeams(players, { seed });
      const naive = strengthSpread(sequentialSplit(players));
      const spread = strengthSpread(r.teams);
      expect(spread).toBeLessThanOrEqual(Math.max(12, naive));
      expect(r.teams.length).toBe(Math.floor(n / SCH_TEAM_SIZE));
    }
  });

  it("never trades strength balance for role diversity", () => {
    const players = fixture();
    const r = drawTeams(players, { seed: 5, maxEvaluations: 0 });
    const baseSpread = strengthSpread(r.teams);
    const searched = drawTeams(players, { seed: 5 });
    expect(strengthSpread(searched.teams)).toBeLessThanOrEqual(baseSpread);
  });

  it("handles players without roles (CS2)", () => {
    const cs = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, score: (i + 1) * 10, roles: [] }));
    const r = drawTeams(cs, { seed: 8 });
    expect(r.teams).toHaveLength(2);
    expect(strengthSpread(r.teams)).toBeLessThanOrEqual(10);
    expect(totalRoleCollisions(r.teams)).toBe(0);
  });

  it("returns no teams for empty or short input", () => {
    expect(drawTeams([], { seed: 1 })).toEqual({ teams: [], substitutes: [], seed: 1 });
    const four = fixture(4);
    const r = drawTeams(four, { seed: 1 });
    expect(r.teams).toEqual([]);
    expect(r.substitutes.map((p) => p.id).sort()).toEqual(four.map((p) => p.id).sort());
  });

  it("clamps scores to 0–100 and dedupes roles without mutating the input", () => {
    const input: DrawPlayer[] = [
      { id: "a", name: "A", score: 150, roles: ["Jungle", "Jungle"] },
      { id: "b", name: "B", score: -5, roles: [] },
      { id: "c", name: "C", score: Number.NaN, roles: ["Roamer"] },
    ];
    const snapshot = JSON.stringify(input);
    const r = drawTeams(input, { seed: 1, teamSize: 1 });
    expect(JSON.stringify(input)).toBe(snapshot);
    const byId = Object.fromEntries(r.teams.map((t) => [t.players[0].id, t.players[0]]));
    expect(byId.a.score).toBe(100);
    expect(byId.a.roles).toEqual(["Jungle"]);
    expect(byId.b.score).toBe(0);
    expect(byId.c.score).toBe(0);
  });
});

describe("helpers", () => {
  it("teamName / strengthLabel", () => {
    expect(teamName(1)).toBe("Team 1");
    expect(teamName(12)).toBe("Team 12");
    expect(strengthLabel(250, 5)).toBe(50);
    expect(strengthLabel(247, 5)).toBe(49);
    expect(strengthLabel(0, 0)).toBe(0);
    expect(strengthLabel(Number.NaN, 5)).toBe(0);
  });

  it("roleCollisions counts players whose every role a teammate already covers", () => {
    const team: DrawPlayer[] = [
      { id: "1", name: "", score: 1, roles: ["Jungle"] },
      { id: "2", name: "", score: 1, roles: ["Jungle", "Mid Lane"] },
      { id: "3", name: "", score: 1, roles: ["Mid Lane"] },
      { id: "4", name: "", score: 1, roles: [] },
      { id: "5", name: "", score: 1, roles: ["Roamer"] },
    ];
    // 1: Jungle covered by 2 → collides. 2: Jungle (1) + Mid (3) → collides. 3: Mid covered by 2 → collides.
    // 4: no roles → ignored. 5: Roamer unique → fine.
    expect(roleCollisions(team)).toBe(3);
    expect(strengthSpread([])).toBe(0);
    expect(strengthSpread([{ strength: 5 }])).toBe(0);
  });
});

describe("format helpers", () => {
  it("maskSteam shows the compact profile path", () => {
    expect(maskSteam("https://steamcommunity.com/id/zorig/")).toBe("steamcommunity.com/id/zorig");
    expect(maskSteam("http://www.steamcommunity.com/profiles/76561198000000000")).toBe(
      "steamcommunity.com/profiles/76561198000000000",
    );
    expect(maskSteam("STEAMCOMMUNITY.COM/ID/Bat.Erdene")).toBe("steamcommunity.com/id/Bat.Erdene");
    expect(maskSteam("  Zorig#1234 ")).toBe("Zorig#1234");
    expect(maskSteam("")).toBe("");
    expect(maskSteam(null)).toBe("");
    expect(isSteamUrl("https://steamcommunity.com/id/zorig")).toBe(true);
    expect(isSteamUrl("Zorig#1234")).toBe(false);
  });

  it("facebookHref accepts handles, fb.com paths and full URLs", () => {
    expect(facebookHref("zorig.b")).toBe("https://www.facebook.com/zorig.b");
    expect(facebookHref("@zorig")).toBe("https://www.facebook.com/zorig");
    expect(facebookHref("fb.com/zorig")).toBe("https://fb.com/zorig");
    expect(facebookHref("facebook.com/zorig/")).toBe("https://www.facebook.com/zorig");
    expect(facebookHref("https://www.facebook.com/zorig")).toBe("https://www.facebook.com/zorig");
    expect(facebookHref("http://m.facebook.com/profile.php?id=100001")).toBe(
      "https://m.facebook.com/profile.php?id=100001",
    );
    expect(facebookHref("https://web.facebook.com/people/Zorig/1234")).toBe(
      "https://web.facebook.com/people/Zorig/1234",
    );
  });

  it("facebookHref rejects free text, other hosts and unsafe schemes", () => {
    expect(facebookHref("")).toBe(null);
    expect(facebookHref(null)).toBe(null);
    expect(facebookHref("Зориг Бат")).toBe(null);
    expect(facebookHref("no facebook")).toBe(null);
    expect(facebookHref("https://instagram.com/zorig")).toBe(null);
    expect(facebookHref("javascript:alert(1)")).toBe(null);
    expect(facebookHref("facebook.com")).toBe(null);
    expect(facebookHref("https://facebook.com/")).toBe(null);
    expect(facebookHref("https://facebook.com.evil.io/zorig")).toBe(null);
  });
});
