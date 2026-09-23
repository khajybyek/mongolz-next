/**
 * Team-draw panel state (lib/sch/draw-state.ts) and the close-out date gate
 * (lib/sch/close-out.ts).
 */
import { playersBeyondSubstitutes, poolFingerprint } from "@/lib/sch/draw-state";
import { closeOutAllowed, closeOutOpensAt, lastGameDay } from "@/lib/sch/close-out";
import { SCH_TEAM_SIZE } from "@/lib/sch/schema";

const seat = (teamName: string | null) => ({ teamName });

describe("playersBeyondSubstitutes", () => {
  it("6 paid, 1 saved team of 5 → the 1 substitute never asks for a re-draw", () => {
    const pool = [...Array.from({ length: 5 }, () => seat("Team 1")), seat(null)];
    expect(playersBeyondSubstitutes(pool, 1, SCH_TEAM_SIZE)).toBe(0);
  });

  it("a new paid player that only adds a substitute does not warn", () => {
    const pool = [...Array.from({ length: 5 }, () => seat("Team 1")), seat(null), seat(null)];
    expect(playersBeyondSubstitutes(pool, 1, SCH_TEAM_SIZE)).toBe(0);
  });

  it("enough new paid players for another team → warns with the count beyond the substitutes", () => {
    const pool = [...Array.from({ length: 5 }, () => seat("Team 1")), ...Array.from({ length: 6 }, () => seat(null))];
    // 11 paid → 2 full teams + 1 substitute; 6 unassigned, 5 of them belong in a team.
    expect(playersBeyondSubstitutes(pool, 1, SCH_TEAM_SIZE)).toBe(5);
  });

  it("nothing saved yet → 0; never negative", () => {
    expect(playersBeyondSubstitutes([seat(null), seat(null)], 0, SCH_TEAM_SIZE)).toBe(0);
    // A team member was marked unpaid: 4 left in the team, all seated.
    expect(playersBeyondSubstitutes(Array.from({ length: 4 }, () => seat("Team 1")), 1, SCH_TEAM_SIZE)).toBe(0);
  });
});

describe("poolFingerprint", () => {
  const p = (id: string, score: number, roles: string[]) => ({ id, score, roles });

  it("ignores list order and role order", () => {
    expect(poolFingerprint([p("a", 50, ["Mid", "Jungle"]), p("b", 30, [])])).toBe(
      poolFingerprint([p("b", 30, []), p("a", 50, ["Jungle", "Mid"])]),
    );
  });

  it("changes with a rank, a role or the member set", () => {
    const base = poolFingerprint([p("a", 50, ["Mid"]), p("b", 30, [])]);
    expect(poolFingerprint([p("a", 60, ["Mid"]), p("b", 30, [])])).not.toBe(base);
    expect(poolFingerprint([p("a", 50, ["Roam"]), p("b", 30, [])])).not.toBe(base);
    expect(poolFingerprint([p("a", 50, ["Mid"])])).not.toBe(base);
  });
});

describe("close-out date gate", () => {
  const dates = { mobile_legends: "2026-09-25", cs2: "2026-09-26", dota2: "2026-09-27" };

  it("opens at 00:00 KST on the day after the last game day", () => {
    expect(lastGameDay(dates)).toBe("2026-09-27");
    expect(closeOutOpensAt(dates).toISOString()).toBe("2026-09-27T15:00:00.000Z");
    expect(closeOutAllowed(dates, Date.parse("2026-09-27T23:59:59+09:00"))).toBe(false);
    expect(closeOutAllowed(dates, Date.parse("2026-09-28T00:00:00+09:00"))).toBe(true);
  });

  it("a moved-back game date moves the gate; malformed values fall back to the defaults", () => {
    expect(lastGameDay({ ...dates, cs2: "2026-10-03" })).toBe("2026-10-03");
    expect(lastGameDay({ mobile_legends: "soon", cs2: 7 })).toBe("2026-09-27");
    expect(lastGameDay(null)).toBe("2026-09-27");
  });
});
