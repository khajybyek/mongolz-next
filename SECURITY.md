# Security Policy — MONGOLZ Security

## Reporting a Vulnerability

Email **khajybyek@gmail.com** with:
- Description and impact of the issue
- Steps to reproduce (PoC welcome)
- Any suggested fix

We will respond within **5 business days**. If you do not receive a reply, please re-send via GitHub Issues with `[security]` in the title (omit exploit details there).

## Scope

In scope:
- `https://mongolz.vercel.app/*`
- `https://*.up.railway.app/*` (ML service)
- This repository (source-level review)

Out of scope:
- Supabase platform issues (report directly to Supabase)
- Vercel platform issues (report directly to Vercel)
- Third-party dependencies (report upstream)
- Spam / phishing of `mongolz.local` email
- Self-XSS / clickjacking on login (CSP `frame-ancestors 'none'`)

## Safe Harbor

Good-faith research is welcomed. We will not pursue legal action against researchers who:
- Avoid disrupting service for other users
- Do not exfiltrate more than necessary to prove the issue
- Give us reasonable time to remediate before public disclosure

## Acknowledgments

(empty — no external reports yet)

## Break-Glass — Lost All Admin TOTP

If every administrator has lost access to their authenticator app and no recovery codes remain, follow the steps in [docs/BREAK_GLASS.md](docs/BREAK_GLASS.md).
