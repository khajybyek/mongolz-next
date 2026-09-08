/**
 * App-facing database types.
 *
 * Everything here is DERIVED from `lib/database.generated.ts` (regenerate with
 * `npm run gen:types` after every migration). The Supabase clients in
 * `lib/supabase/*.ts` are instantiated with `Database`, so `.from()` /
 * `.rpc()` results are typed against the live schema and column drift is a
 * compile error instead of a runtime 400 (this is how the phantom
 * `faces.reviewed` column and the private-schema `user_can_see_camera` RPC
 * were caught).
 *
 * Hand-written narrowing is limited to what the generator cannot express:
 * CHECK-constrained text columns and pgvector (see `lib/pgvector.ts`).
 */
import type {
  Database,
  Enums,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "./database.generated";

export type { Database, Enums, Json, Tables, TablesInsert, TablesUpdate };

// ── Postgres enums ────────────────────────────────────────────────────
export type UserRole = Enums<"user_role">;
export type SuspectPrivacyTier = Enums<"suspect_privacy_tier">;
export type RevealMethod = Enums<"reveal_method">;
export type RevealStatus = Enums<"reveal_status">;
export type AlertLabel = Enums<"alert_label">;
/**
 * alerts.state — CHECK-constrained text (not a Postgres enum). Workflow
 * state, independent of the TP/FP `label`: new → acknowledged → closed,
 * with reopen back to new. Transition rules live in `lib/alerts.ts`.
 */
export type AlertState = "new" | "acknowledged" | "closed";

// ── CHECK-constrained text columns (not Postgres enums) ───────────────
/** cameras.cam_type — `demo` is a synthetic source built into the ML service (url `demo://<name>`). */
export type CameraType = "rtsp" | "http" | "usb" | "webcam" | "demo";
/**
 * recordings.blur_strategy — how the blurred playback view is produced.
 *   • baked     — a separate plaintext blurred MP4 was written at recording
 *                 time and lives at `storage_path` (legacy).
 *   • on_demand — no blurred MP4 is persisted; the view is derived from the
 *                 encrypted original at request time by the ML
 *                 `/recording/{id}/view` endpoint (ADR 0010).
 */
export type BlurStrategy = "baked" | "on_demand";
/** faces.review_label — verdict recorded on /review. */
export type ReviewLabel = "confirmed" | "rejected" | "uncertain";
/** webhooks.kind */
export type WebhookKind = "slack" | "discord" | "generic";

// ── Rows ──────────────────────────────────────────────────────────────
export type Profile = Tables<"profiles">;

/**
 * Columns the auth helpers select for every request. Kept as a const tuple so
 * `PublicProfile` and the select string cannot drift apart; `totp_secret` and
 * `totp_recovery_codes` are deliberately never loaded into request context.
 */
export const PUBLIC_PROFILE_COLUMNS = [
  "id",
  "email",
  "full_name",
  "role",
  "totp_enabled",
  "is_super_admin",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof Profile)[];

export type PublicProfile = Pick<Profile, (typeof PUBLIC_PROFILE_COLUMNS)[number]>;

export type Camera = Omit<Tables<"cameras">, "cam_type"> & { cam_type: CameraType };
export type Suspect = Tables<"suspects">;
export type Face = Tables<"faces">;
export type Alert = Tables<"alerts">;
export type Recording = Omit<Tables<"recordings">, "blur_strategy"> & {
  blur_strategy: BlurStrategy;
};
export type AuditLog = Tables<"audit_log">;
export type RevealJob = Tables<"reveal_jobs">;
export type Webhook = Omit<Tables<"webhooks">, "kind"> & { kind: WebhookKind };

// ── RPC results ───────────────────────────────────────────────────────
type Fn<N extends keyof Database["public"]["Functions"]> =
  Database["public"]["Functions"][N]["Returns"];

export type MatchSuspectResult = Fn<"match_suspects">[number];
export type MatchFaceResult = Fn<"match_faces">[number];

/** Relative frame coordinates (0–1 ratios) stored in faces.bbox. */
export type FaceBbox = { x: number; y: number; w: number; h: number };

/**
 * faces_in_recording() row. `chain_index` is NULL for faces detected before
 * the hash-chain rollout (ADR 0009) — the generator marks RETURNS TABLE
 * columns non-null, so it is widened here.
 */
export type FaceInRecording = Omit<Fn<"faces_in_recording">[number], "chain_index" | "bbox"> & {
  chain_index: number | null;
  bbox: FaceBbox | null;
};

/**
 * camera_health().status — LIVENESS: is this camera sending frames?
 *
 * Computed from `camera_sessions.last_heartbeat_at`, which the ML capture loop
 * stamps every ~30 s while frames are arriving: `healthy` < 90 s, `stale` <
 * 10 min, `offline` when a camera we are supposed to be capturing stopped
 * delivering, `unknown` when nothing is capturing it (or it has not reported
 * yet). It used to be derived from the newest face detection, which meant a
 * working camera in front of an empty corridor reported an outage after 30
 * quiet minutes — and a camera whose feed died still read healthy for five.
 *
 * The generator types these computed columns as plain `string`.
 */
export type CameraLivenessStatus = "healthy" | "stale" | "offline" | "unknown";

/**
 * camera_health().detection_status — ACTIVITY: has it seen anyone lately?
 * `none` (never), `active` (< 5 min), `recent` (< 30 min), `idle` (older).
 * This is the question `status` used to answer by mistake.
 */
export type CameraDetectionStatus = "none" | "active" | "recent" | "idle";
