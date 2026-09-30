/**
 * Per-camera recording mode (`cameras.recording_mode`, ADR 0013) and what it
 * means for a recording row.
 *
 *   • standard       — the default and today's behaviour: the whole original
 *                      is stored encrypted (`*_original.mp4.enc`, ADR 0002)
 *                      and the masked view is rendered on demand (ADR 0010).
 *   • face_encrypted — opt-in: NO raw original is stored. The stored video is
 *                      already masked (each face replaced by a keyed cipher
 *                      pattern) and encrypted at rest; every face region is
 *                      sealed separately in a per-segment face envelope under
 *                      its per-face hash-chain key (ADR 0009). An approved
 *                      reveal decrypts only the selected person's blobs.
 *
 * Direction matters like it does for privacy schedules (ADR 0012):
 * standard → face_encrypted stores LESS (no raw original) = tightening = one
 * click; face_encrypted → standard stores raw originals again = loosening =
 * TOTP step-up + a notice to the other admins. Pure — shared by the server
 * action, the pages and the tests.
 */

export const RECORDING_MODES = ["standard", "face_encrypted"] as const;
export type RecordingMode = (typeof RECORDING_MODES)[number];

export function isRecordingMode(value: unknown): value is RecordingMode {
  return typeof value === "string" && (RECORDING_MODES as readonly string[]).includes(value);
}

export type RecordingModeDirection = "tighten" | "loosen" | "noop";

/** Which way a change moves protection. face_encrypted is the stricter mode. */
export function classifyRecordingModeChange(from: RecordingMode, to: RecordingMode): RecordingModeDirection {
  if (from === to) return "noop";
  return to === "face_encrypted" ? "tighten" : "loosen";
}

/**
 * The stored value a change is judged from. A value the CHECK would not allow
 * (or a row read before the migration) is treated as the OPPOSITE of the
 * target, so a switch to `standard` is still loosening — never a one-click
 * way around the step-up — and a switch to `face_encrypted` is still written.
 */
export function storedRecordingMode(
  stored: unknown,
  target: RecordingMode,
): { mode: RecordingMode; known: boolean } {
  if (isRecordingMode(stored)) return { mode: stored, known: true };
  return { mode: target === "standard" ? "face_encrypted" : "standard", known: false };
}

/**
 * The mode to SHOW for a camera row: the stored setting, and the default
 * (`standard`) for a value the web does not know. This is the setting, not
 * how the next segment is guaranteed to be stored: while the ML service has
 * never managed to READ a camera's mode (right after an ML restart with the
 * database slow or unreachable) it records that camera face_encrypted — the
 * stricter mode — until a read succeeds; `recordings.blur_strategy` records
 * how each segment was actually stored.
 */
export function displayRecordingMode(stored: unknown): RecordingMode {
  return isRecordingMode(stored) ? stored : "standard";
}

/** recordings.blur_strategy of a segment captured in face-encrypted mode. */
export const FACE_ENCRYPTED_STRATEGY = "face_encrypted";

type RecordingArtifacts = {
  has_original?: boolean | null;
  blur_strategy?: string | null;
  face_envelope_path?: string | null;
};

export function isFaceEncryptedRecording(rec: { blur_strategy?: string | null }): boolean {
  return rec.blur_strategy === FACE_ENCRYPTED_STRATEGY;
}

/**
 * The ML `/recording/{id}/view` endpoint can stream this recording: an
 * encrypted original to render from (standard / legacy), or — face-encrypted —
 * the encrypted masked video itself (no re-render, no detector).
 */
export function recordingViewable(rec: RecordingArtifacts): boolean {
  return rec.has_original === true || isFaceEncryptedRecording(rec);
}

/**
 * A reveal job has something to restore from: the encrypted raw original, or —
 * face-encrypted — the sealed face envelope. The ML service sets
 * `has_original = true` on a delivered face-encrypted row ("a restorable
 * encrypted source exists"), so for those rows the envelope path decides:
 * without it there is nothing a reveal could unseal, whatever `has_original`
 * says.
 */
export function recordingRevealable(rec: RecordingArtifacts): boolean {
  if (isFaceEncryptedRecording(rec)) {
    return typeof rec.face_envelope_path === "string" && rec.face_envelope_path.length > 0;
  }
  return rec.has_original === true;
}

/**
 * Every object a recordings row owns in the `recordings` bucket: the playback
 * artifact, the encrypted original and the face envelope. Nulls and
 * duplicates dropped (on_demand rows point storage_path and original_path at
 * the same object).
 */
export function recordingObjectPaths(rec: {
  storage_path?: unknown;
  original_path?: unknown;
  face_envelope_path?: unknown;
}): string[] {
  const out: string[] = [];
  for (const value of [rec.storage_path, rec.original_path, rec.face_envelope_path]) {
    if (typeof value === "string" && value.length > 0 && !out.includes(value)) out.push(value);
  }
  return out;
}
