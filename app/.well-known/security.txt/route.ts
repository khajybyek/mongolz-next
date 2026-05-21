/**
 * /.well-known/security.txt — RFC 9116
 *
 * Served as plain text so security researchers know where to report
 * vulnerabilities without resorting to LinkedIn / Twitter.
 */

const SECURITY_TXT = `Contact: mailto:security@mongolz.local
Expires: 2027-01-01T00:00:00.000Z
Preferred-Languages: en, mn, ko
Canonical: https://aicctv.dev/.well-known/security.txt
Policy: https://github.com/khajybyek/mongolz-next/blob/main/SECURITY.md
Acknowledgments: https://github.com/khajybyek/mongolz-next/blob/main/SECURITY.md#acknowledgments
`;

export function GET() {
  return new Response(SECURITY_TXT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
