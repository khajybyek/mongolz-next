import type { ActiveCamera } from "@/lib/ml-client";
import type { TranslationKey } from "@/lib/i18n/translations";

/** "running" = capturing; "backoff" = dropped, the ML supervisor will retry. */
export type CameraCaptureState = "running" | "backoff";

/** Supervisor history for one camera (ML `/camera/active`). */
export interface CameraRestartInfo {
  /** Supervisor restarts so far (0 for a camera whose first drop is pending). */
  count: number;
  /** Why the previous capture loop ended — an ML reason string, never a URL. */
  lastError: string | null;
  state: CameraCaptureState;
  /** Next reconnect attempt (ISO UTC) — backoff only, null when not yet scheduled. */
  nextRetryAt: string | null;
}

const MAX_REASON_LEN = 200;
// The ML service already strips URLs and credentials from reasons; this is
// the second gate, so a regression there still never paints a camera URL
// (which may carry RTSP credentials) into the page for a viewer.
const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/|\S:\S*@\S/i;

function safeReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_REASON_LEN);
  if (!text || URL_LIKE.test(text)) return null;
  return text;
}

function safeIso(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 64) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Restart / reconnect info keyed by camera id, for cameras the caller may
 * see. Included: running cameras the supervisor restarted at least once, and
 * every camera in backoff (even before its first restart — that is exactly
 * the unreachable-source case the operator needs to see). A running entry
 * wins over a stale backoff entry for the same id.
 */
export function restartInfoFor(
  entries: readonly ActiveCamera[],
  visibleIds: ReadonlySet<string>,
): Record<string, CameraRestartInfo> {
  const out: Record<string, CameraRestartInfo> = {};
  for (const c of entries) {
    if (!visibleIds.has(c.camera_id)) continue;
    const state: CameraCaptureState = c.state === "backoff" ? "backoff" : "running";
    const raw = Number(c.restart_count ?? 0);
    const count = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    if (state === "running" && count <= 0) continue;
    const prev = out[c.camera_id];
    if (prev && prev.state === "running") continue;
    out[c.camera_id] = {
      count,
      lastError: safeReason(c.last_error),
      state,
      nextRetryAt: state === "backoff" ? safeIso(c.next_retry_at) : null,
    };
  }
  return out;
}

const KST_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * "HH:mm" in Asia/Seoul for a reconnect time, or null when there is none to
 * show (unknown, unparsable, or already passed — the retry is then imminent).
 */
export function formatRetryClockKst(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= now) return null;
  const part: Record<string, string> = {};
  for (const p of KST_CLOCK.formatToParts(new Date(ms))) part[p.type] = p.value;
  return `${part.hour}:${part.minute}`;
}

/**
 * The reconnect copy for a camera in supervisor backoff:
 * "Reconnecting — next try at HH:mm (KST)", or "Reconnecting — retrying
 * shortly" when the time is unknown or already due. Null for a running camera.
 */
export function reconnectText(
  info: CameraRestartInfo,
  t: (key: TranslationKey) => string,
  now: number = Date.now(),
): string | null {
  if (info.state !== "backoff") return null;
  const clock = formatRetryClockKst(info.nextRetryAt, now);
  return clock
    ? `${t("camera_reconnecting")} — ${t("camera_next_try_at")} ${clock} (KST)`
    : `${t("camera_reconnecting")} — ${t("camera_retry_soon")}`;
}
