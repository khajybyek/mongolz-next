# Security Policy — MONGOLZ Security

The deployed system is **https://aicctv.dev** (capstone project 3B-26-1). The
machine-readable version of this policy is served at
[`https://aicctv.dev/.well-known/security.txt`](https://aicctv.dev/.well-known/security.txt)
(RFC 9116). That file carries the policy inline rather than linking here,
because this repository is private and a link into it 404s for anyone outside
the team — keep the two in sync when you edit either.

## Reporting a Vulnerability

Email **khajybyek@gmail.com** with:
- Description and impact of the issue
- Steps to reproduce (PoC welcome)
- Any suggested fix

We will acknowledge within **5 business days**. If you get no reply, re-send
from a different address — the repository's issue tracker is private, so it is
not a fallback channel.

## Scope

In scope:
- `https://aicctv.dev/*` — the application, its API routes and its public probes
- `https://mongolz-ml-production.up.railway.app/*` — the ML service
- This repository (source-level review, for people who have been given access)

Out of scope:
- Supabase / Vercel / Railway platform issues (report directly to the vendor)
- Third-party dependencies (report upstream)
- Self-XSS, and clickjacking on pages served with `frame-ancestors 'none'`
- Volumetric denial of service, and scanner output with no demonstrated impact
- `mongolz.vercel.app` and any other retired hostname — aicctv.dev is the only
  production domain

## Safe Harbor

Good-faith research is welcomed. We will not pursue legal action against
researchers who:
- Avoid disrupting service for other users
- Access no more data than is needed to demonstrate the issue, and neither
  exfiltrate nor retain personal data
- Give us reasonable time to remediate before public disclosure

**Please do not attempt to download stored footage, face crops or embeddings to
prove a finding.** This is a surveillance system holding biometric data about
real, consenting test subjects; describe the path you found and we will confirm
it from our side.

## Known open issues

Findings already known to us are listed in `docs/audits/` — the most recent
sweep is `docs/audits/2026-09-08-full-audit.mn.md` (Mongolian), which is checked
in unedited, including the items that are still open. A report that matches
something in there is still welcome, but it will be triaged as a duplicate.

## Acknowledgments

None yet. Reporters are credited here, by name or pseudonym, on request.

## Break-Glass — Lost All Admin TOTP

If every administrator has lost access to their authenticator app and no
recovery codes remain, follow the steps in
[docs/BREAK_GLASS.md](docs/BREAK_GLASS.md).
