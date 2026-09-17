import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.generated";
import { flag } from "@/lib/flags";

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/_next",
  "/favicon.ico",
  "/icon",
  "/apple-icon",
  "/opengraph-image", // Next.js og-image convention — Slack/Twitter crawlers
  "/twitter-image", // Next.js twitter-image convention
  "/logo.png",
  "/.well-known/", // RFC 8615 reserved (security.txt, etc.)
  "/api/lang", // Login page-аас хэл сольж болохын тулд unauth-аар хүртээмжтэй
  "/monitoring", // Sentry tunnel route — anonymous beacons, no auth required
  "/manifest.webmanifest", // PWA manifest — installable without login
  "/sw.js", // PWA service worker — must load before any auth check
  "/offline.html", // PWA offline fallback page
  "/api/csp-report", // CSP report-uri — browser beacons, no auth
  "/api/uptime", // External uptime monitors hit this without auth
  "/api/slo-status", // Public SLO probe — see docs/SLO.md
  "/api/cron", // Vercel Cron endpoints (their own bearer auth)
  "/api/monitoring", // Cron-style monitoring endpoints
  "/api/auth/passkey/login", // Public passkey login endpoints
  "/api/push/dispatch", // Server-to-server push dispatch (bearer-auth)
  "/api/vitals", // Authenticated beacon — handler does its own auth via cookies
];

const PUBLIC_EXACT = new Set([
  "/", // Public capstone landing page (home)
  "/robots.txt", // SEO crawler hint — must be reachable unauthenticated
  "/sitemap.xml", // SEO sitemap — must be reachable unauthenticated
  "/sch", // SCH Esports public registration (Chuseok 2026)
  "/sch/teams", // Published team rosters — public, names + in-game ids only
]);

type CookieItem = { name: string; value: string; options?: CookieOptions };

// Hosts that should be locked to /wall — the kiosk subdomain rewrites any
// request to the wall view so a control-room display can be pointed at it
// without any chrome ever leaking through. The default is empty; set
// WALL_HOSTS to a comma-separated list to opt a subdomain in.
const WALL_HOSTS = new Set(
  (process.env.WALL_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

function wallHostCandidates(request: NextRequest): string[] {
  const fwd = request.headers.get("x-forwarded-host");
  const host = request.headers.get("host");
  return [fwd, host, request.nextUrl.host]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toLowerCase().split(",")[0]!.trim());
}

function isWallHost(request: NextRequest): boolean {
  if (!flag("wall_subdomain")) return false;
  // Vercel sometimes preserves the deployment URL in `host` and exposes
  // the user-facing alias only via `x-forwarded-host`. Check both, plus
  // the parsed nextUrl host as a last resort, before deciding. Match by
  // exact membership AND by suffix to tolerate Vercel preview aliases.
  const candidates = wallHostCandidates(request);
  return candidates.some(
    (c) => WALL_HOSTS.has(c) || [...WALL_HOSTS].some((h) => c === h || c.startsWith(h + ":")),
  );
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Subdomain rewrite — `live.mongolz.dev` is the always-on control-room
  // monitor. Force every authed request on that host onto /wall, even if
  // the user manually typed a different path. Login / static assets must
  // still pass through so the user can sign in on the subdomain.
  const path = request.nextUrl.pathname;
  if (isWallHost(request)) {
    const allowPassthrough =
      path === "/login" ||
      path.startsWith("/auth/") ||
      path.startsWith("/api/") ||
      path.startsWith("/_next") ||
      path === "/favicon.ico" ||
      path.startsWith("/icon") ||
      path.startsWith("/apple-icon") ||
      path === "/manifest.webmanifest" ||
      path === "/sw.js" ||
      path === "/offline.html";
    if (!allowPassthrough && !path.startsWith("/wall")) {
      const url = request.nextUrl.clone();
      url.pathname = "/wall";
      url.search = "";
      return NextResponse.rewrite(url);
    }
  }

  const supabase = createServerClient<Database>(
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

  const isPublic =
    PUBLIC_EXACT.has(path) || PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // The auth helpers preserve sessions during verification/config failures.
  // Let their public error page render instead of bouncing back to the same
  // protected page and creating an endless redirect loop.
  // Login errors that leave the session intact must render, or the bounce to
  // /dashboard sends the user straight back into the same failure — for
  // `no_profile` that is an endless /login <-> /dashboard loop, and a
  // transient profile read or a half-finished erasure is enough to cause it.
  // `session_pin` is deliberately NOT here: that path revokes the session
  // globally first, so a surviving session means the pin check passed.
  const TERMINAL_LOGIN_ERRORS = new Set(["server_config", "no_profile"]);
  if (
    user &&
    path === "/login" &&
    !TERMINAL_LOGIN_ERRORS.has(request.nextUrl.searchParams.get("error") ?? "")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Role-based gating + admin TOTP enforcement.
  //
  // 1. Admin без TOTP   → /settings?force_totp=1
  // 2. Auditor — зөвхөн /audit + /api/audit/* + /auth/logout + /settings (own data export)
  //    Бусад руу ороход /audit руу redirect.
  //
  // Triggers only on top-level page navigations — API/asset requests skip the
  // profile lookup to keep middleware fast.
  if (user && !isPublic) {
    const EXEMPT_PREFIXES = [
      "/api/",          // all API routes — auth helpers handle their own checks
      "/auth/",         // auth callback / logout
      "/_next",
      "/monitoring",
    ];
    const isApiOrAsset = EXEMPT_PREFIXES.some(
      (p) => path === p || path.startsWith(p)
    );

    // On the wall subdomain every request has already been rewritten to
    // /wall (which is a one-purpose kiosk view). Skip the role-redirect
    // logic that would otherwise bounce admin-without-TOTP → /settings or
    // auditor → /audit and trap the user in a rewrite loop.
    if (!isApiOrAsset && !isWallHost(request)) {
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("role, totp_enabled")
          .eq("id", user.id)
          .single();

        // Admin TOTP enforcement
        if (prof?.role === "admin" && !prof.totp_enabled && path !== "/settings") {
          const url = request.nextUrl.clone();
          url.pathname = "/settings";
          url.search = "?force_totp=1";
          return NextResponse.redirect(url);
        }

        // Auditor allow-list: zövhön /audit + /audit/*. Бусад page-ийг /audit руу redirect.
        if (prof?.role === "auditor") {
          const allowed = path === "/audit" || path.startsWith("/audit/");
          if (!allowed) {
            const url = request.nextUrl.clone();
            url.pathname = "/audit";
            url.search = "";
            return NextResponse.redirect(url);
          }
        }
      } catch {
        // Defense-in-depth — never block legitimate requests on a profile read failure.
      }
    }
  }

  return response;
}
