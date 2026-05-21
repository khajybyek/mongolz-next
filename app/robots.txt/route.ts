export const dynamic = "force-static";

const BODY = `# This Website is currently maintained by cyber security expert, so get your a$$ out of here

User-Agent: *
Disallow: /

Host: https://aicctv.dev
`;

export function GET() {
  return new Response(BODY, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
