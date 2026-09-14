import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.generated";

/**
 * SQL retires rows and durably queues Storage paths in the same transaction.
 * Workers lease that queue and acknowledge only successful Storage removals.
 * Failed requests and crashed workers leave work available for a later sweep.
 */
export type RetentionQueueHealth = { pending: number; failed: number; oldest_created_at: string | null };
export type SweepResult = {
  status: "ok" | "pending" | "degraded";
  queue: RetentionQueueHealth;
  rows: Record<string, unknown>;
  objects: Record<string, { requested: number; removed: number; error?: string }>;
};

type Deletion = { id: string; bucket: string; object_path: string; lease_token: string };
type RpcResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

// Forward migration contract; regenerate deployed DB types after applying
// 20260907101000_retention_deletion_queue.sql.
type QueueRpc = {
  (name: "claim_retention_deletions", args: { p_limit: number }): RpcResult<Deletion[]>;
  (name: "settle_retention_deletions", args: {
    p_ids: string[]; p_lease_token: string; p_error: string | null;
  }): RpcResult<number>;
};

const BATCH_SIZE = 250;
const MAX_BATCHES = 80;
const BUCKETS = new Set(["recordings", "faces", "revealed"]);

export async function readRetentionQueueHealth(svc: SupabaseClient<Database>): Promise<RetentionQueueHealth> {
  const rpc = svc.rpc.bind(svc) as unknown as (name: "retention_queue_health") => RpcResult<RetentionQueueHealth>;
  const { data, error } = await rpc("retention_queue_health");
  if (error || !data || !Number.isSafeInteger(data.pending) || !Number.isSafeInteger(data.failed)) {
    throw new Error("Retention queue health unavailable");
  }
  return data;
}

export async function runRetentionSweep(svc: SupabaseClient<Database>, options: { maxBatches?: number; budgetMs?: number } = {}): Promise<SweepResult> {
  const maxBatches = Math.max(1, Math.min(400, options.maxBatches ?? MAX_BATCHES));
  const deadline = Date.now() + Math.max(1, Math.min(40000, options.budgetMs ?? 20000));
  const { data, error } = await svc.rpc("sweep_retention");
  if (error) throw new Error(error.message);
  const { objects: _oldPathList, ...rows } = (data ?? {}) as Record<string, unknown>;
  const summary: SweepResult["objects"] = {};
  const queueRpc = svc.rpc.bind(svc) as unknown as QueueRpc;

  // Bounded batches leave large backlogs for later invocations. Exclusive
  // claims expire after a crash; unclaimed work always remains queued.
  for (let batch = 0; batch < maxBatches && Date.now() < deadline; batch++) {
    const { data: claimed, error: claimError } = await queueRpc("claim_retention_deletions", {
      p_limit: BATCH_SIZE,
    });
    if (claimError) throw new Error(`Retention queue claim failed: ${claimError.message}`);
    if (!claimed?.length) break;

    const groups = new Map<string, Deletion[]>();
    for (const item of claimed) {
      if (!BUCKETS.has(item.bucket) || !item.object_path || !item.lease_token) {
        throw new Error("Retention queue returned an invalid deletion");
      }
      const key = `${item.bucket}:${item.lease_token}`;
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      const { bucket, lease_token } = group[0];
      const entry = summary[bucket] ??= { requested: 0, removed: 0 };
      entry.requested += group.length;
      let removalError: string | null = null;
      try {
        const removed = await svc.storage.from(bucket).remove(group.map((item) => item.object_path));
        removalError = removed.error?.message ?? null;
        if (!removalError) entry.removed += removed.data?.length ?? 0;
      } catch (err) {
        removalError = err instanceof Error ? err.message : "Storage removal failed";
      }
      if (removalError) entry.error = removalError;
      const { data: settled, error: settleError } = await queueRpc("settle_retention_deletions", {
        p_ids: group.map((item) => item.id),
        p_lease_token: lease_token,
        p_error: removalError,
      });
      if (settleError || settled !== group.length) {
        // Failed acknowledgement or a replaced lease must not look complete.
        // A retry may remove already-absent paths, which is safe.
        throw new Error(`Retention queue settlement failed: ${settleError?.message ?? "lease expired"}`);
      }
    }
  }
  const queue = await readRetentionQueueHealth(svc);
  const errors = Object.values(summary).some((result) => result.error)
    || Object.values(rows).some((result) => result && typeof result === "object" && "error" in result);
  const status = errors || queue.failed > 0 ? "degraded" : queue.pending > 0 ? "pending" : "ok";
  return { status, queue, rows, objects: summary };
}
