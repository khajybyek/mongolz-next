
-- RLS-д хэрэглэгддэг функцуудад хэрэглэгчийн EXECUTE эрх олгох
-- Эдгээрийг is_admin() RLS policy-уудаас дуудна → анх authenticated user-д
-- EXECUTE эрх байх ёстой.
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;
;
