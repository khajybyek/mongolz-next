/**
 * pgvector values for the typed Supabase clients.
 *
 * `supabase gen types` has no notion of pgvector, so `vector(512)` columns
 * (faces.embedding, suspects.embedding) and RPC arguments (match_faces,
 * match_suspects) are typed as `string`. At the wire level PostgREST has
 * always accepted the JSON number array and cast it to `vector` server-side —
 * every production search/insert works that way today — so we keep sending
 * the array unchanged and only reconcile the type here, in one place, instead
 * of scattering `as never` / `as unknown as string` casts across call sites.
 */
export function vectorParam(embedding: readonly number[]): string {
  return embedding as unknown as string;
}
