import type { SupabaseClient } from "@supabase/supabase-js";
import { SuspectRepositoryError, type SuspectRepository } from "./repository";
import { isPrivacyTier, type NewSuspect, type Suspect } from "./types";

interface SuspectRow {
  id: string;
  name: string;
  image_path: string;
  notes: string | null;
  privacy_tier: string | null;
  created_at: string;
}

function toDomain(row: SuspectRow): Suspect {
  return {
    id: row.id,
    name: row.name,
    imagePath: row.image_path,
    notes: row.notes,
    privacyTier: isPrivacyTier(row.privacy_tier) ? row.privacy_tier : "standard",
    createdAt: row.created_at,
  };
}

/** Supabase-backed implementation of SuspectRepository. The client is
 *  injected so that auth-scoped, service-role, and test in-memory
 *  variants share the same surface. */
export class SupabaseSuspectRepository implements SuspectRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<Suspect[]> {
    const { data, error } = await this.client
      .from("suspects")
      .select("id, name, image_path, notes, privacy_tier, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new SuspectRepositoryError("list failed", error);
    return (data ?? []).map((row) => toDomain(row as SuspectRow));
  }

  async findById(id: string): Promise<Suspect | null> {
    const { data, error } = await this.client
      .from("suspects")
      .select("id, name, image_path, notes, privacy_tier, created_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new SuspectRepositoryError("findById failed", error);
    return data ? toDomain(data as SuspectRow) : null;
  }

  async create(input: NewSuspect): Promise<Suspect> {
    const { data, error } = await this.client
      .from("suspects")
      .insert({
        name: input.name,
        image_path: input.imagePath,
        notes: input.notes ?? null,
        privacy_tier: input.privacyTier ?? "standard",
      })
      .select("id, name, image_path, notes, privacy_tier, created_at")
      .single();
    if (error || !data) throw new SuspectRepositoryError("create failed", error);
    return toDomain(data as SuspectRow);
  }

  async updatePrivacyTier(id: string, tier: Suspect["privacyTier"]): Promise<Suspect | null> {
    const { data, error } = await this.client
      .from("suspects")
      .update({ privacy_tier: tier })
      .eq("id", id)
      .select("id, name, image_path, notes, privacy_tier, created_at")
      .maybeSingle();
    if (error) throw new SuspectRepositoryError("updatePrivacyTier failed", error);
    return data ? toDomain(data as SuspectRow) : null;
  }

  async delete(id: string): Promise<boolean> {
    const { error, count } = await this.client
      .from("suspects")
      .delete({ count: "exact" })
      .eq("id", id);
    if (error) throw new SuspectRepositoryError("delete failed", error);
    return (count ?? 0) > 0;
  }
}
