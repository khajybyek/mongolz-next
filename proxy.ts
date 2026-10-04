import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { allowsInsecureMedia, buildCsp } from "@/lib/csp";
import { buildTestSiteCsp, isTestSiteHost, isTestSitePath, testSiteRewriteTarget } from "@/lib/test-site";

// Next.js 16: "middleware" file-convention deprecated → "proxy" болсон.
// Зөвхөн нэр өөрчлөгдсөн, ажиллагаа хэвээр (auth session refresh + cookie sync).

/**
 * Per-request nonce generate хийнэ — base64 урт ~22 char.
 * CSP `script-src 'self' 'nonce-XXX'`-д ашиглахад зориулагдсан.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Reporting API endpoints. Current Chromium reads `Reporting-Endpoints`
 * (relative URLs allowed); the legacy `Report-To` header needs an ABSOLUTE
 * URL, built per request because aicctv.dev and mongolz.dev share one
 * deployment. `report-uri` inside the CSP keeps Firefox / Safari reporting.
 */
const REPORTING_ENDPOINTS_HEADER = 'csp-endpoint="/api/csp-report"';

function reportToHeader(origin: string): string {
  return JSON.stringify({
    group: "csp-endpoint",
    max_age: 10886400,
    endpoints: [{ url: `${origin}/api/csp-report` }],
  });
}

/**
 * mongolz.dev/test is a static page in `public/test/` (lib/test-site.ts).
 * It is answered here before any session work: no Supabase call, no login
 * redirect, no role redirect — and its own hash-pinned CSP instead of the
 * console's nonce policy, which a static file cannot carry. Every other host
 * (aicctv.dev) gets a plain 404, so the page does not exist there.
 */
function testSiteResponse(request: NextRequest, isDev: boolean): NextResponse {
  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host"), request.nextUrl.host];
  if (!isTestSiteHost(hosts, isDev)) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const target = testSiteRewriteTarget(request.nextUrl.pathname);
  const res = target ? NextResponse.rewrite(new URL(target, request.url)) : NextResponse.next();
  res.headers.set("Content-Security-Policy", buildTestSiteCsp());
  res.headers.set("Report-To", reportToHeader(request.nextUrl.origin));
  res.headers.set("Reporting-Endpoints", REPORTING_ENDPOINTS_HEADER);
  if (!isDev) {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export async function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";
  if (isTestSitePath(request.nextUrl.pathname)) return testSiteResponse(request, isDev);

  const nonce = generateNonce();
  // `http:` images/video only where a hand-typed LAN webcam is rendered.
  const csp = buildCsp(nonce, { isDev, insecureMedia: allowsInsecureMedia(request.nextUrl.pathname) });

  // Auth/session логик
  const baseRes = await updateSession(request);

  // Nonce + CSP-ийг response-д тавина (хэрэв updateSession redirect хийсэн ч)
  const isRedirect = baseRes.status >= 300 && baseRes.status < 400;
  // `NextResponse.rewrite()` нь 200 буцаадаг ч `x-middleware-rewrite`
  // header-ээр rewrite гэдгийг тэмдэглэдэг. Энэ тохиолдолд `next()`-ээр
  // дарж бичих ёсгүй — wall host subdomain rewrite-ийг алдагдуулна.
  const isRewrite = baseRes.headers.has("x-middleware-rewrite");
  // A terminal answer from updateSession (401 JSON for an unauthenticated
  // /api/* call) must reach the client as is — replacing it with next()
  // would run the handler anyway.
  const isTerminal = baseRes.status >= 400;
  if (isRedirect || isRewrite || isTerminal) {
    baseRes.headers.set("Content-Security-Policy", csp);
    baseRes.headers.set("Report-To", reportToHeader(request.nextUrl.origin));
    baseRes.headers.set("Reporting-Endpoints", REPORTING_ENDPOINTS_HEADER);
    if (!isDev) {
      baseRes.headers.set(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains; preload",
      );
    }
    baseRes.headers.set("X-Content-Type-Options", "nosniff");
    baseRes.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return baseRes;
  }

  // Layout, page-уудад nonce-ийг x-nonce header-аар дамжуулна
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  // updateSession-аас ирсэн cookies-ыг хадгална
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Cookies copy (updateSession-аас)
  for (const c of baseRes.cookies.getAll()) {
    response.cookies.set(c);
  }

  // CSP + reporting headers
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Report-To", reportToHeader(request.nextUrl.origin));
  response.headers.set("Reporting-Endpoints", REPORTING_ENDPOINTS_HEADER);

  // Defense-in-depth security headers (only in production — dev-д HSTS preload
  // нь localhost-д тасалдал үүсгэдэг).
  if (!isDev) {
    // HSTS: forces HTTPS for 2 years incl. subdomains; preload-eligible.
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
  // Header-уудыг redirect path-д бас бичиж өгье (баатрууд proxy дайран явсаар
  // буцах URL-уудад ч HSTS байгаасай).
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy",
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
  return response;
}

export const config = {
  matcher: [
    /*
     * Бүх route-уудад ажиллана except:
     *  - _next/static
     *  - _next/image
     *  - favicon.ico
     *  - public файлууд
     */
    "/((?!_next/static|_next/image|favicon.ico|monitoring|models/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|onnx|wasm|mjs)$).*)",
    // The static page's images are .webp — still gated by host (lib/test-site.ts).
    "/test/:path*",
  ],
};
