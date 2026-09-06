# Live Demo Script — MONGOLZ Security

A minute-by-minute walkthrough for the capstone defense. Total runtime: **~8 minutes** at a comfortable pace, with 1-2 buffer minutes for questions.

> **Pre-flight checklist (15 min before defense):**
> - Two devices: laptop + phone (or two browser windows side by side)
> - Logged in as `khajybyek` on the laptop, logged out on the second
> - Authenticator app open on phone
> - `/compare` page pre-loaded with a sample face photo ready to drop
> - Network: pre-tested on the room's Wi-Fi if possible
> - Backup: keep `docs/PENTEST_REPORT.pdf` open in a tab in case the live demo dies

---

## Minute 0:00 — Opening (30 s)

Open `https://mongolz.vercel.app/` on a fresh tab (logged out).

**Script:**

> "MONGOLZ Security нь олон эрхтэй маск + reveal чадвартай ухаалаг сүлжээний камер ба нэгдсэн удирдлагын сервер. Capstone 2026-01-CD-03-07. Энэ нь production deploy.
>
> Эхлээд та харж байгаа нь public landing — нэвтрэхгүй хүртэл бүх контент харах боломжтой."

Scroll down through the 4 sections (Problem · Architecture · Live demos · Security). Linger ~5 seconds on each.

---

## Minute 0:30 — Login + 2FA (45 s)

Click **Нэвтрэх** in the header.

**Script:**

> "Нэвтрэх форм — нэг анхдагч feature нь email эсвэл username хэлбэрээр нэвтрэх боломжтой. Би `khajybyek` гэж бичээд орох гэж байна."

Enter:
- email: `khajybyek`
- password: (your password)

Press Enter.

**Script:**

> "TOTP идэвхтэй админ-д шууд 2-р алхам шаарддаг — нэг удаагийн код."

Open Authenticator → read 6-digit code → enter → submit.

**Script:**

> "Нэг чухал зүйл: бид TOTP code-уудыг нэг удаагийн ашиглалттай хийсэн. 30 секундийн validity цонхонд хоёр дахь удаа replay хийх боломжгүй — server-side hash track хийдэг."

---

## Minute 1:15 — Dashboard tour (45 s)

You land on `/dashboard`.

**Script:**

> "Эндээс бүх админ интерфэйс эхэлдэг. Дээд header дээр: breadcrumb,
> хайлт (⌘K), ML/DB статус, харагдац/хэл, бүртгэлийн цэс. Sidebar дотор:
> - **Compare** — privacy mask algorithm demo
> - **Live** — webcam/RTSP recording
> - **Alerts** — real-time suspect matches
> - **Audit log** — hash-chained, tamper-evident
> - **Users / Webhooks / Reveal Approvals** — admin governance
>
> Dashboard дээр 7 хоногийн alert trend, түргэн үйлдлүүд, камер +
> бичлэгийн жагсаалт харагдана. Утсан дээр доод tab bar-аар шилжинэ.
> Хамгийн чухал нь ⌘K дарвал command palette нээгдэнэ — хуудас ч,
> үйлдэл ч (theme, хэл, гарах) энд байна."

Press **⌘K** → type `compare` → Enter.

---

## Minute 2:00 — Privacy mask comparison demo (2 min)

You're on `/compare`.

**Script:**

> "Энэ бол ажлын гол demo. Капстон-ы зорилго нь privacy vs security tradeoff-ийг шийдэх. Нүүртэй зураг чирж тавья."

Drag the prepared face photo into the upload zone (or click and select).

**Script:**

> "Нэг зураг дээр 3 өөр algorithm-ийг зэрэг ажиллуулна — Cubist Mosaic, Gaussian Blur, Pixelate. Server-side ML service ажиллана, ~3 секундийн дотор."

Click **3 алгоритмыг ажиллуулах**.

Wait for results.

**Script (when results appear):**

> "Хариу 3 panel-аар харагдана. Хамгийн бага SSIM-тэй algorithm нь хамгийн их хувийн нууцлал хадгалсан гэсэн үг — энд `card-glow`-той `Winner` badge тэмдэглэгдсэн.
>
> SSIM = Structural Similarity Index — 0-аас 1, бага нь нүүр илүү танигдахааргүй болсон гэсэн үг."

Scroll down to the methodology card.

**Script:**

> "Доорх card дотор бичсэн ёсоор: бүх mask-ийн эх хувь AES-256-GCM-аар шифрлэгдэж, **4-eyes approval reveal flow**-оор л буцаагдана. Жирийн оператор нүүрийг хэзээ ч харахгүй."

---

## Minute 4:00 — Live recording + face detection (90 s)

Click **Live** in sidebar (or ⌘K → `live`).

**Script:**

> "Live page нь webcam-аас бичлэг хийдэг. Browser-side ONNX UltraFace inference WebGPU-аар ажиллана — ~5fps real-time."

Click **Эхлүүлэх** → allow camera permission.

Wait for face overlay box to appear.

**Script:**

> "Дээд буланд анхдагч detector backend харагдах — `1 нүүр · WEBGPU`. Зураг бүхэн encrypt хийгдэж storage руу.
>
> Recording эхлүүлбэл 3MB чанх chunked upload — ML service асинхрон-оор mask + AES шифрлэлт хийгээд `recordings` table-д бичнэ."

Click **Бичлэг эхлүүлэх**. Wait ~5 seconds. Click **Бичлэг зогсоох**.

Click **Камер унтраах**.

---

## Minute 5:30 — 2FA gating demo (60 s)

Click **Users** in sidebar.

**Script:**

> "Энэ бол админ user management. **Шинэ хэрэглэгч** товч дарвал TOTP prompt гарч ирнэ."

Click **+ Шинэ хэрэглэгч** → fill form (email/password/role) → click **Үүсгэх**.

The TOTP modal appears.

**Script:**

> "Зориудаар. Suspect нэмэх, user устгах, alert rule үүсгэх — бүх mutation-д TOTP step-up шаардана. Cookie 15 минут hold хийдэг тул нэг сегментэд олон үйлдэл хийхэд дахин дахин гарч ирэхгүй."

Enter TOTP from authenticator → user created.

---

## Minute 6:30 — Compliance + governance (60 s)

Click **Audit Log** in sidebar.

**Script:**

> "Бүх админ үйлдэл энд бичигддэг — hash-chained, нэг row устгавал `verify_audit_chain()` RPC бөмбөгдсөн гэдгийг илрүүлнэ."

Scroll through some entries, point out audit actions like `USER_CREATE`, `REAUTH_TOTP_OK`, `BACKUP_DOWNLOAD`.

**Script:**

> "Жинхэнэ life-нөхцөл-д энэ нь GDPR Art.30 (records of processing) шаардлагыг хангана. Документатлагдсан DPIA `docs/COMPLIANCE.md` дотор Korean PIPA-ийн дагуу мөн хариулсан."

Open new tab → `mongolz.vercel.app/.well-known/security.txt` → show.

---

## Minute 7:30 — Closing (30 s)

Open `/api/uptime` in a tab.

**Script:**

> "Production-ийн health: ml + db real-time. External monitor-уудад зориулсан endpoint.
>
> Хураангуй: 14 хүснэгт + 24 RLS policy + AES-256-GCM шифрлэлт + TOTP 2FA + 4-eyes approval + 11 verified bug fix + бүх 5-layer continuous security testing. 9-хуудастай consolidated pentest report repo-д хадгалагдсан.
>
> Defense асуулт-уудтай — баярлалаа."

---

## Failure recovery

| Failure | Recovery |
|---|---|
| Public landing slow | Refresh once; if still slow → screenshot of the page open in another tab |
| Login won't accept TOTP | Try a recovery code (one of the 10 SHA-256 hashed codes) |
| /compare fails | Open `docs/PENTEST_REPORT.pdf` instead — "Here's the consolidated report" |
| /live no camera | Switch to "Гар утас" tab and demo the IP webcam URL |
| 2FA prompt won't open | Mention "TotpPrompt is conditional on REAUTH_REQUIRED — must have admin role" |
| Whole production down | Pull up the GitHub Actions Security page to show recent green runs |
