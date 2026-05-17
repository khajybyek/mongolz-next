
-- RLS policy-ууд is_admin()-ыг дуудна. Anon хэрэглэгч хүснэгт уншихыг
-- оролдвол is_admin() бас гүйцэтгэгдэнэ. Permission denied болохоос
-- сэргийлж anon-руу EXECUTE олгоно. Anon-ийн auth.uid() = NULL
-- учраас is_admin() FALSE буцаах тул хандалт өргөтгөгдөхгүй.
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon;
;
