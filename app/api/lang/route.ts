import { NextResponse, type NextRequest } from "next/server";

const LANG_COOKIE = "mongolz-lang";
const VALID = new Set(["mn", "en", "kr"]);

export async function POST(request: NextRequest) {
  const { lang } = await request.json().catch(() => ({ lang: "mn" }));
  const value = VALID.has(lang) ? lang : "mn";

  const res = NextResponse.json({ ok: true, lang: value });
  res.cookies.set(LANG_COOKIE, value, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
