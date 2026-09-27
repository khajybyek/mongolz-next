/**
 * Content-Security-Policy for every response that passes through `proxy.ts`.
 *
 * Strict, nonce-based: no 'unsafe-inline' / 'unsafe-eval' for scripts in
 * production. 'strict-dynamic' lets a nonce-approved script load its chunks;
 * 'wasm-unsafe-eval' is what ONNX Runtime Web needs (WASM has its own sandbox).
 *
 * `style-src 'unsafe-inline'` stays on purpose: React inline `style={{…}}`
 * attributes and libraries that inject <style> at runtime (Recharts, hls.js
 * UI) cannot carry a nonce. CSS injection cannot run script under this policy.
 */

/**
 * Pages that render a camera the operator typed in by hand. A phone / IP
 * webcam on the LAN speaks plain HTTP (MJPEG or MP4), so only here may
 * `img-src` / `media-src` load `http:`. These channels carry pixels, never a
 * session token (`connect-src` is HTTPS-only everywhere). Every other page —
 * the public landing, /login — gets no scheme wildcard at all.
 */
const INSECURE_MEDIA_PREFIXES = ["/live"] as const;

export function allowsInsecureMedia(pathname: string): boolean {
  return INSECURE_MEDIA_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export type CspOptions = { isDev: boolean; insecureMedia: boolean };

export function buildCsp(nonce: string, { isDev, insecureMedia }: CspOptions): string {
  // Dev: Next.js Fast Refresh evaluates code → 'unsafe-eval' is required there.
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' 'wasm-unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`;
  const lan = insecureMedia ? " http:" : "";

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `worker-src 'self' blob:`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:${lan} https://*.supabase.co https://*.supabase.in`,
    `media-src 'self' data: blob:${lan} https://*.supabase.co https://*.supabase.in https://*.up.railway.app`,
    `font-src 'self' data:`,
    `connect-src 'self' https://*.supabase.co https://*.supabase.in https://*.up.railway.app wss://*.supabase.co`,
    `manifest-src 'self'`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `report-uri /api/csp-report`,
    `report-to csp-endpoint`,
  ].join("; ");
}
