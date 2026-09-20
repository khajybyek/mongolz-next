import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

/**
 * Production-grade security headers.
 *
 * OWASP recommendations:
 *  • X-Frame-Options DENY        — clickjacking protection
 *  • X-Content-Type-Options       — MIME sniffing protection
 *  • Referrer-Policy              — referrer leak protection
 *  • Permissions-Policy           — disable unused powerful APIs
 *  • Strict-Transport-Security    — HTTPS enforcement (HSTS)
 *  • Cross-Origin-Opener-Policy   — no other origin keeps a window handle (XS-Leaks)
 *  • Cross-Origin-Resource-Policy — our responses cannot be embedded by other sites
 *    (Cross-Origin-Embedder-Policy is deliberately NOT set: `require-corp`
 *    would block the signed Supabase Storage images/video the console shows.)
 *
 * Анхаар: Content-Security-Policy нь `proxy.ts` дотор per-request nonce-той
 * dynamic-аар үүсгэгддэг (unsafe-inline/unsafe-eval гүйгээр).
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const config: NextConfig = {
  // Next.js 16: typedRoutes нь stable болсон тул experimental-аас гарсан
  typedRoutes: true,
  // Strip the `X-Powered-By: Next.js` header — framework fingerprinting
  // makes targeted CVE lookups easier for attackers.
  poweredByHeader: false,
  // Multiple lockfile warning-аас сэргийлэх — workspace root-ыг тодотгоно
  turbopack: {
    root: __dirname,
  },
  // The web server does not ship the Python/edge runtimes or local build
  // caches. Include .nosync paths used by this checkout's iCloud-safe links.
  outputFileTracingExcludes: {
    "**/*": ["./ml-service/**", "./edge-agent/**", "./.next.nosync/cache/**", "./.next.nosync/dev/**"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
  },
  async headers() {
    return [
      {
        // Бүх route-д хамаарна
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(config, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
