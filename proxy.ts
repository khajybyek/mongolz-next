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

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    // Workers — ONNX Runtime Web blob: workers ашигладаг
    `worker-src 'self' blob:`,
    // Style — Tailwind inject inline styles, 'unsafe-inline' хэрэгтэй (CSS XSS бараг боломжгүй)
    `style-src 'self' 'unsafe-inline'`,
    // IP webcam / гар утасны MJPEG нь HTTP (https биш) учир http: бас оруулна
    `img-src 'self' data: blob: http: https://*.supabase.co https://*.supabase.in`,
    `media-src 'self' data: blob: http: https://*.supabase.co https://*.supabase.in https://*.up.railway.app`,
    `font-src 'self' data:`,
    // connect-src бас HTTP zalгаж IP webcam (192.168.x.x:8080) дэмжих
    `connect-src 'self' http: https://*.supabase.co https://*.supabase.in https://*.up.railway.app wss://*.supabase.co`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    // upgrade-insecure-requests хасав — HTTP IP webcam-уудыг автоматаар HTTPS-руу
    // upgrade хийгээд тасрах вэ гэдгийг сэргийлнэ. Бусад asset-уудыг HTTPS-аар
    // өөрсдөө явуулна.
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const isDev = process.env.NODE_ENV !== "production";

  // Auth/session логик
  const baseRes = await updateSession(request);

  // Nonce + CSP-ийг response-д тавина (хэрэв updateSession redirect хийсэн ч)
  const isRedirect = baseRes.status >= 300 && baseRes.status < 400;
  if (isRedirect) {
    baseRes.headers.set("Content-Security-Policy", buildCsp(nonce, isDev));
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

  // CSP header
  response.headers.set("Content-Security-Policy", buildCsp(nonce, isDev));
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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
