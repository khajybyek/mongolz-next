import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/_next",
  "/favicon.ico",
  "/icon",
  "/apple-icon",
  "/api/lang", // Login page-аас хэл сольж болохын тулд unauth-аар хүртээмжтэй
  "/monitoring", // Sentry tunnel route — anonymous beacons, no auth required
  "/manifest.webmanifest", // PWA manifest — installable without login
  "/api/csp-report", // CSP report-uri — browser beacons, no auth
  "/api/uptime", // External uptime monitors hit this without auth
];

type CookieItem = { name: string; value: string; options?: CookieOptions };

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(items: CookieItem[]) {
          for (const { name, value } of items) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of items) response.cookies.set(name, value, options);
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Admin TOTP enforcement: if signed-in admin has no TOTP, force them onto
  // /settings until they complete setup. Viewers are unaffected.
  //
  // Only triggers on top-level page navigations — API/asset requests skip the
  // profile lookup to keep middleware fast.
  if (user && !isPublic) {
    const TOTP_EXEMPT_PREFIXES = [
      "/settings",
      "/api/",          // all API routes — auth helpers handle their own checks
      "/auth/",         // auth callback / logout
      "/_next",
      "/monitoring",
    ];
    const isExempt = TOTP_EXEMPT_PREFIXES.some(
      (p) => path === p || path.startsWith(p)
    );

    if (!isExempt) {
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("role, totp_enabled")
          .eq("id", user.id)
          .single();

        if (prof?.role === "admin" && !prof.totp_enabled) {
          const url = request.nextUrl.clone();
          url.pathname = "/settings";
          url.search = "?force_totp=1";
          return NextResponse.redirect(url);
        }
      } catch {
        // Defense-in-depth — never block legitimate requests on a profile read failure.
      }
    }
  }

  return response;
}
