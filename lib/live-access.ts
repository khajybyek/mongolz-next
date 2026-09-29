/**
 * Live-video access, decided the way the HLS gateway
 * (app/api/ml/stream/[cameraId]/[segment]/route.ts) decides it, so pages can
 * say "no access" up front instead of letting the player hit a 403.
 *
 * Two levels of camera access exist and they differ on purpose:
 *   • Lists, camera_health and playback go through private.user_can_see_camera(),
 *     which is default-allow: a camera with no camera_permissions rows is
 *     visible to every operator.
 *   • Live video is stricter. The camera must be enabled, admins pass, and
 *     every other operator needs an explicit camera_permissions row naming
 *     them. With no rows anywhere, live video is admin-only.
 * Auditors never reach the gateway (requireUserApi is admin | viewer only).
 *
 * The page-side verdict is advisory — the gateway re-checks every playlist and
 * segment request — so a lookup failure fails closed (locked tile) rather
 * than crashing the page. A grant revoked while a page is open, or a camera
 * disabled meanwhile, arrives as a runtime 403 with one of STREAM_DENY_CODES.
 *
 * Client-safe: only type imports plus the dependency-free logger.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.generated";
import type { TranslationKey } from "@/lib/i18n/translations";
import { log } from "@/lib/log";

/** Refusal codes the stream gateway returns with a 403 (`{ error, code }`). */
export const STREAM_DENY_CODES = ["camera_disabled", "camera_not_authorized", "permission_check_failed"] as const;
export type StreamDenyCode = (typeof STREAM_DENY_CODES)[number];

export function isStreamDenyCode(value: unknown): value is StreamDenyCode {
  return typeof value === "string" && (STREAM_DENY_CODES as readonly string[]).includes(value);
}

/** Bodies larger than this are not a refusal JSON — do not parse them. */
const MAX_REFUSAL_BODY = 4096;

/**
 * Refusal code from a gateway response body — JSON text or an already parsed
 * object. Anything else (a 403 for an expired ticket carries no code, a
 * playlist, garbage) is `null`, which callers treat as an ordinary error.
 */
export function parseStreamDenyCode(body: unknown): StreamDenyCode | null {
  let value = body;
  if (typeof value === "string") {
    if (value.length === 0 || value.length > MAX_REFUSAL_BODY) return null;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const code = (value as { code?: unknown }).code;
  return isStreamDenyCode(code) ? code : null;
}

/**
 * Refusal code from the request hls.js reports with a load error
 * (`ErrorData.networkDetails` is the XMLHttpRequest for the default loader).
 * Playlists load as text; segments load as ArrayBuffer, whose refusal body is
 * still the gateway's small JSON. Reading `responseText` on a binary request
 * throws, hence the responseType check and the try.
 */
export function readStreamDenyCode(networkDetails: unknown): StreamDenyCode | null {
  if (!networkDetails || typeof networkDetails !== "object") return null;
  const d = networkDetails as { responseType?: unknown; responseText?: unknown; response?: unknown };
  try {
    if ((d.responseType === "" || d.responseType === "text") && typeof d.responseText === "string") {
      return parseStreamDenyCode(d.responseText);
    }
    if (d.response instanceof ArrayBuffer && d.response.byteLength <= MAX_REFUSAL_BODY) {
      return parseStreamDenyCode(new TextDecoder().decode(d.response));
    }
  } catch {
    /* unreadable response — fall through */
  }
  return null;
}

export type StreamFailure = {
  /** HTTP status of the failing request; undefined when none was observed. */
  status: number | undefined;
  /** Set only for a gateway refusal (403 with a known code). */
  code: StreamDenyCode | null;
};

/**
 * Ask the gateway once why a stream failed, for players that cannot read the
 * failing response themselves (Safari's native HLS reports no status at all).
 * A playlist that loads fine means the failure was a media error: no status.
 */
export async function probeStreamFailure(
  src: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StreamFailure> {
  try {
    const res = await fetchImpl(src, { cache: "no-store", credentials: "same-origin" });
    if (res.ok) return { status: undefined, code: null };
    if (res.status !== 403) return { status: res.status, code: null };
    return { status: 403, code: parseStreamDenyCode(await res.text()) };
  } catch {
    return { status: undefined, code: null };
  }
}

/** What a tile says for each refusal. A missing grant reads the same as a locked tile. */
export const STREAM_DENY_MESSAGE: Record<StreamDenyCode, TranslationKey> = {
  camera_disabled: "live_denied_disabled",
  camera_not_authorized: "live_no_access",
  permission_check_failed: "live_denied_check_failed",
};

export function streamDenyMessageKey(code: StreamDenyCode): TranslationKey {
  return STREAM_DENY_MESSAGE[code];
}

/**
 * Whether trying again can succeed without an admin acting. A failed check is
 * transient (the operator may retry by hand; nothing retries on its own); a
 * disabled camera or a missing grant needs an administrator.
 */
export function isRetryableDenial(code: StreamDenyCode): boolean {
  return code === "permission_check_failed";
}

/**
 * Why a live tile shows no video: "no_grant" is known before any request
 * (liveAllowed=false); the rest are the gateway's runtime refusal codes.
 */
export type LiveLock = StreamDenyCode | "no_grant";

/** Full sentence for a locked tile. A missing grant reads the same as a refusal for one. */
export function liveLockMessageKey(lock: LiveLock): TranslationKey {
  return lock === "no_grant" ? "live_no_access" : streamDenyMessageKey(lock);
}

/** One-line label for a tile too small for the sentence (dense layouts, phones). */
const LIVE_LOCK_SHORT: Record<LiveLock, TranslationKey> = {
  no_grant: "live_no_access_short",
  camera_not_authorized: "live_no_access_short",
  camera_disabled: "live_denied_disabled_short",
  permission_check_failed: "live_denied_check_failed_short",
};

export function liveLockShortKey(lock: LiveLock): TranslationKey {
  return LIVE_LOCK_SHORT[lock];
}

/** Only a failed permission check can succeed on a second try. */
export function liveLockRetryable(lock: LiveLock): boolean {
  return lock !== "no_grant" && isRetryableDenial(lock);
}

/**
 * What a live tile's own overlays take (px): the name chip at the top and
 * the meta bar at the bottom (56 with touch-size 44 px buttons). A lock
 * message must stay in the band between them.
 */
export const LIVE_TILE_OVERLAYS = { top: 40, bottom: 56, sidePadding: 12 } as const;

/**
 * Band size the full lock message needs: icon (24) + gap + up to three lines
 * of text-xs (48), plus gap + a Retry button (44 on touch screens) when the
 * lock is retryable. The one-line label needs one line (16) and room for a
 * short phrase.
 */
export const LIVE_LOCK_MIN = {
  full: { width: 240, height: 80, heightWithRetry: 130 },
  compact: { width: 120, height: 16 },
} as const;

/**
 *   full    → icon + sentence (+ Retry for a failed permission check)
 *   compact → one line: small icon + short label
 *   icon    → the lock alone, centred on the tile (two columns on a phone
 *             leave no band between the overlays)
 */
export type LiveLockLayout = "full" | "compact" | "icon";

/**
 * How a locked tile says why, decided by the tile's measured size — not the
 * viewport — so a 3×3 / 4×4 layout on a desktop, two columns on a phone and
 * fullscreen all stay clear of the overlays. A focused tile always has room;
 * an unmeasured one starts as the bare icon (nothing spills under the
 * overlays before the first measurement). Only "full" offers Retry: tapping
 * a smaller tile focuses it, which shows the sentence and the button. The
 * full sentence is always there for screen readers.
 */
export function liveLockLayout(
  tile: { width: number; height: number } | null,
  opts: { focused: boolean; retry: boolean },
): LiveLockLayout {
  if (opts.focused) return "full";
  if (!tile) return "icon";
  const width = tile.width - 2 * LIVE_TILE_OVERLAYS.sidePadding;
  const height = tile.height - LIVE_TILE_OVERLAYS.top - LIVE_TILE_OVERLAYS.bottom;
  const full = LIVE_LOCK_MIN.full;
  if (width >= full.width && height >= (opts.retry ? full.heightWithRetry : full.height)) return "full";
  if (width >= LIVE_LOCK_MIN.compact.width && height >= LIVE_LOCK_MIN.compact.height) return "compact";
  return "icon";
}

/**
 * Per-camera live verdict for one operator — the role / grant half of the
 * gateway's rule.
 *   admin   → every camera
 *   viewer  → only cameras listed in `grantedCameraIds`
 *   other   → none (auditors are refused by the gateway before any grant check)
 * `grantedCameraIds === null` means the grant lookup failed: fail closed.
 * The gateway also refuses a disabled camera whatever the role; /grid and
 * /wall list enabled cameras only, and a page that lists disabled ones too
 * (/live) applies that half with liveAllowedForCamera().
 */
export function computeLiveAllowed(
  role: string,
  cameraIds: readonly string[],
  grantedCameraIds: Iterable<string> | null,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (role === "admin") {
    for (const id of cameraIds) out[id] = true;
    return out;
  }
  const granted = role === "viewer" && grantedCameraIds ? new Set(grantedCameraIds) : new Set<string>();
  for (const id of cameraIds) out[id] = granted.has(id);
  return out;
}

/**
 * The whole gateway rule for one camera: enabled AND the role / grant verdict.
 * With it `liveAllowed` means "the gateway would serve this operator".
 */
export function liveAllowedForCamera(
  camera: { id: string; enabled: boolean },
  verdict: Readonly<Record<string, boolean>>,
): boolean {
  return camera.enabled === true && verdict[camera.id] === true;
}

/**
 * Whether a non-admin page should say "no live access to any camera": some
 * camera is enabled and none of the enabled ones is watchable. Cameras that
 * are all disabled are not an access problem (the page's own hint covers
 * that), and a grant on a disabled camera does not make anything watchable.
 */
export function lacksAnyLiveAccess(
  cameras: ReadonlyArray<{ enabled: boolean; liveAllowed: boolean }>,
): boolean {
  const enabled = cameras.filter((c) => c.enabled);
  return enabled.length > 0 && enabled.every((c) => !c.liveAllowed);
}

/**
 * Server-side: read the caller's own camera_permissions rows with the
 * user-scoped client (RLS exposes only the caller's rows to a non-admin —
 * the same read the gateway makes) and turn them into per-camera verdicts.
 * Admins and auditors need no query. Any failure → not allowed, never a throw.
 */
export async function loadLiveAllowed(
  supabase: SupabaseClient<Database>,
  viewer: { userId: string; role: string },
  cameraIds: readonly string[],
): Promise<Record<string, boolean>> {
  if (viewer.role !== "viewer" || cameraIds.length === 0) {
    return computeLiveAllowed(viewer.role, cameraIds, null);
  }
  try {
    const { data, error } = await supabase
      .from("camera_permissions")
      .select("camera_id")
      .eq("user_id", viewer.userId);
    if (error) {
      log.warn("live access lookup failed", { code: error.code });
      return computeLiveAllowed(viewer.role, cameraIds, null);
    }
    return computeLiveAllowed(
      viewer.role,
      cameraIds,
      (data ?? []).map((r) => r.camera_id),
    );
  } catch (err) {
    log.warn("live access lookup failed", { error: err instanceof Error ? err.message : String(err) });
    return computeLiveAllowed(viewer.role, cameraIds, null);
  }
}

/**
 * Admin summary for /cameras: per camera, how many users a grant actually
 * lets watch live. Distinct users (a view + operate pair is one person) whose
 * role is viewer — admins watch every camera anyway and auditors are refused
 * before any grant is read. `roleByUser === null` (roles unreadable) counts
 * every distinct granted user rather than hiding the grants.
 */
export function summarizeLiveGrants(
  grants: ReadonlyArray<{ camera_id: string; user_id: string }>,
  roleByUser: ReadonlyMap<string, string> | null,
): Map<string, number> {
  const users = new Map<string, Set<string>>();
  for (const g of grants) {
    if (roleByUser && roleByUser.get(g.user_id) !== "viewer") continue;
    let set = users.get(g.camera_id);
    if (!set) users.set(g.camera_id, (set = new Set()));
    set.add(g.user_id);
  }
  const out = new Map<string, number>();
  for (const [cameraId, set] of users) out.set(cameraId, set.size);
  return out;
}

/**
 * Cameras with at least one camera_permissions row of any kind. That — not
 * the live count — is what private.user_can_see_camera() looks at: a single
 * row (an auditor's, an admin's) already hides the camera from every
 * operator not listed, even though it lets nobody watch live.
 */
export function restrictedCameraIds(
  grants: ReadonlyArray<{ camera_id: string }>,
): Set<string> {
  return new Set(grants.map((g) => g.camera_id));
}

/**
 * `state` lets the page pick the badge tone and icon: a read failure
 * ("unknown") must not look like a routine grant count, and a disabled camera
 * is refused to everyone — admins included — whatever the grants say.
 */
export type LiveAccessState = "disabled" | "unknown" | "admins_only" | "users";
export type LiveAccessSummary = { label: string; title: string; adminsOnly: boolean; state: LiveAccessState };

/**
 * Label + tooltip for one camera on /cameras. `count` is the live-grant count
 * (summarizeLiveGrants); `restricted` says whether the camera has any
 * camera_permissions row at all (restrictedCameraIds). `count === null` means
 * the grants could not be read — say so instead of claiming "admins only".
 * "Admins only" has two tooltips because the rows that grant no live video
 * still decide the list level: only with zero rows does the camera stay
 * visible to every operator. `enabled === false` wins over everything: the
 * gateway refuses a disabled camera to every role (liveAllowedForCamera).
 */
export function liveAccessSummary(
  count: number | null,
  restricted: boolean,
  t: (key: TranslationKey) => string,
  enabled = true,
): LiveAccessSummary {
  if (!enabled) {
    return { label: t("cam_live_disabled"), title: t("cam_live_disabled_tip"), adminsOnly: false, state: "disabled" };
  }
  if (count === null) {
    return { label: t("cam_live_unknown"), title: t("cam_live_unknown_tip"), adminsOnly: false, state: "unknown" };
  }
  if (count <= 0) {
    return {
      label: t("cam_live_admins_only"),
      title: t(restricted ? "cam_live_admins_only_restricted_tip" : "cam_live_admins_only_tip"),
      adminsOnly: true,
      state: "admins_only",
    };
  }
  const n = String(count);
  return {
    label: t("cam_live_users").replace("{n}", n),
    title: t("cam_live_users_tip").replace("{n}", n),
    adminsOnly: false,
    state: "users",
  };
}
