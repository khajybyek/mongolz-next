/**
 * /.well-known/security.txt — RFC 9116
 *
 * Served as plain text so security researchers know where to report
 * vulnerabilities without resorting to LinkedIn / Twitter.
 *
 * The policy is inlined as comments rather than linked. The source repository
 * (github.com/khajybyek/mongolz-next) is private, so the previous
 * `Policy:` / `Acknowledgments:` links to SECURITY.md returned 404 for every
 * researcher who followed them — a dead link is worse than no link. RFC 9116
 * §2.4 allows comment lines, and both fields are optional. Restore them as
 * real fields the day the repo (or a public policy page) is reachable, and
 * keep the text below in sync with SECURITY.md.
 */

const SECURITY_TXT = `Contact: mailto:khajybyek@gmail.com
Expires: 2027-09-01T00:00:00.000Z
Preferred-Languages: en, mn, ko
Canonical: https://aicctv.dev/.well-known/security.txt

# ── Policy ────────────────────────────────────────────────────────────
# Inlined because the source repository is private; there is no public
# policy page to link to yet. This section is the policy.
#
# Reporting
#   Email the Contact address above with: what the issue is and its impact,
#   steps to reproduce (a PoC is welcome), and any suggested fix.
#   Expect an acknowledgement within 5 business days.
#
# In scope
#   https://aicctv.dev/*                              (the application)
#   https://mongolz-ml-production.up.railway.app/*    (the ML service)
#
# Out of scope
#   Supabase, Vercel and Railway platform issues — report to those vendors.
#   Third-party dependencies — report upstream.
#   Self-XSS, and clickjacking on pages served with frame-ancestors 'none'.
#   Volumetric denial of service, and automated-scanner output with no
#   demonstrated impact.
#
# Safe harbour
#   Good-faith research is welcome. We will not pursue legal action against
#   researchers who avoid disrupting the service for others, access no more
#   data than is needed to demonstrate the issue, do not exfiltrate or retain
#   personal data, and give reasonable time to remediate before disclosing.
#
# Note for researchers
#   This is an academic capstone deployment. Accounts and camera data belong
#   to the project team and consenting test subjects; please do not attempt
#   to enumerate or download stored footage or face data to prove a finding —
#   describe the path instead and we will confirm it.
#
# Acknowledgements
#   None yet. Reporters will be credited here, by name or pseudonym, on
#   request.
`;

export function GET() {
  return new Response(SECURITY_TXT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
