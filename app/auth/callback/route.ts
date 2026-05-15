import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * `next` query parameter-ийг safety шалгана.
 * - Заавал same-origin path байх ёстой (begin with /)
 * - Protocol-relative (//external.com), absolute URL, эсвэл backslash зөвшөөрөхгүй
 * - Хэрэв буруу бол default /dashboard руу буцна (open redirect халдлагаас сэргийлнэ)
 */
function sanitizeNextPath(raw: string | null): string {
  if (!raw) return "/dashboard";
  // Хатуу шалгуур: эхэнд / байх + // эсвэл /\ биш
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/dashboard";
  }
  // URL-encoded protocol зайлуулна (e.g. %2F%2Fevil.com)
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("//") || decoded.includes("://")) {
      return "/dashboard";
    }
  } catch {
    return "/dashboard";
  }
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
}
