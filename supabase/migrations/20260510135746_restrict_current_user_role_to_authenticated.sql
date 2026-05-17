
-- anon-аас авах — нэвтрээгүй хэрэглэгч role шалгах хэрэггүй.
-- authenticated үлдээх — RLS policy-уудаас дуудна.
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, public;

-- public.is_admin() болон current_user_role() нь SECURITY DEFINER хэвээр байна
-- (RLS policies-аас дуудах үед профайл унших шаардлагатай тул).
-- Анхааруулга: signed-in user өөрийн role-ыг олж мэдэх боломжтой — энэ нь
-- design-аар зөвшөөрсөн (хэрэглэгч өөрийн profile row-г хүртэл хардаг).

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
;
