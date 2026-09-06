import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.generated";

/**
 * Retention sweep = SQL row deletion (public.sweep_retention) + storage
 * object removal for the paths the RPC reports. Shared by the daily cron and
 * the manual "sweep now" action so both leave no orphaned blobs behind
 * (encrypted originals, face crops, un-blurred reveal outputs).
 */
export type SweepResult = {
  rows: Record<string, unknown>;
  objects: Record<string, { requested: number; removed: number; error?: string }>;
};

const BUCKET_FOR: Record<string, string> = {
  recordings: "recordings",
  faces: "faces",
  revealed: "revealed",
};

export async function runRetentionSweep(svc: SupabaseClient<Database>): Promise<SweepResult> {
  const { data, error } = await svc.rpc("sweep_retention");
  if (error) throw new Error(error.message);

  const result = (data ?? {}) as Record<string, unknown>;
  const objects = (result.objects ?? {}) as Record<string, unknown>;
  const summary: SweepResult["objects"] = {};

  for (const [key, bucket] of Object.entries(BUCKET_FOR)) {
    const paths = Array.isArray(objects[key])
      ? (objects[key] as unknown[]).filter((p): p is string => typeof p === "string" && p.length > 0)
      : [];
    if (paths.length === 0) continue;
    let removed = 0;
    let errMsg: string | undefined;
    // Storage remove() accepts up to ~1000 keys per call.
    for (let i = 0; i < paths.length; i += 500) {
      const chunk = paths.slice(i, i + 500);
      const { data: gone, error: rmErr } = await svc.storage.from(bucket).remove(chunk);
      if (rmErr) {
        errMsg = rmErr.message;
        break;
      }
      removed += gone?.length ?? 0;
    }
    summary[bucket] = { requested: paths.length, removed, ...(errMsg ? { error: errMsg } : {}) };
  }

  const { objects: _dropped, ...rows } = result;
  return { rows, objects: summary };
}
