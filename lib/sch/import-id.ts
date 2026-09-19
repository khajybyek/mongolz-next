/**
 * SCH Esports — deterministic submission ids for imported sheet rows.
 *
 * Server-only (node:crypto). A web registration gets a random submission id;
 * an imported Google-Form response gets one derived from who answered and
 * when, so uploading the same (or a grown) sheet again maps every response
 * to the SAME id and the (submission_id, game) unique index — next to
 * (game, lower(email)) — keeps the import idempotent.
 */
import { createHash } from "node:crypto";

/**
 * UUID-v4-shaped id: sha256("sch-import|" + lower(email) + "|" + submittedAt)
 * with the version / variant bits set. The row number only takes part when
 * both the e-mail and the timestamp are missing, so that such rows do not
 * all collapse into one id.
 */
export function importSubmissionId(email: string, submittedAt: string | null, row: number): string {
  const who = email.trim().toLowerCase();
  const when = submittedAt ?? "";
  const seed = `sch-import|${who}|${when}${!who && !when ? `|row:${row}` : ""}`;
  const bytes = createHash("sha256").update(seed, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
