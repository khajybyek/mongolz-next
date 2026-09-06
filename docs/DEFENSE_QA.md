# Defense Q&A Bank — MONGOLZ Security

Pre-written answers to questions the capstone panel is most likely to ask. Practice these out loud — the body language is what sells the answer, not the bullet points.

---

## Section 1 — Architecture & Design

### Q1. Why did you choose Supabase over a self-managed Postgres?

> "Capstone scope-д PaaS-ийн value давамгайлсан. Supabase нь нэг platform-аас Postgres (RLS-тэй), Auth, Storage, Realtime, Edge Functions, pgvector цуглуулж өгдөг. Энэ нь нэг дор 6 service хэрэглэхгүй гэсэн үг. Production-д жинхэнэ хэрэглээнд орох бол managed RDS + Cognito + S3 + Lambda хослоход илүү сонгох байсан."

### Q2. Яагаад Next.js 16 (canary)? Stable Next.js 15 хангалттай байсан биш гэж үү?

> "Next.js 16-д type-safe routes + improved CSP nonce handling орсон. Бид per-request nonce-тай strict CSP build хийдэг тул 16-н Frame API-ийг ашиглаж байна. Canary гэхдээ 16.3.0 нь stable-руу хэдхэн долоо хоногийн дотор бэлэн болно."

### Q3. ML service-ийг яагаад Railway-ээс host хийсэн?

> "FastAPI + InsightFace + OpenCV + FFmpeg — Vercel serverless-ийн 50MB limit-аас давах учир. Singapore region-руу latency 50ms-аас бага, contour deployment автомат, env-var management cleanly. Production бол Kubernetes (EKS / GKE) дээр шилжих байсан."

### Q4. Cubist Mosaic algorithm нь яагаад Gaussian Blur-аас илүү вэ?

> "Хоёр тал. **Privacy**: Cubist нь Voronoi-based tessellation, irreversible — pixel-аас гарсан structure recover хийхгүй. SSIM 0.3 орчим (Gaussian 0.7, Pixelate 0.5). **Aesthetics**: Cubist нь нүдэнд таатай харагдах art-style, хүний нүдэнд бачимдуулдаггүй. Defense-д live demo энэ хоёрыг харуулдаг."

### Q5. RLS policy яаж organize хийсэн?

> "14 хүснэгт дээр нийт 24 policy. Pattern нь:
> - admin (full access via `current_user_role()` helper, SECURITY DEFINER)
> - viewer (read-only, no `cameras.url`, no recording bytes)
> - auditor (зөвхөн `audit_log` хүснэгт + `/audit*` route)
> - anon (огт хандах эрхгүй)
>
> RLS-ийг bypass хийдэг нь зөвхөн `service_role` бөгөөд Vercel server-side эndpoint-уудаас л хэрэглэгддэг."

---

## Section 2 — Security

### Q6. "Have you done a penetration test?"

> "Continuous DAST/SAST in CI:
> - **Semgrep SAST** — 681 rules across OWASP Top 10, security-audit, TypeScript, React, Next.js, Python. First run flagged 2 real bugs (AES-GCM tag length explicit + Dockerfile non-root user), both fixed.
> - **trufflehog secret scan** — PR + weekly, 0 verified leaks.
> - **Nuclei DAST** — 8000+ CVE templates, weekly. 0 findings.
> - **OWASP ZAP baseline** — passive rules + AJAX spider. 52 PASS, 18 WARN (each triaged in `docs/PENTEST_REPORT.pdf`), **0 FAIL**.
> - **Multi-agent manual audit** — 27 findings raised, 11 verified bugs fixed.
>
> External annual pentest by an accredited firm is documented as a deferred residual risk pre-production."

### Q7. "All admins lose their TOTP. What happens?"

> "Two-stage recovery:
> 1. **Recovery codes** — every admin gets 10 single-use SHA-256-hashed codes at TOTP enable. Five of these are enough to restore access.
> 2. **SQL break-glass** — documented in `docs/BREAK_GLASS.md` §1. Operator with `SUPABASE_SERVICE_ROLE_KEY` runs `UPDATE profiles SET totp_enabled = false WHERE email = ...`, then `INSERT INTO audit_log` for traceability. Admin logs in once and re-enables.
>
> Practically: the system has 2 admin accounts (admin@mongolz.local + khajybyek@gmail.com) to reduce single-point-of-failure."

### Q8. "Insider threat? What if an admin abuses their access?"

> "Three layers of defense in depth:
> 1. **4-eyes principle on reveal** — opening a recording's encrypted original requires a 2nd admin to approve. Single admin cannot unilaterally unmask.
> 2. **Hash-chained audit log** — `verify_audit_chain()` RPC catches row deletion or modification. Even service-role tampering would break the chain.
> 3. **TOTP step-up on every destructive op** — adding/deleting suspects, users, rules, webhooks, plus backup download. Compromised session cannot exfiltrate without TOTP."

### Q9. "What is your RTO and RPO?"

> "RTO ≤ 60 min, RPO ≤ 24 h. Backup ZIP is verified daily via cron — the `/api/cron/backup-verify` endpoint runs 5 randomly-sampled recordings through the ML service's `/reveal/verify-blob` decrypt smoke test. Restore drill procedure is documented in `docs/RUNBOOK.md` §3 with explicit acceptance criteria. Drill timed at 35-50 min on a staging copy."

### Q10. "How does the AES-256 key derivation work?"

> "Per-recording HKDF derivation. The master key `ML_ENCRYPTION_KEY` is a 256-bit symmetric key from Railway env. For each new recording, the ML service derives a unique sub-key via HKDF-SHA256 with a fixed application salt (`mongolz-recording-v1`) and the recording UUID as `info` — deterministic, so nothing key-related is stored next to the ciphertext. So even with the master key compromised + access to one recording's salt, the attacker only decrypts that one recording.
>
> Key rotation procedure is dual-key — `ML_ENCRYPTION_KEY_PREV` holds the previous key so old recordings remain decryptable while new ones use the new key. Cron at `/api/cron/key-rotation-check` reminds operators weekly via audit + Slack alert."

---

## Section 3 — Compliance

### Q11. "Are you GDPR compliant?"

> "Capstone-scope compliance documented in `docs/COMPLIANCE.md`. Mapped to GDPR Articles:
> - **Art. 5** (data minimization) — raw frames discarded after embedding extraction.
> - **Art. 15 / 17 / 20** (access / erasure / portability) — `/privacy` self-service page + `/api/gdpr/export` + `/api/gdpr/delete`.
> - **Art. 25** (privacy by design) — Cubist mosaic at capture, AES-256-GCM on originals.
> - **Art. 30** (records of processing) — hash-chained `audit_log`.
> - **Art. 32** (security of processing) — full security stack documented.
> - **Art. 33/34** (breach notification) — process in `docs/BREAK_GLASS.md`.
> - **Art. 35** (DPIA) — this document is the lightweight DPIA.
>
> Production launch requires a full DPIA template + designated DPO."

### Q12. "Korean PIPA compliance?"

> "Same `docs/COMPLIANCE.md` maps to PIPA Articles 15 / 17 / 23 / 28-2 / 29 / 35 / 36 / 39. Three Korean talking points:
> - 원본은 암호화되어 저장되고 열람 시점에 비식별화됩니다 (encrypted at rest, anonymised at view time — ADR 0010).
> - 원본은 AES-256-GCM 으로 암호화되며, 4-eyes 승인 후에만 복원됩니다 (originals encrypted, 4-eyes reveal).
> - 모든 권한 있는 액세스는 해시 체인 감사 로그에 기록됩니다 (privileged access in hash-chained audit log)."

### Q13. "What is the legal basis for processing biometric data?"

> "GDPR Art. 9 / PIPA Art. 23 require explicit consent OR substantial public interest grounds for biometric data. The system supports per-camera `consent_required` flag — operators must declare basis when registering. The UI for capturing that declaration is documented as a deferred item (`docs/COMPLIANCE.md` §5). For the capstone demo, all cameras are demo data with synthetic embeddings."

---

## Section 4 — ML

### Q14. "Why ArcFace embeddings? Why not FaceNet?"

> "ArcFace (InsightFace) gives:
> - 512-dim normalized embeddings well-suited to cosine similarity.
> - Pre-trained `buffalo_l` model with strong accuracy on diverse face angles (trained on MS1M-RetinaFace cleaned).
> - Better margin loss for hard-negative discrimination than FaceNet's triplet loss.
> - Excellent compatibility with pgvector for sub-millisecond top-k search at scale.
>
> Threshold defaults: alert 0.45, dedup 0.35. Per-suspect threshold can be auto-tuned via active learning labels."

### Q15. "How do you handle anti-spoofing?"

> "Heuristic ensemble in `ml-service/anti_spoof.py`:
> - **Laplacian variance** (0.45 weight) — printed photos lack texture detail.
> - **HSV color variance** (0.30 weight) — screens show distinctive moiré + color cast.
> - **FFT high-frequency analysis** (0.25 weight) — photo paper smooths high spatial frequencies.
> Combined threshold 0.55. Not as strong as a dedicated CNN classifier (e.g. SiW dataset trained on real vs. spoof) but catches obvious printed-photo attacks. Production deployment recommends a CNN-based liveness check (e.g. MediaPipe Face Mesh + depth)."

### Q16. "Multi-angle face matching?"

> "Embedding fusion in `ml-service/embedding_fusion.py`:
> - **Weighted mean** — average across N frames weighted by detection confidence.
> - **Median** — robust to outlier frames (e.g. motion blur).
> Both produce a unit-norm 512-dim embedding. Used during /live recording to fuse the best detection windows before suspect search, reducing false negatives at oblique angles."

---

## Section 5 — Defense-day specifics

### Q17. "Why a Vercel-based production?"

> "Vercel + Supabase + Railway co-located in Singapore (`sin1` / `ap-southeast-1`) gives sub-50ms inter-service latency. Edge functions for nonce-based CSP. Auto-deploy on git push for capstone iteration speed. Production launch in a real org would likely shift to Kubernetes for stricter network policies."

### Q18. "How many lines of code? How long did it take?"

> "Roughly 25K lines TypeScript + 8K lines Python + 4K lines SQL migrations. Built over 6 weeks of focused work. The continuous-improvement loop — every commit triggers SAST, every PR triggers SAST+secret-scan, every Monday triggers DAST — meant we could iterate aggressively without burning trust."

### Q19. "What would you do differently next time?"

> "Three things:
> 1. **Plan for light mode from day 1**. Adding it retroactively to a dark-only design system is painful — every color decision has to be re-evaluated.
> 2. **Move all blob bytes off Supabase Storage** to a dedicated object store like Backblaze B2. Supabase Storage egress pricing scales with recording size, and we're storing AES-encrypted MP4s that don't need PostgREST RLS.
> 3. **Hire an external pentest earlier**. We replaced it with automated SAST/DAST + agent audit which caught 13 real bugs — but an experienced pentester's intuition for chained vulnerabilities is irreplaceable."

### Q20. "Is the code open source?"

> "Source lives at `github.com/khajybyek/mongolz-next` (private repo, capstone scope). Post-defense plan: open-source the non-sensitive parts (UI components, design system, security workflows) under MIT, keep the ML training data + production keys private."

---

## Strategic notes

1. **Don't say "easy"** about anything you did. If it WAS easy, that's because the team made it easy through good design — say that instead.
2. **Always show the code** when asked "how does X work". Open the file path from CLAUDE.md and read the comment header. Reading code in front of the panel is the single most persuasive thing you can do.
3. **If you don't know**, say "I'd need to check the audit log to be sure, can I follow up after this slot?" — never invent a number.
4. **Compliments handled gracefully** — "Thank you, the credit goes to the dev process — automated SAST caught two real bugs we'd have shipped otherwise" → redirects from your ego to the system.
5. **End strong** — last sentence should be about the capstone deliverable, not about a TODO or a limitation.
