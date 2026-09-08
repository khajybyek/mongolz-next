import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Match the administrator's 0..99 authority setting. Zero is privileged;
// missing or malformed authority must never be converted to zero.
export function isRevealLevel(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 99;
}

export async function readRevealAuthority(userId: string): Promise<
  { level: number } | { error: NextResponse }
> {
  try {
    const { data, error } = await createServiceClient()
      .from("profiles")
      .select("role, reveal_level")
      .eq("id", userId)
      .single();
    if (error) {
      return { error: NextResponse.json({ error: "AUTHORITY_UNAVAILABLE" }, { status: 503 }) };
    }
    if (!data || data.role !== "admin" || !isRevealLevel(data.reveal_level)) {
      return { error: NextResponse.json({ error: "REVEAL_FORBIDDEN" }, { status: 403 }) };
    }
    return { level: data.reveal_level };
  } catch {
    return { error: NextResponse.json({ error: "AUTHORITY_UNAVAILABLE" }, { status: 503 }) };
  }
}

/** A lower number has broader authority, so L3 cannot view an L0 output. */
export function canReadRevealOutput(callerLevel: unknown, outputLevel: unknown): boolean {
  return isRevealLevel(callerLevel) && isRevealLevel(outputLevel) && callerLevel <= outputLevel;
}
