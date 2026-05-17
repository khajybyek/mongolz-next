
-- Anon-руу хэрэгцээгүй ил гарсан функцуудыг хязгаарлана
REVOKE EXECUTE ON FUNCTION public.faces_in_recording(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_faces(vector, double precision, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_suspects(vector, double precision, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.verify_audit_chain() FROM anon;
;
