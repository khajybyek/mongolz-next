import { z } from "zod";

/**
 * How often the ML service re-matches a person who stays in view against the
 * watch list (ml-service/recording_pipeline.py `SESSION_ALERT_RECHECK_SEC`,
 * default 60). MUST match the Railway env value: a burst rule only counts
 * those re-matches, so a continuously present suspect produces about one
 * match per interval.
 */
export const ML_ALERT_RECHECK_SEC = 60;

/** Marker issue message for the unreachable-burst case (mapped to i18n by the action). */
export const BURST_UNREACHABLE = "BURST_UNREACHABLE";

/**
 * A burst of `burst_count` matches needs roughly `(burst_count - 1)` recheck
 * intervals to accumulate; one extra interval absorbs scheduling jitter. A
 * shorter window can never be satisfied, so the rule would silently never
 * alert ("3 matches in 60 s" never fired for a person standing in view for
 * 15 minutes).
 */
export function burstReachable(burstCount: number, burstWindowSec: number): boolean {
  if (burstCount <= 1) return true;
  return burstWindowSec >= ML_ALERT_RECHECK_SEC * burstCount;
}

export const ruleSchema = z
  .object({
    name: z.string().min(1).max(120),
    enabled: z.boolean().optional().default(true),
    suspect_id: z.guid().optional().nullable(),
    camera_id: z.guid().optional().nullable(),
    min_similarity: z.number().min(0).max(1).default(0.45),
    dedup_window_sec: z.number().int().min(0).max(86400).default(300),
    burst_count: z.number().int().min(1).max(100).default(1),
    burst_window_sec: z.number().int().min(1).max(3600).default(60),
    quiet_from: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
    quiet_to: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (!burstReachable(v.burst_count, v.burst_window_sec)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["burst_window_sec"],
        message: BURST_UNREACHABLE,
      });
    }
  });
