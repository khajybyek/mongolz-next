# Defense Rehearsal Kit — MONGOLZ Security

Single entry point for everything you need on defense day.

> **Capstone:** 2026-01-CD-03-07 · 3B-26-1
> **Project:** 다중 권한 마스킹 및 복원이 가능한 지능형 네트워크 카메라 및 통합관제 서버 개발
> **Repository:** github.com/khajybyek/mongolz-next
> **Production:** https://aicctv.dev

---

## 1. Deliverables checklist

The panel cares about these artifacts. Have each one accessible in one click:

- [x] Live production deploy — `https://aicctv.dev/`
- [x] GitHub repo — `github.com/khajybyek/mongolz-next`
- [x] Pentest report — `docs/PENTEST_REPORT.pdf` (9 pages)
- [x] Compliance mapping — `docs/COMPLIANCE.md` (GDPR + PIPA)
- [x] Incident runbook — `docs/RUNBOOK.md` (RTO ≤ 60 min, RPO ≤ 24 h)
- [x] Break-glass procedures — `docs/BREAK_GLASS.md` (5 scenarios)
- [x] Security policy — `SECURITY.md` + `/.well-known/security.txt`
- [x] Demo script — `docs/DEMO_SCRIPT.md`
- [x] Q&A bank — `docs/DEFENSE_QA.md`
- [x] Slide deck — `docs/MONGOLZ_Capstone_Defense.pptx`

---

## 2. Pre-defense checklist (24 h before)

- [ ] Run `git status` — repo clean, latest commit pushed
- [ ] Run `curl -s https://aicctv.dev/api/uptime | jq` — confirm production healthy
- [ ] Visit `https://github.com/khajybyek/mongolz-next/actions` — confirm latest workflows green
- [ ] Regenerate `docs/PENTEST_REPORT.pdf` — run the Security workflow manually for fresh DAST baseline
- [ ] Charge your phone (TOTP authenticator)
- [ ] Print the recovery codes — paper backup if phone dies
- [ ] Practice the live demo timing — `docs/DEMO_SCRIPT.md`
- [ ] Skim the Q&A bank — `docs/DEFENSE_QA.md`
- [ ] Test the demo on the conference Wi-Fi if possible

---

## 3. The "elevator pitch" (15 seconds)

> "MONGOLZ Security нь хувийн нууцыг хадгалсан CCTV систем. Бичлэг хийгдмэгц нүүр бүр Cubist Mosaic-аар нуугдаж, эх хувь нь AES-256-аар шифрлэгдэн архивлагдана. Зөвхөн 4-eyes approval-той reveal flow л буцаах эрхтэй. 14 хүснэгт + 24 RLS policy + TOTP 2FA + hash-chained audit log + GDPR/PIPA compliance + continuous SAST/DAST in CI."

Repeat in English if asked:

> "MONGOLZ Security is a privacy-preserving CCTV system. The moment a frame is captured, every face is masked with a Cubist Mosaic and the original is encrypted with AES-256. Only a 4-eyes approval reveal flow can restore the original. 14 tables, 24 RLS policies, TOTP 2FA, hash-chained audit log, GDPR + Korean PIPA compliance mapping, and continuous SAST/DAST in CI."

---

## 4. Three "pillar" talking points

Lead with these if the panel gives you a wide-open question:

### Pillar 1 — Privacy by design, not retrofit

"Anonymization happens **at capture time**, not in post-processing. The Cubist Mosaic is applied before the bytes ever hit storage. There's raw frames exist only transiently in the ML worker; nothing plaintext is persisted (encrypted original + view-time masking, ADR 0010)."

### Pillar 2 — Defense in depth

"Five independent security layers: RLS policies, TOTP step-up, AES-256 encryption, 4-eyes reveal approval, and hash-chained audit. A single layer breach is contained — the others still hold."

### Pillar 3 — Continuous security testing

"Every commit runs Semgrep SAST + dependency audit. Every PR runs trufflehog. Every Monday runs Nuclei + OWASP ZAP DAST against production. Caught 13 verified bugs already — including a missing GCM tag length spec and a Dockerfile running as root."

---

## 5. What to do if a panel question hits a topic you didn't prepare

The honest fallback:

> "Мини-аас алхам гадаа байгаа асуулт боловч хариулъя — давтан хэлэхэд би **<repeat the pillar that's closest>**. Магадгүй та <related sub-system>-ийн дэлгэрэнгүй кодыг харахыг хүсээ юу? Тэндээс уншиж хэлж болно."

Then open the relevant file from `CLAUDE.md` and read the header comment out loud. Buying 30 seconds + showing real code wins more credibility than a guess.

---

## 6. Things NOT to say

- **"It's pretty good"** — empty filler. Say what's good.
- **"It's mostly secure"** — defensiveness reveals weakness. Either "we have N layers of defense" or "the residual risk is documented and accepted".
- **"Everyone does it this way"** — argument from authority. The panel WILL push back.
- **"It would take too long to explain"** — implies you don't understand. Pick one sentence and use it.
- **"I'm not sure what you mean"** when you ARE sure — restate the question in your own words to confirm scope. Don't bluff.

---

## 7. Defense slot timing

Typical capstone slot is 20-30 min:
- 8 min live demo (see DEMO_SCRIPT.md)
- 10 min presentation slides (see the .pptx)
- 12 min Q&A (see DEFENSE_QA.md)

Plan for shorter — leaving 3-5 min for unexpected detours / panel discussion among themselves makes the slot feel more comfortable.

---

## 8. Backup plans

| Failure | Response |
|---|---|
| Production is down | Open `docs/PENTEST_REPORT.pdf` and walk through findings instead of live demo |
| Wi-Fi is too slow for live | Show GitHub repo + screenshots from `docs/screenshots/` (TODO: capture before defense) |
| You blank on a question | "That's documented in `docs/<file>.md` — would you like me to open it?" |
| Multiple questions stacking | "Let me take them one at a time — first <repeat first question>" |
| Time running out | "I'll stop here on the demo; happy to take questions and answer the rest from the repo" |

---

## 9. Post-defense

- Take a screenshot of the panel's final feedback (if visible)
- Pull the latest `audit_log` to capture what was triggered during the demo (e.g., `LOGIN`, `USER_CREATE` rows)
- Update `docs/DEFENSE_QA.md` with anything new you were asked — feeds future cohorts
