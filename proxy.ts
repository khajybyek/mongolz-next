import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

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
 * Strict CSP — nonce-based, 'unsafe-inline' / 'unsafe-eval' гүйгээр.
 * Production-д script бүр nonce-той байх ёстой → Next.js inline scripts
 * автоматаар nonce ашиглана (layout-аас headers().get('x-nonce') авч).
 */
function buildCsp(nonce: string, isDev: boolean): string {
  // Dev mode-д Next.js Fast Refresh нь eval ашигладаг → 'unsafe-eval' хэрэгтэй.
  // Production-д 'strict-dynamic' ашиглавал nonce-аас зөвшөөрөгдсөн скриптүүд
  // дараа нь динамик script-уудыг ачаалах боломжтой (web manifest)
  // 'wasm-unsafe-eval' нь ONNX Runtime Web (edge-detect page)-д WASM ажиллуулахад шаардлагатай.
  // WASM нь өөрийн sandbox-той тул eval-аас аюулгүй.
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' 'wasm-unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`;

  // SSRF / data-exfiltration hardening:
  //   - `connect-src` HTTPS-only (token leak хаах).
  //   - `img-src` / `media-src` http: үлдээв — гарын IP webcam (MJPEG / MP4 stream)
  //     нь тухайн LAN-д HTTP-ээр ажилладаг бөгөөд эдгээр channel-ууд session token
  //     дамжуулдаггүй (одоор үзэгдэх media data л).
  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `worker-src 'self' blob:`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: http: https://*.supabase.co https://*.supabase.in`,
    `media-src 'self' data: blob: http: https://*.supabase.co https://*.supabase.in https://*.up.railway.app`,
    `font-src 'self' data:`,
    `connect-src 'self' https://*.supabase.co https://*.supabase.in https://*.up.railway.app wss://*.supabase.co`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `report-uri /api/csp-report`,
    `report-to csp-endpoint`,
  ].join("; ");
}

const REPORT_TO_HEADER = JSON.stringify({
  group: "csp-endpoint",
  max_age: 10886400,
  endpoints: [{ url: "/api/csp-report" }],
});

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const isDev = process.env.NODE_ENV !== "production";

  // Auth/session логик
  const baseRes = await updateSession(request);

  // Nonce + CSP-ийг response-д тавина (хэрэв updateSession redirect хийсэн ч)
  const isRedirect = baseRes.status >= 300 && baseRes.status < 400;
  // `NextResponse.rewrite()` нь 200 буцаадаг ч `x-middleware-rewrite`
  // header-ээр rewrite гэдгийг тэмдэглэдэг. Энэ тохиолдолд `next()`-ээр
  // дарж бичих ёсгүй — wall host subdomain rewrite-ийг алдагдуулна.
  const isRewrite = baseRes.headers.has("x-middleware-rewrite");
  if (isRedirect || isRewrite) {
    baseRes.headers.set("Content-Security-Policy", buildCsp(nonce, isDev));
    baseRes.headers.set("Report-To", REPORT_TO_HEADER);
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
  response.headers.set("Content-Security-Policy", buildCsp(nonce, isDev));
  response.headers.set("Report-To", REPORT_TO_HEADER);

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
  ],
};
