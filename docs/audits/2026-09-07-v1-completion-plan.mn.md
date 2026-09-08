# MONGOLZ v1 — бүрэн ажиллагаанд хүргэх төлөвлөгөө

2026-09-07 · Production deploy-ийн дараах кодын үнэлгээ.

## Зорилтот хүрээ

Эхний бүрэн хувилбар: нэг байгууллагын камерын хяналт, бичлэг, incident шийдвэрлэлт, эрхтэй reveal, аудит болон сэргээх ажиллагааг өдөр тутам ашиглаж болох v1. Олон байгууллага, төлбөр тооцоо, өргөн хэмжээний edge deployment-ийг дараагийн хувилбарт төлөвлөнө.

Бүтэн хэрэглэгчийн урсгал:

**Камер холбох → Live үзэх → бичлэг хадгалах → incident/search-ээс тухайн мөчийг олох → зөвшөөрөлтэй reveal → шийдвэрлэх → аудит/retention.**

Энэ баримт хэрэгжүүлэх ажлын дараалал; доорх үлдсэн ажлуудыг хийсэн гэж үзэхгүй. Хуучин product-debug-review тайлангийн засварын өмнөх бүх олдворыг unresolved гэж дахин тооцохгүй.

2026-09-08 шинэчлэлт: эхний багцад 1.1-ийн cold playback болон 1.2-ийн privacy lookup/session-pin алдааг зөвшөөрдөг замуудыг зассан. Python 210, Jest 222 тест, lint/typecheck, Linux FFmpeg endpoint smoke тэнцсэн. Authentication proof-ийг network pinning-ээс салгах, DB түвшний MFA, камерын холболт болон дараагийн багцууд үлдсэн. Release-ийн дэлгэрэнгүйг [эхний багцын бүртгэл](2026-09-08-first-batch-release.mn.md)-ээс үзнэ.

2026-09-08 14:14 UTC: ажил түр зогссон хооронд нэмэгдсэн commit-ууд data-tier MFA, atomic credential throttle, backup artifact, хувийн өгөгдөл унших audit хамгаалалт оруулсан. Доорх 2026-09-07 оношилгоог түүхэн суурь гэж уншина; эдгээр бүх зүйлийг одоо ч огт хэрэгжээгүй гэж үзэхгүй. Хамгийн сүүлийн production төлөв болон дахин ажиллуулсан шалгалтыг дээрх release бүртгэлд шинэчилсэн. Бодит камерын урсгал болон restore drill-ийн acceptance нотолгоо шаардлагатай хэвээр.

## Баталгаажсан суурь ба хязгаар

- Vercel frontend aicctv.dev дээр deploy болсон; Railway deployment `6bbde792-1287-4477-aa89-991a70da74e3` SUCCESS/Online; Supabase-ийн 3 шинэ migration apply болсон.
- Энэ үнэлгээний үеэр `/api/uptime` DB/ML хоёуланг `ok:true` гэж буцаасан. Энэ нь бодит CCTV, нэвтэрсэн хэрэглэгчийн recording/reveal урсгалын баталгаа биш.
- Browser upload ack/retry, encrypted delivery spool, reveal-output authority, durable retention deletion queue, disabled-camera reconciliation, ML health HTTP/schema validation, explicit webcam permission кодод орж deploy болсон.
- Өмнөх шалгалтын бүртгэл: Jest 210, Python ML 197; migration lint 84, retention SQL 31 assertion; нийтийн Playwright 82. Энэ үнэлгээ тэдгээрийг дахин ажиллуулаагүй.
- Production-ийн хамгийн сүүлийн шалгасан startup log-д Tailscale auth key invalid байсан. Энэ удаа key солих эсвэл жинхэнэ RTSP camera session эхлүүлэх ажиллагаа хийгдээгүй.

## 1. Эхлээд playback, нууцлал, камерын холболтын саадыг арилгах

### 1.1 Cache-гүй playback-ийн FFmpeg алдаа

`ml-service/main.py:709` renderer-т `UUID.mp4.part` зам өгдөг. `ml-service/view_renderer.py:68` output формат тодорхой заадаггүй. Ижил FFmpeg командыг synthetic input-тэй локал дээр шалгахад `.mp4` амжилттай, `.mp4.part` нь output формат танихгүй алдаагаар дууссан. Renderer BrokenPipe-ийг бариад encoder exit status шалгахгүй буцдаг. Production дээр тухайн алдааг давтаагүй.

Хийх: MP4 output форматыг заах; encoder failure/timeout-ийг дамжуулах; бүрэн, уншигдах output-ийг батлаад cache-д publish хийх. Actual endpoint-ийн `.part` замаар regression тест нэмэх.

Дууссан шалгуур: cold/warm playback хоёул тоглоно; зориуд encoder унагаахад failed төлөв гарч, дутуу cache үйлчлэгдэхгүй.

### 1.2 Нууцлалын дүрэм уншигдахгүй үед reveal зогсдог байх

`ml-service/reveal_job.py:545` дахь `_load_privacy_zones()` query exception-ийг хоосон zone list болгон буцаадаг. Caller үүнийг ашиглаж rendering үргэлжлүүлдэг бөгөөд zone list хоосон үед `never_reveal` filtering хийгдэхгүй (`:503`). Кодын failure path батлагдсан; production дээрх тохиолдол батлагдаагүй.

Хийх: zone байхгүй амжилттай хариу болон lookup failure-ийг ялгах; failure дээр reveal-ийг зогсоох/дахин оролдох. `lib/supabase/auth.ts:64` дахь session-pin дотоод алдааг зөвшөөрдөг замыг мөн засах; authentication proof болон network pinning-ийн үүргийг салгах.

Дууссан шалгуур: privacy-rule lookup, authentication-proof шалгалт алдахад sensitive output гарахгүй; хэрэглэгчид сэргээх боломжтой тайлбар харагдана.

### 1.3 MFA ба өгөгдлийн эрхийг staging дээр тулгах

Custom TOTP proof Next cookie-д, DB role helper нь role/auth.uid дээр тулгуурладаг. Password-only JWT-ээр шууд Supabase REST/Storage хандалтын хамгаалалт хангалттай эсэхийг staging integration-ээр тогтоох шаардлагатай; үүнийг production exploit болсон гэж дүгнээгүй. Recovery-code regeneration route-д shared throttle байхгүй (`app/api/auth/totp/recovery/regenerate/route.ts:28`).

Хийх: admin/viewer/auditor, өндөр/бага reveal level, expired/revoked access, password-only session гэсэн матриц; API, direct REST, Storage зам бүрийг шалгах. DB түвшинд баталгааждаг MFA proof enforce хийх загварыг сонгож хэрэгжүүлэх. TOTP verification бүрд зэрэг хүсэлтээр тойрох боломжгүй atomic throttle ба failure audit оруулах; throttle backend алдахад хамгаалалт алга болохгүй байх.

TOTP setup-ийн `app/api/auth/totp/verify/route.ts:60` profile update-ийн алдааг шалгахгүйгээр enabled=true болон recovery codes буцаадаг. DB persistence амжилттай болсон үед л setup success харуулах; reload/recovery login-оор батлах.

Дууссан шалгуур: дутуу second factor/эрхээр хамгаалагдсан өгөгдөл унших, өөрчлөх боломжгүй; шинэ reveal-output authority-ийн хамгаалалт хэвээр; хэт олон TOTP оролдлого хязгаарлагдана.

### 1.4 Бодит камерын холболтыг сэргээх

Хийх: хүчинтэй Tailscale enrollment, route/forwarder шалгалт, зөвшөөрөгдсөн туршилтын CCTV-ээс бодит frame авах. API liveness, tunnel readiness, camera frame, recording төлөвийг тусад нь харуулах.

Дууссан шалгуур: 30 минутын туршилтын бичлэг бүрэн хадгалагдан тоглоно; богино сүлжээний тасалдлаас reconnect хийнэ; tunnel тасарвал degraded гэж харагдана. Энэ 30 минут нь санал болгосон acceptance test, одоо хэмжсэн үр дүн биш.

## 2. Хүлээн авсан upload-оос бэлэн бичлэг хүртэл найдвартай болгох

Delivery spool нь боловсруулж дууссан artifact-ийг хүргэх алдаанаас хамгаалж байгаа. Харин incoming upload `/tmp`, completed acknowledgement санах ойд, processing нь process доторх task хэвээр (`ml-service/main.py:836`, `:906`). Иймээс upload accepted болсон даруйд process restart хийх тохиолдол тусдаа ажил.

Хийх:

- Хүлээн авсан input-ийг encrypted durable storage-д хадгалах; хадгалсан баталгааны дараа acknowledgement өгөх.
- DB-д job state, давхар ажиллуулахгүй claim/lease, progress, retry, cancel болон terminal result хадгалах.
- Одоогийн `/jobs` зөвхөн reveal_jobs харуулдаг тул recording upload/processing/spool ажлуудыг хэрэглэгчид үзүүлэх.
- View cache-д TTL/size limit; download/decrypt-ээс өмнө concurrency хязгаар; spool pending bytes, oldest age, free disk хэмжих.
- Disk дүүрэхээс өмнө alert гаргах, шинэ capture хүлээн авах бодлогыг тодорхой болгох.

Дууссан шалгуур: сүүлийн chunk ack-ийн дараа болон processing дунд restart хийхэд accepted input алдагдахгүй; retry нэг л recording үүсгэнэ; queued/processing/ready/failed төлөв харагдана; Storage outage сэргээхэд queue цэвэрлэгдэнэ.

## 3. Операторын өдөр тутмын ажлыг дуусгах

| Ажил | Одоогийн бодит дутуу тал | Дууссан шалгуур |
|---|---|---|
| Нэг Live урсгал | `/live` Start нь admin action; `/grid` viewer attachment дэмждэг | Viewer өөрийн ажиллаж буй камерыг үзнэ; single/grid/wall нэг хэсгийн layout болно |
| Камерын зөв төлөв | camera_health нь last face detection-д түшиглэдэг | last_frame_at/heartbeat ашиглана; хоосон өрөө offline болохгүй; detection тусдаа үзүүлэлт |
| Бичлэгийн архив | `/playback` сүүлийн 100; filter/pagination байхгүй | Camera/date/status filter, cursor pagination; 101 дэх бичлэг олдоно |
| Search → бичлэг | API recording_id татдаг ч response-д орхино | Үр дүнгээс тухайн recording/time offset нэг үйлдлээр нээгдэнэ |
| Incident workspace | Acknowledge/close/notes байгаа; evidence/assignment дутуу | Хариуцагч, evidence time link, нэг timeline; шийдвэрлэх урсгал бүтэн |
| Account security | Settings admin-only; auditor middleware зөвхөн audit руу явуулна | Бүх role өөрийн password/2FA/passkey settings-д зохих эрхээр хүрнэ |
| Setup/орчуулга | Health step тогтмол done:false; hardcoded EN | Бодит шалгалтаар 100% хүрнэ; MN/EN/KR; watchlist setup заавал биш |
| Үнэн зөв тоо/алдаа | Хязгаартай rows-оор aggregate; зарим query failure empty/0 болно | DB aggregate, нэг timezone; empty/unknown/error/denied ялгаатай, retry-тай |

## 4. Цэсийг нэгтгэж, туршилтын хэсгийг тусгаарлах

42 navigation destination-ийг зургаан үндсэн ажлын хэсэгт зохион байгуулна:

| Үндсэн хэсэг | Агуулга |
|---|---|
| Dashboard | Анхаарах incident, бодит камерын төлөв, processing failure |
| Live | Single/grid/wall layout |
| Recordings | Архив, upload, processing state |
| Incidents | Alerts/realtime, assignment, review, evidence |
| Search | Нүүр/камер/огноо → бичлэгийн мөч |
| Administration | Cameras, users, reveal approvals, audit, health, retention, backup, integrations |

`/compare`, `/eval`, `/ml-lab`, `/benchmarks`, `/edge-detect`, `/zk-reveal`, `/live-rtc`-ийг optional Research/Lab-д байрлуулна. Capstone-ийн судалгааны материалыг хадгалж, synthetic simulation, self-loop demo болон ажиллагаанд орсон боломжийг зөв тэмдэглэнэ. Active learning + thresholds-ийг Model tuning болгон нэгтгэнэ.

Бодит баримттай нийцүүлэх зүйл: README-ийн end-to-end encryption гэх нэршлийг сервер plaintext тайлдаг архитектуртай тулгах; README-ийн Railway region, migration/test count-ийг шинэчлэх; backup/RTO амлалтыг хэмжсэн баримтаар шинэчлэх.

## 5. Backup, release, мониторингийг баталгаатай болгох

- Backup route table export-ийг 50K rows, storage list-ийг эхний 1K entry-ээр хязгаарладаг; blob bytes агуулахгүй. Restore script blob/auth material сэргээхгүй. Одоогийн export/decrypt check-ийг бүрэн disaster recovery гэж үзэхгүй.
- Бүх schema/object coverage, pagination, тусдаа encrypted object backup, key recovery procedure хэрэгжүүлэх. Тусгаарласан хоосон project-д restore хийж audit chain, counts, user recovery, хуучин/шинэ recording decrypt/playback шалгах. RPO/RTO-г тэр туршилтаар хэмжих.
- SLO/backup check-д query failure, хэмжилтгүй төлөв, бодит healthy-г ялгах. Тестээр бодит алдаа үүсгэхэд мэдэгдэл очдогийг staging дээр батлах.
- Цэвэр checkout-оос build/deploy хийдэг release урсгал; ижил commit/version-ийн ML ба frontend; migration parity, smoke, rollback procedure. Local cache/venv зөөх шаардлагагүй болгох.
- Frontend/Supabase Singapore, сүүлийн Railway US West гэсэн deployment мэдээллийг тулгаж, cross-service latency/egress хэмжсэний дараа region сонгох. Region-ийг шууд өөрчлөхгүй; volume/data нүүлгэлтийг тооцно.

## 6. Release gate ба v1-ийн дууссан шалгуур

Одоогийн CI-д lint/build/Jest/Pytest байгаа; Playwright болон бодит DB/RLS integration job байхгүй. `e2e/authed.spec.ts:16` credentials байхгүй үед skip хийж, `:44` зарим probe-д 502 зөвшөөрдөг. Critical success path ийм шалгалтаар батлагдахгүй.

Шинэ release gate:

1. Staging fixture-тай admin/viewer/auditor болон reveal-level матриц; дутуу тохиргоотой үед critical suite skip болж green болохгүй.
2. Камер → capture → encrypted recording → cold/warm playback → request/approve/reveal → expire/delete урсгал.
3. Storage/network outage, upload/processing restart, disabled camera restart, privacy query failure, эрх цуцлалт.
4. Docker дотор production FFmpeg/entrypoint-ийн integration; шинэ migration-уудыг жинхэнэ DB/RLS-тэй шалгах.
5. Clean checkout release, post-deploy read-only smoke, rollback, тусгаарласан backup restore drill.
6. Зорилтот камерын тоо/нягтрал/FPS-ээ тогтоож 24 цагийн soak test; accepted recording алдагдахгүй, resource usage хязгаартаа, алдаа нь ил харагдана. 24 цаг бол санал болгосон шалгуур, одоогийн баталгаажсан хэмжилт биш.
7. ML-ийн бодит зөвшөөрөлтэй туршилтын өгөгдөл дээр face detection/masking misses, false alerts, precision/recall, FPS/latency-г гэрэл/өнцөг/олон хүнтэй нөхцөлөөр тайлагнах. Synthetic demo-ийн тоог production quality гэж ашиглахгүй.
8. Архитектур, setup/runbook, demo script, тест/benchmark нотолгоо, known limitations, versioned release note бүрэн байх.

Дараалал: **1 → 2 → 3 → 4 → 5/6**. Staging болон critical integration test-ийг 1-р багцаас эхлүүлж, дараагийн багц бүрийн release-д ашиглана. UI ба docs-ийн бие даасан ажлыг зэрэг гүйцэтгэж болно.

v1-ийн гол үр дүн: оператор үндсэн урсгалаа дуусгадаг, sensitive ажиллагаа алдаатай эрхээр үргэлжилдэггүй, accepted өгөгдөл тасалдлаас сэргээгддэг, админ системийг шинэ орчинд сэргээж чаддаг, release-ийн шалгалт давтагддаг байх.
