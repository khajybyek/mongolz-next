import type { ActiveCamera } from "@/lib/ml-client";

/** Supervisor history for one streaming camera (ML `/camera/active`). */
export interface CameraRestartInfo {
  count: number;
  /** Why the previous capture loop ended — an ML reason string, never a URL. */
  lastError: string | null;
}

/**
 * Restart info keyed by camera id, for streaming cameras the caller may see
 * that the ML supervisor restarted at least once.
 */
export function restartInfoFor(
  active: readonly ActiveCamera[],
  visibleIds: ReadonlySet<string>,
): Record<string, CameraRestartInfo> {
  const out: Record<string, CameraRestartInfo> = {};
  for (const c of active) {
    const count = Number(c.restart_count ?? 0);
    if (!visibleIds.has(c.camera_id) || !Number.isFinite(count) || count <= 0) continue;
    const err = typeof c.last_error === "string" ? c.last_error.slice(0, 200) : null;
    out[c.camera_id] = { count: Math.floor(count), lastError: err || null };
  }
  return out;
}
