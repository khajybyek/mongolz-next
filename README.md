# MONGOLZ Security — Next.js + Supabase

AI-Powered Surveillance — нүүр таних CCTV систем.
Хуучин Streamlit Python app-аас бүрэн **Next.js 15 + Supabase + Python ML service** архитектур руу шилжүүлсэн.

---

## Архитектур

```
┌──────────────────────────────┐
│   Next.js 15 (Vercel-ready)   │  App Router · TypeScript · Tailwind
└──────────┬───────────────────┘
           │
   ┌───────┴────────────────────────────────┐
   ▼                ▼                       ▼
┌──────────┐   ┌────────────────────┐   ┌──────────────────────┐
│ Supabase │   │  Python ML         │   │ Supabase Edge Func   │
│  Auth    │   │  Service (FastAPI) │   │ → Claude Opus 4.7    │
│  DB      │   │  + InsightFace     │   │   (AI Analysis)      │
│  Storage │   │  + OpenCV          │   └──────────────────────┘
│  pgvector│   │  + FFmpeg + HLS    │
└──────────┘   └────────────────────┘
```

| Layer | Tech | Файлууд |
|-------|------|---------|
| **Frontend** | Next.js 15 · React 19 · TS · Tailwind 3 · Recharts · hls.js | `app/`, `components/`, `lib/` |
| **Auth** | Supabase Auth (email/password + step-up reauth) | `lib/supabase/`, `app/login/`, `app/api/auth/reauth/` |
| **DB** | Postgres + **pgvector(512)** + RLS (admin/viewer) | `supabase/migrations/` |
| **Storage** | Supabase Storage (4 bucket — RLS-тай) | `suspects/ faces/ recordings/ revealed/` |
| **ML / CV** | Python FastAPI · InsightFace ArcFace · MediaPipe · FFmpeg | `ml-service/` |
| **AI** | Claude Opus 4.7 (Edge Function-аар) | `supabase/functions/claude-analysis/` |
| **Streaming** | RTSP → FFmpeg → HLS → hls.js | `recording_pipeline.py`, `components/hls-player.tsx` |

---

## 🎬 Гол боломжууд

### 1. Live (3 mode)
- **💻 Энэ тоног** — `getUserMedia` (laptop webcam, camera dropdown)
- **📱 Гар утас** — IP Webcam app URL (MJPEG/MP4)
- **📹 IP CCTV** — RTSP → Python ML → HLS player

### 2. Recording pipeline (live=clear, saved=blurred, original=stored)
```
RTSP frame
  ├─→ HLS m3u8 (LIVE — un-blurred)
  ├─→ blurred.mp4 (нийтлэх — MediaPipe per-frame Gaussian blur)
  └─→ original.mp4 (RLS-тай — reveal-д зориулсан)
```

### 3. **Click-to-Reveal** ⭐ (гол үнэт feature)
1. Playback дотор blurred бичлэг тоглоно
2. Detect-сэн нүүр бүр video дээр **cyan хүрээтэй clickable box**
3. Click → modal шууд **step-up auth (нууц үг)**-руу
4. Auth → Python `/reveal/run` job эхэлнэ
5. Frame бүрд target embedding-тэй харьцуулж зөвхөн тэр нэг хүн дээр **selectively unblur**
6. 15 минут TTL signed URL-аар revealed video харуулна

### 4. Reveal — 3 method-той
- **📤 Upload** — зураг → ArcFace embedding → reveal
- **🕵️ Сэжигтэн** — DB-ээс сонгох → embedding нь хадгалагдсан
- **👥 Илрүүлсэн** — энэ бичлэгт detect болсон nүүрнүүд (modal-аас эсвэл video-н дээр шууд)

### 5. AI Analysis (Claude Opus 4.7)
- Summary mode — DB statistics-ээс security score 1-10
- Anomaly mode — шөнийн цаг, давтагдсан сэжигтэн илрүүлэх
- Chat mode — free-form Mongolian Q&A

### 6. Audit + Step-up Auth
| Action | Бичигдэх үед |
|--------|-------------|
| `LOGIN`/`LOGOUT` | nэвтрэх/гарах |
| `REAUTH_OK`/`REAUTH_FAILED` | нууц үг дахин баталгаажуулах |
| `REVEAL_REQUEST` | reveal job эхлүүлэх |
| `SUSPECT_ADD`/`SUSPECT_DELETE` | сэжигтэн нэмэх/устгах |
| `CAMERA_ADD`/`CAMERA_DELETE` | камер удирдах |
| `AI_ANALYSIS` | Claude дуудах |

---

## 📁 Файл бүтэц

```
mongolz-next/
├── app/
│   ├── (app)/                       # protected layout
│   │   ├── layout.tsx              # sidebar + i18n
│   │   ├── dashboard/              # statistics + recent alerts
│   │   ├── live/
│   │   │   ├── page.tsx            # server: cameras list
│   │   │   ├── live-view.tsx       # 3 mode (device/phone/cctv)
│   │   │   └── actions.ts          # ML start/stop
│   │   ├── playback/
│   │   │   ├── page.tsx            # recordings grouped by date
│   │   │   └── [id]/
│   │   │       ├── page.tsx        # recording detail
│   │   │       ├── playback-player.tsx  # video + overlay + modal root
│   │   │       ├── video-with-face-overlay.tsx  ⭐ clickable face boxes
│   │   │       └── reveal-modal.tsx  # 4-step flow
│   │   ├── search/                 # face search via /api/search
│   │   ├── suspects/               # CRUD with photo upload → ArcFace
│   │   ├── alerts/                 # paginated alerts table + CSV
│   │   ├── analytics/              # 4 charts (faces by hour/day, alerts, top)
│   │   ├── ai/                     # Claude chat UI
│   │   ├── audit/                  # audit log filtered by action
│   │   ├── faces/                  # captured faces gallery
│   │   └── cameras/                # manage RTSP/HTTP/USB cameras
│   ├── login/                      # Supabase signin
│   ├── auth/{callback,logout}/
│   └── api/
│       ├── auth/reauth/            # step-up password verify
│       ├── reveal/{start,[jobId]}/ # reveal lifecycle
│       ├── ai/                     # Claude proxy
│       ├── search/                 # ML embed + match_faces RPC
│       ├── alerts/csv/             # export
│       └── lang/                   # cookie-based i18n
├── components/
│   ├── sidebar.tsx                 # role-aware nav
│   ├── language-switcher.tsx       # mn/en/kr
│   ├── hls-player.tsx              # hls.js wrapper
│   └── ui/{stat-card,page-header,empty}.tsx
├── lib/
│   ├── supabase/{client,server,middleware,auth}.ts
│   ├── auth/step-up.ts             # 15min reauth cookie
│   ├── i18n/{translations,server}.ts
│   ├── ml-client.ts                # Python service caller
│   ├── database.types.ts
│   └── utils.ts
├── middleware.ts                   # auth guard
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 20260427000001_initial_schema.sql      # core tables + pgvector
│   │   ├── 20260427000002_rls_policies.sql        # admin/viewer RLS
│   │   ├── 20260427000003_reveal.sql              # reveal_jobs + bucket
│   │   └── 20260428000004_face_bbox.sql           # bbox + recording_id
│   ├── seed.sql                    # demo cameras
│   └── functions/claude-analysis/  # Deno Edge Function
├── ml-service/
│   ├── main.py                     # FastAPI endpoints
│   ├── face_engine.py              # InsightFace wrapper (ArcFace 512-dim)
│   ├── recording_pipeline.py       # 3-pipe ffmpeg + bbox storage
│   ├── reveal_job.py               # frame-by-frame selective unblur
│   ├── camera_worker.py            # CameraManager + reveal trigger
│   ├── storage.py                  # Supabase service-role wrapper
│   ├── Dockerfile + railway.json   # deploy
│   └── requirements.txt
├── scripts/create-admin.ts         # admin/viewer user create
├── package.json, tsconfig.json, tailwind.config.ts, next.config.ts
└── README.md
```

---

## 🚀 Setup (local dev)

```bash
# 1. Supabase local
brew install supabase/tap/supabase
cd mongolz-next
supabase start                       # ~5 min on first run

# 2. .env.local — supabase status-аас key хуулна
# NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
# NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
# SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
# NEXT_PUBLIC_ML_SERVICE_URL=http://localhost:8000
# ANTHROPIC_API_KEY=sk-ant-...   (Edge Function-руу secrets set)

# 3. Frontend
npm install
npm run create-admin     # admin@mongolz.local / Mongolz!
npm run create-viewer    # viewer@mongolz.local / viewer123
npm run dev              # → http://localhost:3000

# 4. Python ML service (RTSP recording-д л шаардана)
cd ml-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env     # SUPABASE_URL/SERVICE_ROLE_KEY оруул
uvicorn main:app --reload --port 8000

# 5. Edge Function (AI Analysis-д)
supabase functions deploy claude-analysis
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

## 🌍 Production deploy

| Service | Tool | Команд |
|---------|------|--------|
| Frontend | Vercel | `vercel --prod` |
| DB / Auth / Storage | Supabase Cloud | Studio-аас project үүсгээд `supabase link` + `supabase db push` |
| Edge Function | Supabase | `supabase functions deploy claude-analysis` |
| ML Service | Railway / Modal / Render | `railway up` (Dockerfile auto-detect) |

---

## 🆚 Хуучин MONGOLZ-той харьцуулалт

| Feature | Хуучин (Streamlit) | Шинэ (Next.js + Supabase) |
|---------|--------------------|---------------------------|
| Auth | bcrypt + TOTP 2FA | Supabase Auth + step-up password reauth |
| DB | SQLite + AES-256 BLOB | Postgres + pgvector + RLS |
| Storage | Local files (`recordings/`) | Supabase Storage (encryption-at-rest) |
| Face detect | InsightFace in-process | Python FastAPI service (decoupled) |
| AI Analysis | Ollama llama3.2 (local) | **Claude Opus 4.7** (Edge Function) |
| Live stream | OpenCV+FFmpeg pipe | FFmpeg HLS → hls.js |
| **Reveal** | Manual page navigation | **Click on blurred face in playback** ⭐ |
| Telegram alert | requests sync | Edge Function via `pg_net` async trigger |
| Хэл | mn/en/kr | mn/en/kr (75+ key) |

---

## 📐 Аюулгүй байдлын давхаргууд

```
┌─────────────────────────────────────────────────────┐
│ 1. Sidebar UI         — admin-only nav-ыг нуудаг    │
│ 2. requireAdmin()     — Server Component redirect    │
│ 3. RLS policies       — Postgres row-level deny      │
│ 4. Step-up reauth     — нууц үг 15min cookie TTL     │
│ 5. Audit log          — бүх чухал үйлдэл бичигдэнэ   │
│ 6. Storage RLS        — admin-only buckets           │
│ 7. Signed URLs        — 15-30 min TTL                │
└─────────────────────────────────────────────────────┘
```

---

## ✅ Хэрэгжүүлсэн полиш (2026-05)

- [x] Telegram alert — `pg_net` async DB trigger → Edge Function
- [x] All-faces clustering — DBSCAN cosine, `faces.cluster_id` + `/clusters` UI
- [x] Backup/restore — `/backup` admin page + `/api/admin/backup` JSZip (12 tables)
- [x] Recording chunking — 3MB session chunks, `session_id` + `chunk_index`
- [x] WebRTC live — `/live-rtc` loopback RTCPeerConnection + RTT/jitter/FPS stats
- [x] Mobile-friendly sidebar — drawer, body-scroll lock, i18n aria
- [x] E2E tests — Playwright (`e2e/public.spec.ts` + `e2e/i18n.spec.ts`)

---

## 👥 Default credentials

| Username | Email | Role |
|----------|-------|------|
| `khajybyek` | `khajybyek@gmail.com` | Admin (primary) |
| `admin` | `admin@mongolz.local` | Admin (backup) |
| `viewer` | `viewer@mongolz.local` | Viewer |
| `auditor` | `auditor@mongolz.local` | Auditor (audit log only) |

Login form accepts either username OR email. Username-only inputs resolve to
the underlying email via the `email_for_username()` RPC. Admin accounts have
TOTP-2FA enabled — step 2 prompt appears after password.

> Production-д **зайлшгүй солих**. `npm run create-admin` / `create-viewer` /
> `create-auditor` ашигла.

---

**Multi-authority masking + 4-eyes reveal + audit hash-chain · 33 page · 3 microservice · pgvector + step-up auth + WebRTC**
