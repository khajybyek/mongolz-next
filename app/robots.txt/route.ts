export const dynamic = "force-static";

/**
 * Served at /robots.txt. Every route behind the landing page requires
 * authentication, so there is nothing here worth indexing — the policy is a
 * blanket disallow, and the comment says why rather than making a joke of it.
 */
const BODY = `# MONGOLZ Security — internal video-surveillance console.
# Every route beyond this page requires authentication, so there is nothing
# here to index. Security contact: /.well-known/security.txt

User-Agent: *
Disallow: /

Host: https://aicctv.dev
`;

export function GET() {
  return new Response(BODY, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
