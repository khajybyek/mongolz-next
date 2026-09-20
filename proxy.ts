import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { allowsInsecureMedia, buildCsp } from "@/lib/csp";

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

const REPORT_TO_HEADER = JSON.stringify({
  group: "csp-endpoint",
  max_age: 10886400,
  endpoints: [{ url: "/api/csp-report" }],
});

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const isDev = process.env.NODE_ENV !== "production";
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
  if (isRedirect || isRewrite) {
    baseRes.headers.set("Content-Security-Policy", csp);
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
  response.headers.set("Content-Security-Policy", csp);
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
