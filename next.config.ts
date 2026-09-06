import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * Production-grade security headers.
 *
 * OWASP recommendations:
 *  • X-Frame-Options DENY        — clickjacking protection
 *  • X-Content-Type-Options       — MIME sniffing protection
 *  • Referrer-Policy              — referrer leak protection
 *  • Permissions-Policy           — disable unused powerful APIs
 *  • Strict-Transport-Security    — HTTPS enforcement (HSTS)
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
