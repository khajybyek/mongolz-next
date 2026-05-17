import { randomUUID } from "node:crypto";
import { SuspectRepositoryError, type SuspectRepository } from "./repository";
import type { NewSuspect, Suspect } from "./types";

/** Test-only in-memory adapter. Use in unit tests to avoid spinning up
 *  Postgres. The state lives in `this.rows` so each test should
 *  instantiate a fresh repo. */
export class InMemorySuspectRepository implements SuspectRepository {
  rows: Suspect[] = [];

  constructor(seed: Suspect[] = []) {
    this.rows = [...seed];
  }

  list(): Promise<Suspect[]> {
    return Promise.resolve(
      [...this.rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  findById(id: string): Promise<Suspect | null> {
    return Promise.resolve(this.rows.find((r) => r.id === id) ?? null);
  }

  async create(input: NewSuspect): Promise<Suspect> {
    if (this.rows.some((r) => r.name === input.name)) {
      throw new SuspectRepositoryError(`name in use: ${input.name}`);
    }
    const next: Suspect = {
      id: randomUUID(),
      name: input.name,
      imagePath: input.imagePath,
      notes: input.notes ?? null,
      privacyTier: input.privacyTier ?? "standard",
      createdAt: new Date().toISOString(),
    };
    this.rows.push(next);
    return next;
  }

  updatePrivacyTier(id: string, tier: Suspect["privacyTier"]): Promise<Suspect | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return Promise.resolve(null);
    row.privacyTier = tier;
    return Promise.resolve(row);
  }

  delete(id: string): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return Promise.resolve(this.rows.length < before);
  }
}
