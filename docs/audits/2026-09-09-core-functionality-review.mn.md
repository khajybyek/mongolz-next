# aicctv.dev — үндсэн ажиллагааны шалгалт ба хөгжүүлэх дараалал

2026-09-09 · Шалгасан код: `690ea2a` · Хамрах хүрээ: камер → бичлэг → playback → хайлт/alert → review → reveal → хадгалалтын хугацаа/сэргээх.

## 2026-09-14 · Засварын хаалт

Энэ тайлангийн C1–C5, A1–A4, W1–W5 олдворуудын код болон schema засвар хэрэгжсэн. Доорх анхны хэсгүүдийг тухайн үеийн нотолгоо, шийдвэрийн түүх болгон хэвээр хадгалав.

| Багц | Хэрэгжсэн өөрчлөлт | Автомат баталгаа |
|---|---|---|
| Capture ба timeline (C1–C4) | Encoder/MP4 бүрэн шалгалт, source PTS-д тулгуурласан resampling, нүүрний `source_offset_sec`, 120 секундийн rolling segment, journal/recovery, persistent-volume ба багтаамжийн хамгаалалт | Бодит FFmpeg/OpenCV fixture, encoder kill/timeout, fractional FPS, journal restart, disk/mount тест |
| Upload/reveal тасралт (C5, A1) | Шифрлэсэн durable upload input, тогтвортой job/recording ID, retry/cancel, worker reconciliation; reveal-д DB lease token, renewal, таван оролдлогын хязгаар, хуучин worker үр дүн солихоос хамгаалах attempt path | Restart/store recreation, lost response, delivery retry, EOF/timeout, expired lease/reclaim/stale token тест |
| Reveal шийдвэр (A2) | 10–1000 тэмдэгтийн reason, өөрчлөгдөхгүй recording/method/target/time/threshold scope, upload reference-ийн job-bound encryption ба SHA-256 integrity, одоогийн requester/approver admin authority-г DB claim дээр дахин шалгах | Unit тест болон production-тэй ижил PostgreSQL schema дээр trigger/RPC/permission transaction |
| Операторын урсгал (W1–W5) | Archive/review pagination ба filter, зөв aggregate, search-ээс timestamp playback, update outcome, upload/reveal job progress/result/error, approval evidence, бодит freshness/readiness setup | 512 Jest тест, Next TypeScript/ESLint/build, public/login browser smoke |
| Ажиллагаа (A3, A4) | Retention backlog/error/oldest-age health ба drain worker; backup manifest row-count/truncation/checksum, incomplete backup-ийг restore preflight хориглох | Storage outage/backlog болон 50,001 мөрийн truncation/checksum unit тест |
| Log privacy | Python log redaction дээр нэмээд OpenCV-ийн native diagnostic сувгийг хааж, credential агуулсан camera URL provider log-д хэвлэгдэх замыг хориглов | Native log level regression test |

Production Supabase-д `20260911100000`–`20260911140000` migration-ууд 2026-09-14-нд apply хийгдэж, remote history таарч, schema lint алдаагүй болсон. Нэгдсэн regression: web 41 suite / 512 test, ML 382 test, migration lint 98 файл, SQL scope/approval/lease/fencing/permission assertion бүгд тэнцсэн.

Үлдсэн acceptance нь орчны ажил: Tailscale туннель одоогоор down тул зөвшөөрөгдсөн бодит камераар 30 минутын capture, disconnect/reconnect, deploy дундах kill/recovery, 24 цагийн soak-ийг энэ хаалтаар хийж чадаагүй. Current segment-ийн hard-kill алдагдал тохируулсан segment хугацаа хүртэл байж болно; completed segment durable. Backup-ийн incomplete экспорт одоо restore болохгүй боловч auth/object/key-г тусгаарласан орчинд бүхэлд нь сэргээх disaster-recovery rehearsal тусдаа шаардлагатай. Final suppression-оос өмнөх candidate Railway deploy-ийн OpenCV warning provider log-д credential агуулсан URL нэг удаа хэвлэсэн; historical log-ийг устсан гэж үзэх боломжгүй тул тухайн camera credential-ийг rotate хийх шаардлагатай.

## Дүгнэлт

Үндсэн хамгаалалт болон өмнөх засварууд кодод байна, автомат тестүүд тэнцсэн. Гэхдээ системийг өдөр тутмын CCTV ажиллагаанд бүрэн бэлэн гэж батлах болоогүй. Production-д идэвхтэй камер алга; тусгаарласан туршилтаар бичлэгийн хугацаа өөрчлөгдөх, гэмтсэн гаралтыг хадгалахад бэлэн гэж үзэх хоёр асуудлыг давтан гаргасан. Restart, урт бичлэг, upload-ийн эцсийн төлөв болон операторын ажлаа дуусгах урсгалд нэмэлт засвар хэрэгтэй.

Энэ нь одоогийн кодын функционал аудит. [Өмнөх аудитын](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/docs/audits/2026-09-08-full-audit.mn.md) хаалтын тэмдэглэлийг харгалзаж, засагдсан олдворуудыг нээлттэй асуудал гэж дахин тоолоогүй. Энэ удаа application код, cloud өгөгдөл, тохиргоог өөрчлөөгүй, deploy хийгээгүй.

## Баталгаажуулсан зүйл ба хязгаар

| Шалгалт | Үр дүн | Юуг батлахгүй вэ |
|---|---|---|
| Frontend/server Jest | 36 suite, 457 тест тэнцсэн | Бодит камераас эцсийн видео хүртэлх ажиллагаа |
| ML pytest | 331 тест тэнцсэн | Бодит камер, бодит нүүртэй видеоны чанар |
| Public/login Playwright | Desktop Chromium, mobile Safari нийлээд 28 тест тэнцсэн | Нэвтэрсний дараах playback/reveal |
| Migration lint | 93 migration цэвэр | Бүх хүснэгтийн бодит өгөгдөл зөв гэсэн баталгаа |
| Linked cloud migration history | Local ба remote 93 хувилбар 1:1 таарсан | Local DB, cloud DB хоёр ижил өгөгдөлтэй гэсэн үг биш |
| FFmpeg/OpenCV тусгаарласан туршилт | Хугацааны зөрүү бодитоор гарсан | Бодит нүүр илрүүлэлт ажиллуулаагүй |
| Encoder/finalize тусгаарласан туршилт | Broken pipe дарагдсан; invalid MP4 enqueue/deliver замд орсон | Delivery нь mock; cloud руу гэмтсэн файл байршуулаагүй |

Тестүүдийг энэ аудитын үеэр `690ea2a` дээр ажиллуулсан. Usage reset-ийн дараа HEAD өөрчлөгдөөгүйг шалгаж, public health-ийг дахин уншсан; бүх тестийг дахин давтаагүй.

Нэвтэрсэн E2E-д шаардлагатай viewer credentials байхгүй. Одоогийн [authed smoke](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/e2e/authed.spec.ts:16) тэдгээргүй үед алгасдаг; мөн бодит бус recording ID ашиглаж, “no 5xx” нэртэй шалгалтдаа `502` зөвшөөрдөг (:49). Тиймээс түүнийг бодит playback-ийн нотолгоо болгож болохгүй. Камер асаах, reveal хүсэлт явуулах, process-ийг production-д унтраах, retention устгал, backup restore энэ аудитад хийгдээгүй.

## Production-ийн ажиглалт

Deployment лавлагаа: Vercel `dpl_9buyPkjtLvCH7j2fnWJbRppdtNbT` — Ready, `aicctv.dev` alias; Railway `4276d6f4-0278-49eb-a632-f72deba8489f` — SUCCESS. Cloud DB project: `ulybenitqmqjfxtaregp`.

| Үзүүлэлт | Батлагдсан төлөв | Утга |
|---|---|---|
| Веб uptime | 2026-09-09 10:15 UTC: HTTP 200, DB/ML `ok` | Сервисүүд хариу өгч байна |
| ML root | 10:15 UTC: HTTP 200, `active_cameras: 0` | Камерын идэвхтэй capture алга |
| Tailscale | 10:15 UTC: `state: down`, `tailscale up exited 1` | Туннелийн холболтыг сэргээх шаардлагатай |
| Камерын бүртгэл | 05:30 UTC: 1 камер, enabled 1; camera_sessions 0 | Бүртгэлтэй байх нь capture ажиллаж байгааг илэрхийлэхгүй |
| Viewer камерын эрх | 05:30 UTC: camera_permissions 0 | Viewer-д харагдахгүй байх нь одоогийн зөв fail-closed зан төлөв |
| Бичлэг | 05:30 UTC: нийт 29; original-той 28, encrypted 28; ended_at хоосон 0 | Хуучин өгөгдөл байна |
| Бичлэгийн шинэ байдал | 05:30 UTC: сүүлийн 24 цагт 0; хамгийн шинэ started_at нь 2026-06-08 | Өнөөдрийн ingest ажилласны нотолгоо алга |
| Reveal | 05:30 UTC: 21, бүгд completed; reason хоосон 21; хамгийн шинэ нь 2026-05-18 | Хуучин үр дүн; шинэ approval урсгалыг батлахгүй |
| Хүлээгдсэн ажил | 05:30 UTC: stale reveal 0, retention pending/error 0 | Доорх restart/backlog эрсдэлүүд одоогийн production incident гэсэн үг биш |

Health эх сурвалж: [веб uptime](https://aicctv.dev/api/uptime), [ML health](https://mongolz-ml-production.up.railway.app/). Эдгээр нь камерын дүрс, хадгалсан файл, playback-ийг төгсгөл хүртэл шалгадаггүй. 05:30 UTC = 14:30 KST; 10:15 UTC = 19:15 KST.

DB тоонуудыг linked project-ийн hostname-тай тулгасан production credentials-ээр, зөвхөн metadata уншиж гаргасан. `.env.local` болон `ml-service/.env` localhost DB заадаг тул тэндхийн эхний лавлагааг production дүгнэлтээс хассан. Нууц түлхүүр, камерын URL, нүүрний өгөгдлийг тайланд оруулаагүй.

## Систем хэрхэн ажиллах ёстой вэ

1. Админ камер бүртгэж, холболт болон тухайн камер үзэх эрхийг шалгана. UI нь enabled, холбогдсон, frame ирж байгаа, хадгалж байгаа төлөвүүдийг ялгана.
2. Capture нь бичлэгийг богино хэсгүүдээр баталгаатай хадгална. Encoder/storage алдаа гарвал амжилт гэж үзэхгүй; restart-аас өмнөх баталгаажсан хэсэг үлдэнэ.
3. Playback нь эх видеоны хугацааг хадгалж, нүүр болон event-ийг зөв мөч дээр харуулна. Архивын бүх хадгалагдсан бичлэг огноо/камераар олддог байна.
4. Хайлт, alert нь шалгах шаардлагатай төстэй үр дүнг санал болгоно. Оператор тухайн мөчийн бичлэгийг үзэж, батлагдсан/буруу/тодорхойгүй гэж үнэлнэ. Similarity оноо нь хүний хэн болохыг дангаараа батлахгүй.
5. Reveal хүсэлтэд шалтгаан, зорилтот хүн/нүүр, бичлэг, хугацааны хүрээ байна. Өөр админ тухайн хүрээг ойлгож шийднэ; хүсэгч явц, алдаа, зөвшөөрөгдсөн үр дүнгээ олж чадна.
6. Үр дүнд эрх, хугацаа, watermark, audit үйлчилнэ. Хадгалалтын хугацаа дуусахад устгалын үлдэгдэл ба алдаа харагдана; backup-ийг тусдаа орчинд сэргээж нотолдог байна.

Live-ийн одоогийн бодлого тусдаа: [pipeline](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/recording_pipeline.py:1067) HLS-д маскгүй frame өгдөг; үзэх эрх хязгаарлагдсан, үзэлт бүртгэгддэг. Saved playback-ийн masking нь тусдаа хамгаалалт. Бүтээгдэхүүнээ “бүх видео үргэлж масклагдсан” гэж тайлбарлаж болохгүй. Privacy үндсэн зорилго бол viewer live-ийг анхнаасаа масктай болгож, raw live-ийг тодорхой эрхтэй үйлдэл болгох нь хөгжүүлэх санал; одоогийн шийдлийг санамсаргүй UI bug гэж ангилаагүй.

## Засах шаардлагатай одоогийн олдворууд

P1 — үндсэн ажиллагаа, бичлэгийн үнэн зөв байдал, хяналттай шийдвэрт шууд нөлөөлнө. P2 — өдөр тутмын ажил, өсөлт, ажиллагааны хяналтад нөлөөлнө. “Код” гэсэн нотолгоо нь ажиллах замыг эх кодоос тогтоосон бөгөөд production-д алдааг зориуд үүсгэсэн гэсэн үг биш.

### C1 · P1 · Encoder-ийн алдааг амжилттай бичлэг мэт хүлээн авах боломжтой

[`_write_safe`](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/recording_pipeline.py:1145) BrokenPipe/OSError-ийг дараад үргэлжлүүлдэг. Stop үеийн encoder wait (:803) exit code-ийг шалгахгүй; `_finalize` (:854) файлын доод хэмжээгээр шүүгээд `has_original`, `encrypted`, `ended_at` талбаруудтай spool руу өгнө.

**Давтан гаргасан:** broken pipe гадагш алдаа буцаагаагүй; 1 KB-аас том, MP4 биш өгөгдөл enqueue болон mock delivery замд орсон. Бодит Storage upload хийгээгүй.

**Засвар/шалгуур:** writer-ийн эрүүл мэндийг frame ирж байгаагаас тусад нь хянах; exit code, контейнер тайлагдах эсэх, бичигдсэн frame/хугацааг батлах. Disk full, encoder kill, дутуу файл бүр `failed/partial` болж, бэлэн playback гэж харагдахгүй байна.

### C2 · P1 · Удаан CCTV session зөвхөн зогсоход durable болдог

[Pipeline](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/recording_pipeline.py:531) session бүрт нэг файл нээж, original frame-ийг (:1070) бичнэ. Stop → finalize → encryption/spool (:816, :907) үед хадгалалтын дараагийн шатанд ордог. [Startup recovery](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/main.py:160) spool manifest сэргээдэг боловч finalize хийгдээгүй capture-д нөхөн сэргээх зам байхгүй. Анхдагч recording зам `/tmp/mongolz-recordings`.

**Кодын үр дагавар:** hard kill/redeploy үед одоогийн урт session бүхэлдээ алдагдах эрсдэлтэй; зогсоогүй session-ийн өмнөх хэсэг архивт бэлэн болохгүй. Идэвхтэй original файл шифрлэгдэхээсээ өмнө local disk дээр байна.

**Засвар/шалгуур:** 1–5 минутын rolling segment, хэсэг бүрийн шифрлэлт ба durable commit, orphan recovery, disk хэмжээний хязгаар. Урт capture дунд restart хийхэд баталгаажсан бүх segment тоглогдож, алдагдаж болох хамгийн их хугацаа тохируулсан нэг segment-ээс хэтрэхгүй байна.

### C3 · P1 · Upload-ийн видеоны хугацаа өөрчлөгдөнө

[FPS сонголт](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/recording_pipeline.py:966) `round(input_fps / 15)`-аар бүхэл тоон frame skip хийж, 15 FPS гаралттай бичдэг (:1052).

**Бодит encode/decode туршилт:** 25 FPS, 100 frame, 4.000 секунд оролт → 15 FPS, 50 frame, 3.333 секунд гаралт. Хугацаа 16.7% богиноссон буюу тоглуулах хурд 20% нэмэгдсэн. Detection ба DB mock; OpenCV/FFmpeg бодит.

**Засвар/шалгуур:** эх видеоны timestamp/PTS-д тулгуурласан resampling. 24/25/29.97/30/60 FPS болон variable frame rate fixture-д хугацааны алдаа тохиролцсон хүлцэл дотор, богино CFR fixture-д нэг output frame-ээс хэтрэхгүй байна.

### C4 · P1 · Нүүрний timeline эх видеоны цагийг хадгалахгүй

[Detection дуудлага](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/recording_pipeline.py:1078) frame-ийг source timestamp-гүй дамжуулдаг. [Storage insert](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/storage.py:246) source offset оруулахгүй; detected_at нь DB-ийн одоогийн цаг болдог. Харин [faces_in_recording](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/supabase/migrations/20260906120000_faces_in_recording_expose_seal.sql:38) `detected_at - recording.started_at`-аас видеоны offset гаргана.

**Кодын үр дагавар:** realtime-ээс хурдан/удаан боловсруулсан upload-ийн нүүр буруу мөч рүү холбогдож, overlay, seek, хугацаагаар reveal хийх хүрээ зөрөх боломжтой. Бодит нүүртэй E2E-ээр одоогоор хэмжээгүй.

**Засвар/шалгуур:** source offset/captured_at ба боловсруулсан цагийг салгах; PTS-ийг detection-оос DB хүртэл хадгалах. Урьдчилан мэдэгдсэн мөчид нүүртэй fixture-ийг өөр өөр боловсруулалтын хурдаар ажиллуулахад ижил видео offset гарна. C3-тай нэг багц болгоно.

### C5 · P1 · Upload хүлээн авсан нь боловсруулж дууссан гэсэн үг биш

[Upload processing](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/main.py:925) local түр файл, in-process task ашигладаг. 300 секундийн timeout (:949) дараа session-ийг stop/finalize хийж completion зам руу орно; input-ийг цэвэрлэнэ. Durable upload job, төлөвийн polling/retry байхгүй. [Live UI](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/live/live-view.tsx:933) HTTP хариу ирэхэд upload амжилтыг харуулж сонгосон файлаа цэвэрлэдэг.

**Кодын үр дагавар:** restart үед ажил алдагдана; урт боловсруулалт дутуу гаралттай дууссан мэт болох боломжтой. 300 секундийн production туршилт хийгээгүй.

**Засвар/шалгуур:** input-ийг durable хадгалсны дараа job ID өгөх; accepted/queued/processing/ready/failed/partial төлөв, явц, retry. Зөвхөн эх файл бүрэн боловсруулагдсан EOF болон гаралт баталгаажсан үед ready болгоно. Timeout, restart, давтан хүсэлтийн fixture-үүдэд үр дүн алга болохгүй, давхар recording үүсэхгүй байна.

### A1 · P1 · Restart-аар reveal ажил хүлээгдсэн төлөвт үлдэж болно

[`main.py`](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/main.py:601) reveal-ийг process дотор эхлүүлнэ. Startup (:164) дээр ганц удаа дуудах [recovery](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/ml-service/storage.py:623) нь зөвхөн 30 минутаас хуучин processing ажлыг хамарна. Queued эсвэл 5 минутын өмнө эхэлсэн processing ажил restart-аар task-аа алдаад энэ шалгалтаас үлдэнэ.

**Засвар/шалгуур:** durable queue/lease, давтагдах reconciliation, idempotent retry. Queued болон processing үед worker-ийг унтраахад ажил өөр deploy шаардахгүйгээр нэг удаа дуусах эсвэл тайлбартай failure авна. Одоогийн cloud snapshot-д stale reveal 0 байсан.

### A2 · P1 · Reveal зөвшөөрөхөд шалтгаан, нотолгооны хүрээ дутуу

[Хүсэлт үүсгэх route](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/api/reveal/start/route.ts:185) reason хадгалахгүй; modal түүнийг асуухгүй. [Approval page](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/reveal-approvals/page.tsx:50) зорилтот нүүр болон бичлэгийн мэдээлэл татахгүй; богино ID, хүсэгч, threshold/хугацаа үзүүлэх боловч нотолгоо руу холбоосгүй.

Өөр админ зөвшөөрөх техникийн хяналт байна. Гэвч шийдвэр гаргах хүн юуг, яагаад ил гаргаж байгааг энэ хуудаснаас бүрэн ойлгохгүй.

**Засвар/шалгуур:** заавал reason, шаардлагатай бол case reference; өөрчлөгдөхгүй request scope; эрхтэй masked preview ба recording холбоос; бүх бичлэг хамрах эсэхийг ил тод харуулах. Хоёр дахь админ зөвхөн approval дэлгэц ашиглан хүрээг ойлгож approve/reject хийж чадна.

### W1 · P1 · Архив зөвхөн хамгийн шинэ 100 бичлэгийг харуулдаг

[Playback page](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/playback/page.tsx:18) 100 бичлэгээр хязгаарлана; огноо/камерын шүүлтүүр, pagination байхгүй. Нүүрний тоог (:26) raw rows-оос тоолдог тул API-ийн row cap-д хүрвэл дутуу тоологдоно. Query алдаа тусдаа харагдахгүй.

**Засвар/шалгуур:** серверийн огноо/камер шүүлтүүр, cursor pagination, grouped aggregate, error/empty төлөв ялгах. 101 дэх бичлэг архивоос олдоно; 1,000-аас олон нүүрийн тоо зөв байна; DB алдаа “бичлэг алга” болохгүй.

### W2 · P1 · Review backlog нуугдаж, амжилтгүй update амжилттай мэт бүртгэгдэнэ

[Review query](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/review/page.tsx:17) эхлээд шинэ 100 нүүр аваад дараа нь reviewed-ийг хасдаг. Шинэ 100 нь бүгд reviewed бол хуучин шалгаагүй ажлууд байхад queue хоосон харагдана. [Update action](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/review/actions.ts:16) DB алдааг шалгахгүйгээр FACE_REVIEW audit бичдэг.

**Засвар/шалгуур:** unreviewed нөхцөлийг DB query-д limit-ээс өмнө тавих; pagination, яг үлдсэн тоо; matched update болон алдааг шалгаж UI-д outcome буцаах. Update унавал success audit үүсэхгүй, оператор дахин оролдож чадна.

### W3 · P2 · Хайлт бичлэгийн тухайн мөч рүү хүргэдэггүй

[Search API](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/api/search/route.ts:63) recording_id сонгодог ч enrichment (:74) үед хариунаас хасдаг. [Хайлтын UI](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/search/search-form.tsx:108) filename-ийг холбоосгүй текст болгоно.

**Засвар/шалгуур:** recording_id хадгалж `/playback/{id}?face={faceId}` рүү холбоно; footage устсан/хугацаа дууссан төлөвийг тайлбарлана. Энэ загвар suspect detail дээр аль хэдийн бий. Хайлтын candidate-оос зөв мөч рүү очиж оператор үнэлгээ хийж чадна; C4 хугацааны засвартай хамт батална.

### W4 · P2 · Jobs хуудас үр дүн, алдаа, дараагийн үйлдэлд хүргэдэггүй

[Jobs query](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/jobs/page.tsx:25) recording/error талбар авдаг ч хүснэгт (:96) богино ID, method, state, хүсэгч, огноо л харуулна. Үр дүн, playback, approval холбоос, алдааны тайлбар, progress refresh байхгүй. [Мэдэгдэл](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/lib/notify.ts:130) хэрэглэгчийг энд ирүүлдэг. Upload jobs ороогүй.

**Засвар/шалгуур:** job detail, шинэчлэгддэг явц, зөвшөөрөгдсөн үр дүн, тайлбартай failure, аюулгүй retry ба recording/approval холбоос. Мэдэгдлээс орсон хэрэглэгч хүсэлтийнхээ үр дүнг олж чадна.

### W5 · P2 · Setup өнөөдрийн ажиллагааг хэмжихгүй

[Setup](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/(app)/setup/page.tsx:39) түүхэн camera/recording/face мөр байвал done болгоно; health (:69) нь тогтмол false. Иймээс хуучин өгөгдөл ажиллаж байгаа мэт сэтгэгдэл өгнө, нөгөө талаас бүх алхам completed болох боломжгүй.

**Засвар/шалгуур:** камерын холболт, сүүлийн амжилттай ingest/хадгалалт/playback, dependency төлөв, last-checked timestamp болон бодит алдааны шалтгаан. Туннель унасан өнөөгийн төлөвт setup нь бэлэн гэж дүгнэхгүй; бүх шалгалт тэнцвэл completed болно.

### A3 · P2 · Retention-ийн устгал хоцроход cron хариу амжилт гэж харагдаж болно

[`runRetentionSweep`](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/lib/retention.ts:26) invocation бүрт дээд тал нь 250 × 4 = 1,000 объект claim хийнэ; cron өдөрт нэг удаа. SQL row retirement энэ тоогоор хязгаарлагдахгүй. Storage removal error summary-д үлдэх боловч [cron route](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/api/cron/retention-sweep/route.ts:18) `status: ok` буцаана. Durable queue, lease, retry нь өмнө засагдсан; тэр засварыг үгүйсгээгүй.

**Засвар/шалгуур:** pending/error/oldest-age, degraded health ба actionable alert; ingest-тэй уялдсан drain хүчин чадал. Storage outage туршилтад degraded гарч, сэргэхэд 1,000-аас их backlog бүрэн цэвэрлэгдэнэ. Одоогийн snapshot-д backlog 0.

### A4 · P2 · Том backup дутуу экспортлогдсон ч restore preflight зөвшөөрч болно

[Backup export](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/app/api/admin/backup/route.ts:165) хүснэгт бүрт 50,000 мөрийн cap-тай; object manifest дээр (:295) truncation мэдээллийг хадгалахгүй. [Restore preflight](/Users/khajybyek/Desktop/DKMA/SCH/3B-26-1/capstone/mongolz-next/scripts/restore-from-backup.ts:165) truncated export-ийг хориглохгүй.

**Засвар/шалгуур:** бүрэн pagination/snapshot эсвэл incomplete export-ийг сэргээхээс татгалзах; count/checksum баталгаажуулах. 50,001 мөртэй fixture-г бүрэн backup гэж үзэхгүй байна.

Өмнөх missing-column/folder асуудлууд засагдсан. Гэхдээ одоогийн row/path export өөрөө encrypted blob bytes, auth credentials-ийг бүхэлд нь нөөцөлсөн гэсэн үг биш. Backup verify нь одоогийн эх storage-ийн зарим бичлэг тайлагдахыг шалгадаг; тусгаарласан орчинд object + auth + key recovery хийсэн disaster recovery туршилтыг орлохгүй.

## Хадгалж үлдэх сайн суурь

- Заавал app TOTP, fresh step-up, reveal level-ийн одоогийн эрхийн шалгалт, өөрийн хүсэлтийг зөвшөөрөхгүй байх, давхар approval-оос хамгаалах өөрчлөлтүүд байна.
- Analytics SQL aggregate болон denied/error төлөвтэй; alerts-ийн нийт тоо, давтагдсан тоо, зэрэг шинэчлэх хамгаалалт засагдсан.
- Suspect detail дээр secure evidence болон playback холбоос байна. `/my-data` нь зөвхөн админд хамаарахгүй болсон.
- Retention-ийн durable queue болон spool recovery байгаа нь цаашдын capture/job найдвартай байдлын суурь болно.

Data-tier MFA нь AMR-д тулгуурласан, missing/unreadable AMR-д permissive байхыг зөвшөөрсөн одоогийн загвар; strict native `aal2` гэж нэрлэж болохгүй. Үүнийг дараагийн архитектурын ажилд авч үзэж болно, өмнөх password-only олдвор өөрчлөгдөөгүй хэвээр гэж энэ аудит дүгнээгүй. Viewer-ийн personal MFA/passkey/push settings тусдаа surface дутуу хэвээр; `/my-data` засвартай андуурахгүй.

## Хэрэгжүүлэх дараалал

| Багц | Хийх ажил | Дууссаныг батлах шалгуур |
|---|---|---|
| 1. Бичлэгийн үнэн зөв байдал | C1, C3, C4: encoder validation, зөв PTS/duration, source timeline | Invalid/partial файл ready болохгүй; FPS fixture хугацаагаа хадгална; нүүр зөв мөчид холбогдоно |
| 2. Тасралт ба restart | C2, C5, A1: rolling segment, durable upload/reveal jobs, retry/reconciliation | Worker restart-аар баталгаажсан бичлэг алдагдахгүй; job эцсийн төлөвт хүрнэ; давхардсан үр дүнгүй |
| Зэрэгцээ operational ажил | Туннелийн enrollment/холболт сэргээх; хэрэгцээтэй камерын эрх оноох; camera session тохируулах | Бодит камераар 30 минут capture, disconnect/reconnect, зөв эрхтэй live/playback; admin ба viewer тусдаа шалгалт |
| 3. Операторын бүрэн урсгал | W1, W3 → W2 → A2, W4, W5 | Архив → хайлт → timestamp playback → review → reasoned approval → result нэг мөр дуусна |
| 4. Ажиллагааны баталгаа | A3, A4; readiness metrics; authenticated E2E | Storage outage/backlog, бүрэн restore, бодит recording/reveal/expiry тест тэнцэнэ; `502` success гэж тооцохгүй |
| 5. Release acceptance | Доорх бодит end-to-end болон 24 цагийн туршилт | Шалгалтын нотолгоотой release checklist; тасалдал, алдагдал, буруу цаг, чимээгүй failure үлдээгүй |

Багц 1 нь эхний кодын өөрчлөлт байх ёстой: evidence-ийн хугацаа, бүрэн бүтэн байдал буруу байхад шинэ dashboard эсвэл AI боломж нэмэх нь үндсэн асуудлыг шийдэхгүй. Камерын operational ажлыг энэ кодын багцтай зэрэг явуулж болно.

### Бүрэн ажиллаж байгааг хүлээн авах туршилт

| Урсгал | Тэнцэх нөхцөл |
|---|---|
| Камер ба эрх | Хоёр ялгаатай эрхтэй хэрэглэгч; зөв камер харагдана, зөвшөөрөлгүй камер харагдахгүй; enabled ба recording төлөв ялгаатай |
| Live → archive | 30 минутын бичлэгийн өмнөх сегмент session зогсоохгүйгээр тоглоно; камер тасраад эргэн холбогдоно |
| Upload | FPS/VFR, урт файл, эвдэрсэн файл, duplicate request; зөв хугацаа, ойлгомжтой progress/failure, durable үр дүн |
| Playback masking | Мэдэгдсэн нүүртэй зөвшөөрөгдсөн fixture дээр seek, overlay, masking, source timestamp; алдаанд raw fallback үүсэхгүй |
| Search → review | 101+ бичлэг, 1,000+ нүүр, хуучин unreviewed; зөв холбоос, тоо, update outcome |
| Reveal | Хоёр өөр админ; reason/scope ойлгомжтой; self-approval хоригтой; output → watermark → expiry; queued/processing restart сэргэлт |
| Retention/restore | Outage/backlog мэдээлэгдэнэ; объект үнэхээр устсан нь шалгагдана; тусдаа орчинд DB, object, auth/key recovery батлагдана |
| 24 цагийн тогтвортой ажил | Capture freshness, dropped frames, writer/storage errors, disk/memory, queue age хэмжигдэнэ; төлөвлөгдсөн restart-ийн үр дүн бүртгэгдэнэ |
| ML-ийн чанар | Зөвшөөрөлтэй, төлөөлөхуйц өдөр/шөнө/өнцөгтэй өгөгдөл; false positive, missed detection, хүний review үр дүнг хэмжинэ; threshold-ийг таамгаар батлахгүй |

## Юу нэмэх, юуг түр хойшлуулах вэ

**Эхлээд нэмэх:** огноо/камерын архивын шүүлтүүр; evidence рүү шууд холбоос; үнэн зөв queue/progress/error; approval reason/scope; камерын хамгийн сүүлийн амжилттай frame/segment болон storage backlog-ийн төлөв. Эдгээр нь одоо байгаа үндсэн урсгалыг дуусгана.

**Дараагийн шинэ боломж:** үндсэн шалгуур тэнцсэний дараа incident workspace нэмэх. Alert, нүүрний candidate, эргэн тойрны masked clip-ийг нэг хэрэгт холбоод хариуцагч, батлагдсан/буруу/тодорхойгүй үнэлгээ, тэмдэглэл, хаалтын түүхтэй болгоно. Дараа нь эрхтэй evidence export ба хүлээн авагчид ойлгомжтой audit trail хөгжүүлж болно.

**Хасах/өөрчлөх зан төлөв:** upload receipt-ийг processing success мэт ойлгуулах; DB алдааг хоосон жагсаалт болгох; зөвхөн богино UUID үзүүлэх; хуучин өгөгдлөөр өнөөдрийн readiness дүгнэх; маскгүй live-ийг бүхэлдээ masked систем гэж тайлбарлах. Одоогийн модуль, өгөгдлийг энэ аудитын үндсэн дээр устгах шаардлагагүй.

**Түр хойшлуулах:** дахин navigation redesign, animation/өнгөний том өөрчлөлт, нэмэлт dashboard, AI chat, ReID/heatmap-ийг үндсэн урсгал болгох, том SLA/multi-tenant систем. Эхлээд capture → evidence → хүний шийдвэр гэсэн нэг ажлыг найдвартай дуусгадаг болгоно.

## Давтах команд ба туршилтын тэмдэглэл

Frontend: `npm test -- --runInBand`.

Migration: `npm run lint:migrations`; cloud history: `supabase migration list --linked`.

Public/login: `npx playwright test e2e/public.spec.ts e2e/login-ux.spec.ts --workers=2 --reporter=dot`.

ML: `ml-service` directory-д доорх dummy environment-ээр ажиллуулсан; production credentials ашиглаагүй.

```sh
SUPABASE_URL=https://placeholder.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=placeholder \
ML_SERVICE_TOKEN=test-token \
ML_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
SENTRY_DSN='' OTEL_EXPORTER_OTLP_ENDPOINT='' \
HLS_DIR=/tmp/mongolz-functional-review \
./venv/bin/python -m pytest tests -q
```

Synthetic capture-ийн хэмжилт:

```json
{"source":{"fps":25.0,"frames":100.0,"seconds":4.0},"output":{"fps":15.0,"frames":50.0,"seconds":3.3333333333333335},"recorded_frames":50}
{"case":"broken encoder write","raised":false}
{"case":"invalid >1KB original finalize","enqueued":true,"mock_delivery_called":true,"has_original":true,"duration_sec":3,"ended_at_present":true}
```

Synthetic input нь 128×96 хэмжээтэй, NumPy-аар үүсгэсэн 100 frame; `RecordingSession._run()` ба бодит FFmpeg encoder ашигласан. Detection, DB, invalid-file delivery mock. Түр клипүүд TemporaryDirectory-д үүсээд устсан; production footage ашиглаагүй.
