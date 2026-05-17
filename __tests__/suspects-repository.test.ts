/** @jest-environment node */
import {
  InMemorySuspectRepository,
  SuspectRepositoryError,
  isPrivacyTier,
  PRIVACY_TIERS,
  type Suspect,
} from "@/lib/domain/suspects";

function sampleSuspect(overrides: Partial<Suspect> = {}): Suspect {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Sample",
    imagePath: "suspects/sample.jpg",
    notes: null,
    privacyTier: "standard",
    createdAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("InMemorySuspectRepository", () => {
  it("starts empty by default", async () => {
    const repo = new InMemorySuspectRepository();
    expect(await repo.list()).toEqual([]);
  });

  it("returns seeded rows newest-first", async () => {
    const older = sampleSuspect({ id: "1", name: "Older", createdAt: "2026-05-01T00:00:00Z" });
    const newer = sampleSuspect({ id: "2", name: "Newer", createdAt: "2026-05-02T00:00:00Z" });
    const repo = new InMemorySuspectRepository([older, newer]);
    const list = await repo.list();
    expect(list.map((r) => r.id)).toEqual(["2", "1"]);
  });

  it("create() assigns an id and createdAt", async () => {
    const repo = new InMemorySuspectRepository();
    const created = await repo.create({ name: "X", imagePath: "p" });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(new Date(created.createdAt).getTime()).toBeGreaterThan(0);
    expect(created.privacyTier).toBe("standard");
  });

  it("create() rejects duplicate names", async () => {
    const repo = new InMemorySuspectRepository();
    await repo.create({ name: "X", imagePath: "p" });
    await expect(repo.create({ name: "X", imagePath: "q" })).rejects.toBeInstanceOf(
      SuspectRepositoryError,
    );
  });

  it("findById() returns null on miss", async () => {
    const repo = new InMemorySuspectRepository();
    expect(await repo.findById("not-here")).toBeNull();
  });

  it("findById() returns the row on hit", async () => {
    const repo = new InMemorySuspectRepository([sampleSuspect({ id: "abc" })]);
    expect(await repo.findById("abc")).not.toBeNull();
  });

  it("updatePrivacyTier() mutates and returns the updated row", async () => {
    const repo = new InMemorySuspectRepository([sampleSuspect({ id: "abc" })]);
    const updated = await repo.updatePrivacyTier("abc", "vip");
    expect(updated?.privacyTier).toBe("vip");
    const reread = await repo.findById("abc");
    expect(reread?.privacyTier).toBe("vip");
  });

  it("updatePrivacyTier() returns null on miss", async () => {
    const repo = new InMemorySuspectRepository();
    expect(await repo.updatePrivacyTier("missing", "vip")).toBeNull();
  });

  it("delete() returns true on hit, false on miss", async () => {
    const repo = new InMemorySuspectRepository([sampleSuspect({ id: "abc" })]);
    expect(await repo.delete("abc")).toBe(true);
    expect(await repo.delete("abc")).toBe(false);
    expect(await repo.list()).toHaveLength(0);
  });

  it("create() with explicit tier respects the input", async () => {
    const repo = new InMemorySuspectRepository();
    const r = await repo.create({ name: "VIP", imagePath: "p", privacyTier: "vip" });
    expect(r.privacyTier).toBe("vip");
  });
});

describe("PrivacyTier helpers", () => {
  it("PRIVACY_TIERS lists all three tiers", () => {
    expect(PRIVACY_TIERS).toEqual(["vip", "standard", "relaxed"]);
  });

  it("isPrivacyTier accepts valid tiers", () => {
    expect(isPrivacyTier("vip")).toBe(true);
    expect(isPrivacyTier("standard")).toBe(true);
    expect(isPrivacyTier("relaxed")).toBe(true);
  });

  it("isPrivacyTier rejects everything else", () => {
    expect(isPrivacyTier("admin")).toBe(false);
    expect(isPrivacyTier(null)).toBe(false);
    expect(isPrivacyTier(undefined)).toBe(false);
    expect(isPrivacyTier(0)).toBe(false);
    expect(isPrivacyTier({})).toBe(false);
  });
});
