import type { NewSuspect, Suspect } from "./types";

/**
 * Port for persisting Suspect aggregates. Pure interface — no Supabase
 * or any other infra type appears here. Adapters live next to this
 * file (`supabase-repository.ts`, `in-memory-repository.ts` for tests).
 *
 * Why a repository instead of calling supabase directly?
 *
 *   * Domain code becomes testable without spinning up Postgres.
 *   * Storage swaps (Supabase → Aurora, or a sharded scheme later)
 *     touch one file instead of every route.
 *   * Centralises the projection from DB rows to domain entities — no
 *     more "did this caller remember to map `image_path` to
 *     `imagePath`?" footguns.
 */
export interface SuspectRepository {
  list(): Promise<Suspect[]>;
  findById(id: string): Promise<Suspect | null>;
  create(input: NewSuspect): Promise<Suspect>;
  updatePrivacyTier(id: string, tier: Suspect["privacyTier"]): Promise<Suspect | null>;
  delete(id: string): Promise<boolean>;
}

/** Thrown when a write fails for a domain-level reason (e.g.,
 *  duplicate name, missing image). Caller catches and renders a
 *  friendly message; the underlying DB error is logged via lib/log.ts. */
export class SuspectRepositoryError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SuspectRepositoryError";
  }
}
