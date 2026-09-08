# MONGOLZ / aicctv.dev — debugging ба хөгжүүлэлтийн үнэлгээ

2026-09-07 · Шалгасан суурь: 838e4f7 commit + production-д гаргасан UI өөрчлөлттэй одоогийн working tree.

**Эхний зорилт: бичлэгийг найдвартай хадгалах, нүүр ил гаргах эрхийг бүх түвшинд мөрдүүлэх, камерын бодит төлөвийг зөв харуулах.** Үүний дараа өдөр тутмын хэрэглээг хялбарчилж, шинэ боломжуудыг нэмнэ.

Энэ аудит код унших, production-ийн нийтийн хуудсуудыг шалгах, тусгаарласан тест ажиллуулах хүрээнд хийгдэв. Production-ийн өгөгдөл, хэрэглэгч, камер, тохиргоонд өөрчлөлт оруулаагүй. P1-ийн эхний багц засварууд одоогийн working tree-д хэрэгжсэн; cloud migration болон production deploy энэ тайлангаар хийгдээгүй.

**Шалгалтын үр дүн**

| Шалгалт | Үр дүн |
|---|---|
| Jest | 24 suite, 210 тест давсан |
| Python ML | 197 тест давсан; жинхэнэ credentials ашиглаагүй, гадаад сүлжээг хаасан |
| Production Playwright | 82 тест давсан: desktop Chromium + mobile Safari |
| ESLint / TypeScript | Давсан |
| Migration lint | 84 migration файл давсан; retention SQL-ийн PGlite шалгалт 31 assertion давсан |
| Нийтийн health | DB болон ML probe хэвийн |
| npm audit | High/critical 0; low 1 |
| Production build | Turbopack build 166 dependency warning-той ч амжилттай; local gitignored Python symlink-ийг түр тусгаарлан шалгасан |

Browser шалгалт: нүүр, login, MN/EN/KR, light/dark, текстийн contrast, password toggle, submit feedback, TOTP буцах товч, хамгаалагдсан хуудсуудын redirect, CSP/HSTS, OG зураг, manifest/robots/security.txt. Login POST-уудыг browser дотор хааж, жинхэнэ нэвтрэлт хийгээгүй. Cron ажиллуулах, telemetry-д туршилтын event илгээх тестүүдийг зориуд ажиллуулаагүй.

Хязгаар: admin/viewer/auditor-аар нэвтэрсэн production урсгал, жинхэнэ CCTV, reveal, устгалын ажиллагааг туршаагүй. Railway дахь ML код болон cloud SQL нь checkout-той яг адил эсэхийг энэ удаа тулгаагүй. Иймээс доорх кодын алдааг production дээр болсон үйл явдал гэж ойлгож болохгүй.

**P1 — хамгийн түрүүнд засах**

**1. Upload алдахад амжилттай гэж харагдана.**  
[live-view.tsx](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/live/live-view.tsx:329) дахь catch алдааг харуулаад Promise-ийг амжилттай дуусгана. [Stop handler](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/live/live-view.tsx:352) үүний дараа “processing started” гэж үргэлж харуулна. Chunk buffer аль хэдийн цэвэрлэгдсэн, дахин илгээх механизм байхгүй. Тусгаарласан Node нөхцөлд HTTP 502 → алдаа → success дараалал давтагдсан.

Засвар: илгээгдээгүй chunk-ийг хадгалах; алдааг queue-д дамжуулах; давтан илгээхэд давхар бичлэг үүсгэхгүй байх; сервер бүтэн session хүлээн авснаа баталсны дараа success харуулах. Шалгуур: эхний болон сүүлийн chunk алдахад success гарахгүй, retry хийсний дараа нэг бүрэн бичлэг үүснэ.

**2. Storage тасалдахад бичлэгийн цорын ганц локал файл устаж болно.**  
[recording_pipeline.py](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/recording_pipeline.py:694) upload/finalize алдааг бариад finally дотор original/blurred файлуудыг устгана. Actual Python method-ийг mocked I/O-тай ажиллуулахад baked болон on_demand горимд хоёуланд нь устгах үйлдэл дуудагдсан.

Засвар: бичлэгийг эхлээд шифрлэсэн, дахин хүргэх боломжтой файл болгон хадгалах; upload болон DB шинэчлэлт батлагдтал тэр файлыг үлдээх; pending/failed төлөв, retry queue нэмэх. Plaintext-ийг шифрлэлт амжилттай болсны дараа цэвэрлэнэ. Шалгуур: Storage 503 → worker restart → retry үед бичлэг алдагдахгүй, амжилт давхар тоологдохгүй.

**3. Эрхийн мэдээлэл уншигдахгүй үед хамгийн өндөр эрх олгож байна.**  
[secure-crop route](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/api/faces/[id]/secure-crop/route.ts:76) болон [reveal start](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/api/reveal/start/route.ts:174) reveal_level-ийг 0 гэж орлуулдаг. 0 нь director буюу бүх түвшний нүүрийг үзэх эрх. Actual crop route-ийг тусгаарласан mock-оор ажиллуулахад profile query алдаатай байсан ч HTTP 200 болж, ML-д level=0 дамжуулсан.

Засвар: эрх байхгүй/алдаатай/хязгаараас гадуур бол тайлах ажиллагааг зогсоох; баталгаажсан нэг эх сурвалжаас эрх унших. Шалгуур: profile query алдахад ML decrypt болон reveal job creation огт дуудагдахгүй.

**4. Дууссан reveal-ийн үр дүн дээр эрхийг дахин шалгахгүй байна.**  
[reveal output route](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/api/reveal/[jobId]/route.ts:23) completed job-д 15 минутын signed URL олгохдоо тухайн хэрэглэгчийн reveal_level болон output-ийн зөвшөөрөгдөх хүрээг шалгахгүй. Restricted admin-д өөр админы director түвшний job өгөх mocked туршилтаар URL олгосон. [RLS policies](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/supabase/migrations/20260515160724_move_rls_helpers_to_private_schema.sql:119) reveal row-уудыг бүх admin-д, мөн storage-г өргөн хүрээнд нээсэн.

Засвар: API, DB/RLS, Storage гурван түвшинд output-ийн хүрээ ба үзэх эрхийг нийцүүлэх; sensitive output авахдаа fresh reauthentication шаардах. Шалгуур: хязгаарлагдмал admin өндөр эрхээр гаргасан output-ийг API болон шууд Storage замаар авч чадахгүй. Зөвхөн UI товч нуух нь хангалтгүй.

**5. Хугацаа дууссан reveal файлыг устгах зам нь файлын нэрийг алдана.**  
[retention SQL](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/supabase/migrations/20260906130200_alerts_retention_recovery.sql:125) output_path-ийг NULL болгосны дараа RETURNING-ээр шинэ NULL утгыг авна. Үүний улмаас [retention worker](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/lib/retention.ts:33) Storage-оос устгах path авч чадахгүй. Мөн DB мөр устсаны дараа Storage remove алдахад дараагийн sweep тэр файлыг дахин олж чадахгүй.

Кодоор тогтоосон; PostgreSQL runtime дээр давтаагүй. Засвар: хуучин path-ийг эхлээд durable deletion queue-д хадгалах; Storage устгал амжилттай болсны дараа queue-г дуусгах. Шалгуур: sweep хоёр удаа ажиллахад аюулгүй, Storage тасалдаж сэргэсэн ч orphan файл үлдэхгүй.

**6. Камер Disable болсон ч capture үргэлжилж болно.**  
[camera action](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/cameras/actions.ts:128) enabled=false болгосны дараа ML stop алдааг үл тооно. Actual action-ийн mocked туршилтаар stop унасан ч action амжилттай дууссан. [Supervisor](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/camera_worker.py:285) enabled утгыг дахин шалгахгүй, [boot recovery](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/storage.py:435) auto_resume төлвөөс сэргээнэ.

Засвар: хүссэн төлөв ба бодит төлөвийг тусад нь хадгалах; stop pending/failed төлөв харуулах; worker enabled/deleted төлөвтэй тогтмол нийцэх; stop батлагдтал retry хийх. Шалгуур: сүлжээ тасарсан үед Disable дарж, ML сэргээхэд камер дахин capture эхлүүлэхгүй.

**P2 — хэрэглээ ба өгөгдлийн үнэн зөв байдал**

| Асуудал | Баримт | Хийх ажил |
|---|---|---|
| Хүн илрээгүй камерыг offline гэж үздэг | [camera_health](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/supabase/migrations/20260907010000_camera_health_operator_scope.sql:57) нь сүүлийн face detection-оос 30 минут өнгөрөхөд offline болгоно | last_frame_at / heartbeat ашиглах; last detection-ийг тусдаа үзүүлэлт болгох |
| ML 503 хариу health dashboard дээр ногоон болно | [health route](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/api/health/ml/route.ts:14) upstream status шалгахгүй. Mocked 503 JSON → HTTP 200/status ok давтагдсан | HTTP status, response schema, readiness шалгах; shared probe ашиглах |
| ML удахад үндсэн хуудас хүлээнэ | [ML client](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/lib/ml-client.ts:28) нийтлэг fetch-д timeout байхгүй | Үйлдэл тус бүрд timeout/cancel, аюулгүй retry, partial error state |
| Viewer /live-ийн CCTV Start үйлдлээр стрийм үзэж чадахгүй; /grid тусдаа viewer урсгалтай | [Live page](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/live/page.tsx:37) role-ийг UI-д дамжуулахгүй; Start нь admin action дуудагдана | /grid-ийн viewer attachment логикийг ашиглаж, admin controls-ийг capability-аар хязгаарлах |
| Live нээхэд хувийн webcam зөвшөөрөл шууд асууна | [Device mount](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/live/live-view.tsx:133) getUserMedia дуудагдана | Registered CCTV-г анхдагч болгох; “Device camera ашиглах” үйлдлийн дараа permission авах |
| Хуучин бичлэгт хүрэх арга алга | [Playback query](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/playback/page.tsx:18) хамгийн сүүлийн 100 мөр, pagination/filter байхгүй | Camera/date filter, cursor pagination, total, clear-filter нэмэх |
| Тоон мэдээлэл дутуу эсвэл алдааг 0 гэж харуулна | [Dashboard trend](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/dashboard/page.tsx:94) 5000 мөрийн cap; [Analytics](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/analytics/page.tsx:45) severity 500 мөрөөр тоолно; playback/analytics query error-ийг ялгахгүй | DB aggregate ашиглах; empty, permission denied, service error-ийг ялгах; retry харуулах |
| Огнооны бүлэг ба дэлгэцийн цаг зөрнө | [Playback grouping](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/playback/page.tsx:42) UTC string-ийн өдрөөр бүлэглэнэ; formatDate KST ашиглана | Бүлэг, filter, тайлангийн timezone-ийг ижил болгох |
| Search үр дүнгээс бичлэг рүү очихгүй | [Search response](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/api/search/route.ts:68) recording_id-ийг буцаахгүй; карт нь холбоосгүй | Search/incident → recording + face/time deep link |
| Хувийн security settings зөвхөн admin-д | [Settings](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/settings/page.tsx:15) requireAdmin; viewer/auditor өөрийн passkey/2FA UI-д хүрэхгүй | Account settings ба system administration-ийг салгаж, own-account reauth дэмжих |
| Setup хэзээ ч 100% болохгүй | [Setup health step](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/setup/page.tsx:67) done:false тогтмол | Бодит health хариугаар гүйцэтгэл тооцох, бүх алхмыг орчуулах |
| Edge client-ийн event pipeline дутуу | [Edge agent](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/edge-agent/agent.py:185) camera_id илгээдэг; [detect endpoint](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/main.py:262) зөвхөн inference буцаадаг | Одоогоор experimental гэж тэмдэглэх; camera-scoped ingest, persist/match/ack нэмсний дараа operator flow-д гаргах |

**Эрхийн тусдаа integration шалгалт хэрэгтэй**

Custom TOTP болон session pin-ийг Next талд шалгадаг боловч [DB role helper](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/supabase/migrations/20260515160724_move_rls_helpers_to_private_schema.sql:25) зөвхөн role шалгана. Password-only Supabase JWT нь app-ийн 2FA gate-ээр орохгүйгээр өгөгдлийн policy-г хангах боломжтой гэсэн source түвшний өндөр ач холбогдолтой асуудал байна. Cloud policy/config parity болон жинхэнэ direct REST/Storage урсгалыг энэ аудит туршаагүй. Тусгаарласан staging дээр баталж, MFA proof-ийг өгөгдлийн түвшинд enforce хийх шаардлагатай.

[Recovery code regeneration](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/api/auth/totp/recovery/regenerate/route.ts:28) TOTP буруу оролтыг rate-limit хийхгүй. Тусгаарласан actual route-д 100 буруу хүсэлт → 100 verifier invocation, 100 HTTP 401, 0 HTTP 429 гарсан. Энэ нь нэвтэрсэн session шаарддаг. TOTP verification бүрд нийтлэг throttle ба failure audit ашиглах хэрэгтэй.

**Юуг хасах, нэгтгэх вэ**

[Navigation registry](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/lib/nav.ts:76) нийт 42 destination-той. Үндсэн цэсийг дараах зургаан хэсэг болгох саналтай:

| Үндсэн хэсэг | Одоо байгаа зүйлсийг нэгтгэх нь |
|---|---|
| Dashboard | Анхаарах incident, camera status, processing failures, сүүлийн ажиллагаа |
| Live | /grid default; single view ба /wall-ийг layout сонголт болгох |
| Recordings | /playback + Add footage/upload + processing status |
| Incidents | /alerts + /alerts-live; rules болон review дэд хэсэг |
| Search | Нүүр/камер/огноо → тодорхой бичлэг рүү шилжих |
| Administration | Cameras, users, approvals, audit, retention, backups, health, webhooks |

/compare, /eval, /ml-lab, /benchmarks, /edge-detect, /zk-reveal, /live-rtc-ийг үндсэн operator менюгээс гаргаж, optional Research/Lab хэсэгт хадгална. Жишээ нь [ML lab fusion](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/ml-lab/view.tsx:249) synthetic embedding ашигладаг. Capstone туршилтыг бүрэн устгах шаардлагагүй.

/active-learning ба /thresholds-ийг model tuning болгон нэгтгэх; DB monitor/performance/backup дэлгэцүүдийг Administration дотор байрлуулах. UI дээрх давхардсан ногоон success/health болон хэрэгжээгүй ажиллагааны амлалтыг арилгах.

**Юуг шинээр нэмэх вэ**

1. **Upload/processing төв:** queued → uploading → processing → ready/failed; retry; алдааны тайлбар; бичлэг рүү шууд орох.
2. **Camera diagnostics:** connect/last-frame/FPS/reconnect төлөв; эх үүсвэрийн нууц мэдээлэлгүй алдааны тайлбар.
3. **Incident workspace:** acknowledge/close/notes одоо байгаа; үүн дээр хариуцах ажилтан, хамаарах бичлэгийн цагийн холбоос, нэг timeline нэмэх.
4. **Role-д тохирсон onboarding ба account security:** тохируулга бодитоор дуусдаг байх; viewer/auditor өөрийн security settings-д хүрэх.
5. **Release-д заавал давах integration тестүүд:** account role, recording lifecycle, network/storage outage, reveal permission, retention recovery.

**Хэрэгжүүлэх дараалал ба дууссаны шалгуур**

| Үе | Ажлын багц | Дууссан гэж үзэх шалгуур |
|---|---|---|
| 1 | P1 эрх ба бичлэг/устгалын найдвартай байдал; direct data access шалгалт | Алдаатай эрх дээр access denied; storage тасалдахад бичлэг сэргээнэ; хугацаа дууссан файл retry-гаар устна; disabled камер сэрж ажиллахгүй |
| 2 | Нэг Live урсгал, зөв health, pagination, query error state | Viewer шууд ажиллаж буй камераа үзнэ; хоосон өрөө offline болохгүй; 101 дэх бичлэгийг олно |
| 3 | Зургаан үндсэн хэсэг, evidence deep link, account/settings, onboarding | Operator incident → холбогдох бичлэг → шийдвэрлэх урсгалыг цэс хайхгүй дуусгана |
| 4 | Processing төв, diagnostics, incident assignment, opt-in Lab | Pending/failed ажлыг хараад сэргээж чадна; Lab өдөр тутмын ажилд саад болохгүй |

[CI workflow](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/.github/workflows/ci.yml:74) Jest/Pytest/build ажиллуулдаг боловч Playwright job байхгүй. [Authenticated smoke](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/e2e/authed.spec.ts:16) credentials байхгүй үед skip хийнэ; 502-ыг зөвшөөрдөг assertion ч бий. Тиймээс одоогийн бүх тест ногоон байх нь recording/reveal/role урсгалын баталгаа болж чадахгүй. Staging-д admin + viewer + auditor, өндөр/бага reveal level, expired reauth, тасарсан Storage/ML нөхцөлүүдийг release gate болгох нь дараагийн бодит чанарын өсөлт болно.
