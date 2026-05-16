# MONGOLZ Security — Defense Demo Walkthrough (2-3 min screencast)

> Бичих жагсаалт + үг хэлэх скрипт. QuickTime эсвэл OBS-аар бичээрэй.
> Дотоод browser tab: `https://mongolz.vercel.app` — admin + auditor + viewer 3 хэрэглэгчтэйгээр.

## 0. Бэлдэх

```bash
# 1. Demo data seed хийсэн эсэхийг шалга
psql "$SUPABASE_DB_URL" -c "select count(*) from suspects where name like 'demo:%';"
# → ≥3 байх ёстой. Үгүй бол:
npm run demo:seed

# 2. Production-аас login хий — браузерт 3 incognito цонх нээ:
#    Tab 1: admin@mongolz.local  (full access)
#    Tab 2: viewer@mongolz.local
#    Tab 3: auditor@mongolz.local
```

OBS scene: 1080p screen capture + face cam corner оптийн.

---

## 1. Тоглуулах дараалал (~2:30)

### 🎬 SHOT 1 — Logo + Cover (5 sec)
- Browser tab: `https://mongolz.vercel.app/login`
- Voice: *"MONGOLZ Security — 다중 권한 마스킹 및 복원이 가능한 지능형 네트워크 카메라 및 통합관제 서버."*

### 🎬 SHOT 2 — Admin login + TOTP (15 sec)
- Email + password оруул → 2FA promp гарна → Authenticator-аас код → Dashboard
- Voice: *"Admin loginoor 2-step TOTP заавал шаарддаг. Step 1 password, step 2 шинэ цонхонд зөвхөн TOTP код."*

### 🎬 SHOT 3 — Multi-authority masking (30 sec — IM PORTANT!)
- Tab 1 (admin): `/cameras/<id>/schedule` нээ
  - "Ажлын цаг 09:00-18:00 = revealed, бусад нь masked" гэх жишээ үзүүл
- Tab 1: `/cameras/<id>/permissions`
  - Viewer-д зөвхөн нэг камер хандах эрхтэй гэдгийг харуул
- Tab 2 (viewer): /playback → "Илрүүлсэн нүүр" хэсэг **Admin-only** badge харагдана
- Voice: *"Hereglegch tus burt onogdoh masking shatlal — viewer-д face metadata огт байхгүй, admin-д л харагдана."*

### 🎬 SHOT 4 — Reveal 4-eyes (40 sec — IMPORTANT!)
- Tab 1 (admin A): `/playback/<id>` → Reveal button → reason бичих → submit
  - "Status: pending_approval" харагдана
- Tab 3 (auditor): `/audit` хуудсанд `REVEAL_REQUEST` audit entry харагдана
- Tab 1 (admin A): `/reveal-approvals` нээ → өөрөө approve хийх гэх боловч "4-eyes principle: another admin must approve" гэсэн error
- (Эх загвар үзүүлэх) Tab 4 (admin B incognito): `/reveal-approvals` → Approve дарж дуусгана
- Voice: *"4-eyes principle. Reveal-ийг өөрсдөө дангаар batalgaajuulah bolomjgui — өөр admin л зөвшөөрнө. Audit log дотор бүх алхам хатуу бүртгэлтэй."*

### 🎬 SHOT 5 — Live face detection (15 sec)
- Tab 1: `/live` → "Эхлүүлэх" дар → webcam → bbox overlay гарна
- Voice: *"Browser-d ONNX UltraFace огт server руу очихгүй, real-time bbox overlay."*

### 🎬 SHOT 6 — Real-time alerts dashboard (10 sec)
- Tab 1: `/alerts-live` → live chart + recent stream → шинэ alert ирэхэд animation
- Voice: *"Supabase Realtime channel-аар шинэ alerts шууд харагдана."*

### 🎬 SHOT 7 — Auditor view (10 sec)
- Tab 3 (auditor): sidebar дээр зөвхөн **Audit log** ганц л таб
- Voice: *"Auditor role нь зөвхөн audit log харах ердийн уншиж л чадна — өөр юунд ч хүрэхгүй."*

### 🎬 SHOT 8 — GDPR (10 sec)
- Tab 1: `/settings` → "Өгөгдлөө татах (ZIP)" → дауунлоудлогдсон файлыг үзүүл
- Voice: *"GDPR Art.15 / PIPA §35 дагуу өгөгдлөө татах, мөн Art.17 erasure."*

### 🎬 SHOT 9 — Wrap up (10 sec)
- Voice: *"Multi-authority masking + 4-eyes reveal + audit hash chain — defense ready."*
- Card: "mongolz.vercel.app"

---

## 2. Audio script (Mongolian — 2:30 нийт)

```
MONGOLZ Security — Многоступенчатое маскирование болон сэргээх боломжтой
intelligent network camera + integrated control server.

[Login] Admin TOTP заавал, viewer-д шаардахгүй — 2-step server-action flow.

[Multi-authority] Schedule, permissions, role — гурав давхаргат RBAC.

[4-eyes] Reveal job хоёр admin-ын зөвшөөрөл шаардана.

[Live ML] Browser-d real-time face detection, WebGPU fallback WASM.

[Alerts live] Supabase Realtime channel — pg_notify уг шууд push.

[Auditor] Тусдаа role, зөвхөн уншиж л чадна.

[GDPR] Data export ZIP, right to erasure CASCADE.

Mongolz.vercel.app. End.
```

---

## 3. Edit pass

- Audio noise reduction
- 2x speed up sections with form filling
- Lower-thirds: route нэр (/cameras, /reveal-approvals) гарч ирэх
- End card 3 seconds

OBS export: 1080p30, H.264, ~50Mbps, MP4 container.

---

## 4. Bicheh garaagaa (Hindi)

OBS encoder сонгох:
- `Recording Format = mp4`
- `Recording Quality = High Quality, Medium File Size`
- `Encoder = Hardware (NVENC/QuickSync)`

Бичсэн дараа ffmpeg compress:

```bash
ffmpeg -i raw.mp4 -c:v libx264 -crf 28 -preset slow -c:a aac -b:a 96k out.mp4
```

target: < 30MB → email/Slack-ээр хуваалцахад тохиромжтой.
