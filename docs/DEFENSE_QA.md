# Defense Q&A Bank — MONGOLZ Security

Pre-written answers to questions the capstone panel is most likely to ask. Practice these out loud — the body language is what sells the answer, not the bullet points.

---

## Section 1 — Architecture & Design

### Q1. Why did you choose Supabase over a self-managed Postgres?

> "Capstone scope-д PaaS-ийн value давамгайлсан. Supabase нь нэг platform-аас Postgres (RLS-тэй), Auth, Storage, Realtime, Edge Functions, pgvector цуглуулж өгдөг. Энэ нь нэг дор 6 service хэрэглэхгүй гэсэн үг. Production-д жинхэнэ хэрэглээнд орох бол managed RDS + Cognito + S3 + Lambda хослоход илүү сонгох байсан."

### Q2. Яагаад Next.js 16 (canary)? Stable Next.js 15 хангалттай байсан биш гэж үү?

> "Next.js 16-д type-safe routes + improved CSP nonce handling орсон. Бид per-request nonce-тай strict CSP build хийдэг тул 16-н Frame API-ийг ашиглаж байна. Canary гэхдээ 16.3.0 нь stable-руу хэдхэн долоо хоногийн дотор бэлэн болно."

### Q3. ML service-ийг яагаад Railway-ээс host хийсэн?

> "FastAPI + InsightFace + OpenCV + FFmpeg — Vercel serverless-ийн 50MB limit-аас давах учир. Container deployment автомат, env-var management цэвэрхэн. **Гэхдээ нэг илэн далангүй зүйл**: Railway service маань одоогоор `us-west2` (АНУ) регионд ажиллаж байна — Supabase (`ap-southeast-1`) болон Vercel (`sin1`) Сингапурт байхад. Тиймээс frame бүр Сингапур → АНУ → Сингапур гэж явдаг: latency-д ~150ms нэмэгддэг, GDPR Art.44 талаас нь бол SG→US дамжуулалт болдог. Үүнийг `docs/COMPLIANCE.md` §2 болон DPIA §D.5-д бүртгэсэн; засах арга нь Railway-г APAC регион руу зөөх. Production бол Kubernetes (EKS / GKE) дээр, storage-тайгаа нэг регионд шилжүүлнэ."

### Q4. Cubist Mosaic algorithm нь яагаад Gaussian Blur-аас илүү вэ?

> "Бидний өөрийн хэмжилтээр (20 photo-realistic нүүр, 2026-05-18, `docs/BENCHMARK_REAL.md` + `ml-service/docs/BENCHMARK_REAL_FACES.json`):
>
> | Алгоритм | SSIM (бага = илүү нууцлалтай) |
> |---|---|
> | cubist_relaxed | 0.598 ± 0.061 |
> | **cubist_standard** | **0.613 ± 0.058** |
> | cubist_vip | 0.626 ± 0.059 |
> | pixelate 8×8 | 0.627 ± 0.061 |
> | gaussian 21×21 | 0.778 ± 0.058 |
>
> Гурван зүйлийг илэн далангүй хэлнэ:
> 1. **Gaussian-аас тодорхой хүчтэй** (0.61 vs 0.78) — Gaussian-ыг татгалзсан шийдвэр маань хэмжилтээр батлагдсан.
> 2. **Pixelation-аас статистикийн хувьд ялгарахгүй** (0.613 vs 0.627, σ ≈ 0.06). Cubist-ийн давуу тал нь энд нууцлалын хүч биш — visual affordance: pixelation нь «энд мэдээлэл байсан» гэж хашгирдаг бол cubist нь operator-ын нүдийг ядраадаггүй.
> 3. **SSIM бол structural similarity, re-identification-ы хэмжүүр биш.** Жинхэнэ хэмжүүр — masked нүүрийг ArcFace-аар дахин encode хийж cosine-ыг харах — `eval/benchmark_mask_algorithms.py`-д stub хэвээр, хараахан ажиллуулаагүй. Тиймээс би «re-identification боломжгүй» гэж хэлэхгүй, «structure-ийн ихэнхийг устгасан, эх хувь нь шифрлэгдсэн, reveal нь 4-eyes» гэж хэлнэ.
>
> (Хуучин слайд дээр «SSIM 0.3» гэж явсан нь буруу байсан — тэр тоо `docs/BENCHMARK.md`-ийн synthetic 12 зурган run-аас гаралтай бөгөөд scikit-image байхгүй үед correlation-squared fallback ашигласан; тэр run-д бүх алгоритм 0.457–0.479 гарч ялгагдахгүй байсан.)"

### Q5. RLS policy яаж organize хийсэн?

> "`public` schema-д 23 хүснэгт, бүгд дээр RLS асаалттай; 22 хүснэгт дээр нийт 46 policy. Үлдсэн нэг нь (`retention_deletion_queue`) policy-гүй — RLS асаалттай мөртлөө policy байхгүй нь Postgres-д «хэн ч уншиж чадахгүй» гэсэн үг, зөвхөн `service_role` cron хандана. Pattern нь:
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
> - **Multi-agent manual audit** — repeated passes; the most recent (2026-09-08, `docs/audits/2026-09-08-full-audit.mn.md`) raised **78 findings**, put the 24 serious ones through independent refutation, and confirmed 10 High / 13 Medium / 1 Low. Nothing was refuted. That report is checked into the repo unedited, including the findings that are still open.
>
> External annual pentest by an accredited firm is documented as a deferred residual risk pre-production. And the honest framing: an audit that finds 78 things is not a sign the system is bad — it is the reason the documentation you are reading matches the code."

### Q7. "All admins lose their TOTP. What happens?"

> "Two-stage recovery:
> 1. **Recovery codes** — every admin gets 10 single-use SHA-256-hashed codes at TOTP enable. Five of these are enough to restore access.
> 2. **SQL break-glass** — documented in `docs/BREAK_GLASS.md` §1. Operator with `SUPABASE_SERVICE_ROLE_KEY` runs `UPDATE profiles SET totp_enabled = false WHERE email = ...`, then `INSERT INTO audit_log` for traceability. Admin logs in once and re-enables.
>
> Practically: the system has 2 admin accounts (admin@mongolz.local + khajybyek@gmail.com) to reduce single-point-of-failure."

### Q8. "Insider threat? What if an admin abuses their access?"

> "Three layers of defense in depth — and one honest boundary:
> 1. **4-eyes principle on reveal** — opening a recording's encrypted original requires a 2nd admin to approve. Single admin cannot unilaterally unmask.
> 2. **Hash-chained audit log** — `verify_audit_chain()` RPC catches row deletion or modification. Even service-role tampering would break the chain.
> 3. **TOTP step-up on every destructive op** — adding/deleting suspects, users, rules, webhooks, plus backup download. Compromised session cannot exfiltrate without TOTP.
>
> **What the ledger does and does not see.** It records every privileged change, every login/step-up, and the read paths that actually expose personal data — sealed-crop decryption, recording playback, the live-stream playlist (allowed *and* denied), 1:N face search, cross-camera re-id trails, alert CSV export, reveal-output download — one row per operator per object per 5 minutes. It does **not** record page views, dashboard/analytics aggregates, or a read the browser makes straight against PostgREST with its own token (RLS still bounds the rows; the read leaves no row in the ledger). So: an insider's *data extraction* is attributable, their *browsing* is not. I'd rather state that than claim 'everything is logged'."

### Q9. "What is your RTO and RPO?"

> "RTO ≤ 60 min, RPO ≤ 24 h. Two different things are verified, and I keep them apart:
> - **Ciphertext is decryptable** — `/api/cron/backup-verify` samples recordings daily and runs them through the ML service's `/reveal/verify-blob` smoke test.
> - **The backup ZIP** (`/backup`) contains `tables/*.json` plus `buckets/*.manifest.json` — object paths derived from the database, **not** the blob bytes. Media is restored from Supabase Storage / point-in-time recovery; the ZIP tells you exactly which objects must come back and how many. The README inside the ZIP states that limit, and `scripts/restore-from-backup.ts` reads the same manifest.
>
> Restore drill procedure is in `docs/RUNBOOK.md` §3 with explicit acceptance criteria; drill timed at 35–50 min on a staging copy."

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
> - **Art. 25** (privacy by design) — AES-256-GCM on originals; the Cubist mosaic is rendered on demand for playback so no plaintext view is stored (ADR 0010). The live feed is the acknowledged exception.
> - **Art. 30** (records of processing) — hash-chained `audit_log` (coverage boundary in Q8).
> - **Art. 44** (transfers) — storage in Singapore, ML processing in the US; recorded in COMPLIANCE.md §2 and DPIA §D.5.
> - **Art. 32** (security of processing) — full security stack documented.
> - **Art. 33/34** (breach notification) — process in `docs/BREAK_GLASS.md`.
> - **Art. 35** (DPIA) — this document is the lightweight DPIA.
>
> Production launch requires a full DPIA template + designated DPO."

### Q12. "Korean PIPA compliance?"

> "Same `docs/COMPLIANCE.md` maps to PIPA Articles 15 / 17 / 23 / 28-2 / 28-8 / 29 / 35 / 36 / 39. Three Korean talking points:
> - 저장된 원본은 암호화되어 있고, 재생 화면은 열람 시점에 비식별화됩니다 (stored original encrypted, playback view anonymised at request time — ADR 0010; the live feed is a separate, unmasked path).
> - 원본은 AES-256-GCM 으로 암호화되며, 4-eyes 승인 후에만 복원됩니다 (originals encrypted, 4-eyes reveal).
> - 권한 변경과 개인정보 열람 경로(복호화·재생·검색·내보내기)는 해시 체인 감사 로그에 기록됩니다 (privileged changes **and the personal-data read paths** in the hash-chained audit log — not page views, not direct PostgREST reads).
>
> One thing I volunteer rather than wait to be asked: 국외 이전 (Art. 28-8). Storage is in Singapore, but the ML service that decrypts and embeds faces runs in the United States (`us-west2`). It is recorded in COMPLIANCE.md §2/§4 and DPIA §D.5, and the fix is to move the service to an APAC region."

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
> Threshold defaults: alert 0.45, dedup 0.35 — both are ML-service constants and are what decide whether an alert is created. Active learning suggests a per-suspect review threshold from TP/FP labels, which is stored as an alert-rule floor (it selects which dedup window and quiet hours apply); it does not filter alerting."

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

> "Vercel (`sin1`) and Supabase (`ap-southeast-1`) are co-located in Singapore, which gives sub-50 ms latency for everything that is only rows and blobs. The Railway ML service is the exception — it sits in `us-west2` (United States), so any request that has to touch face detection pays a trans-Pacific round trip and, more importantly, moves biometric data across a border (COMPLIANCE.md §2, DPIA §D.5). Edge functions give us nonce-based CSP. Auto-deploy on git push for capstone iteration speed. Production launch in a real org would shift to Kubernetes for stricter network policies — and would pin ML to the same region as storage."

### Q18. "How many lines of code? How long did it take?"

> "Roughly 25K lines TypeScript + 8K lines Python + 4K lines SQL migrations. Built over 6 weeks of focused work. The continuous-improvement loop — every commit triggers SAST, every PR triggers SAST+secret-scan, every Monday triggers DAST — meant we could iterate aggressively without burning trust."

### Q19. "What would you do differently next time?"

> "Three things:
> 1. **Plan for light mode from day 1**. Adding it retroactively to a dark-only design system is painful — every color decision has to be re-evaluated.
> 2. **Move all blob bytes off Supabase Storage** to a dedicated object store like Backblaze B2. Supabase Storage egress pricing scales with recording size, and we're storing AES-encrypted MP4s that don't need PostgREST RLS.
> 3. **Hire an external pentest earlier**. We replaced it with automated SAST/DAST plus repeated multi-agent audits — which did catch real bugs, including several the green test suite never saw — but an experienced pentester's intuition for chained vulnerabilities is irreplaceable. The 2026-09-08 audit made that concrete: the strongest findings were not broken crypto, they were gaps between what the documentation claimed and what the code did."

### Q20. "Is the code open source?"

> "Source lives at `github.com/khajybyek/mongolz-next` (private repo, capstone scope). Post-defense plan: open-source the non-sensitive parts (UI components, design system, security workflows) under MIT, keep the ML training data + production keys private."

---

## Strategic notes

1. **Don't say "easy"** about anything you did. If it WAS easy, that's because the team made it easy through good design — say that instead.
2. **Always show the code** when asked "how does X work". Open the file path from CLAUDE.md and read the comment header. Reading code in front of the panel is the single most persuasive thing you can do.
3. **If you don't know**, say "I'd need to check the audit log to be sure, can I follow up after this slot?" — never invent a number.
4. **Compliments handled gracefully** — "Thank you, the credit goes to the dev process — automated SAST caught two real bugs we'd have shipped otherwise" → redirects from your ego to the system.
5. **End strong** — last sentence should be about the capstone deliverable, not about a TODO or a limitation.
