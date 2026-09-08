# Эхний багц — playback ба алдааны үеийн хамгаалалт

2026-09-08. Өмнөх UI болон cloud migration өөрчлөлтүүд дээр үргэлжлүүлсэн хязгаартай багц.

## Засвар

- Cold playback-ийн `.mp4.part` файлд FFmpeg MP4 форматыг ил тод заана. Broken pipe, encoder exit failure/timeout, уншигдахгүй output-ийг амжилт гэж буцаахгүй. Алдаатай render cache-д нийтлэгдэхгүй.
- Камерын `never_reveal` privacy zone query алдахад reveal job failed болж, original татах болон rendering эхлэхгүй. Амжилттай хоосон хариу болон камерт хамаарахгүй upload хэвээр ажиллана.
- Session-pin secret дутуу эсвэл шалгалт дотоод алдаатай үед protected API 503, page нь тайлбартай login руу шилжинэ. Түр алдаанаас бүх session-ийг хүчингүй болгохгүй. Бодитоор буруу pin-ийг өмнөхөөр няцааж, хүчингүй болгоно.
- `server_config` login хуудсыг middleware дахин dashboard руу шилжүүлдэг давталтыг арилгасан.

## Шалгалтын нотолгоо

- Jest: 25 suite, 222 тест тэнцсэн; шинэ auth regression 12.
- Python ML: 210 тест тэнцсэн; playback/privacy чиглэсэн 25 тест тэнцсэн.
- ESLint, TypeScript typecheck, `git diff --check` тэнцсэн.
- Linux production dependency image дотор, гадаад сүлжээгүй, UID 10001-ээр бодит FastAPI endpoint + encryption + FFmpeg шалгасан: cold/warm HTTP 200, 8/8 frame тоглогдоно; render failure HTTP 500, final/partial cache үлдэхгүй.
- Контейнерт pytest суулгаагүй тул контейнерийн smoke-ийг Python assertion-тай тусдаа ажиллуулсан; бүтэн Python suite нь local venv-д ажилласан.
- Vercel production build болон production promotion амжилттай болсон.
- Эхний promotion-ийн дараа production desktop Chrome/mobile Safari дээр public/login 28 тест тэнцсэн.

## Release

Source файлуудыг Git-ийн tracked болон unignored жагсаалтаас цэвэр түр хавтас руу хуулсан. Local cache, venv, node_modules, environment secrets ороогүй; зөвхөн Vercel project холбоосыг тусад нь хуулсан. Эх source working tree болон local dependency-г зөөгөөгүй. Шинэ dependency, SQL migration байхгүй.

- Эхний Vercel deployment: `dpl_BC8ga3vZ7gpGj9zdzki3DEkbSNdM` (`mongolz-rbcvobhcs-mongolz.vercel.app`), build READY, production promotion амжилттай. Uptime DB/ML хоёул ok; config-error login HTTP 200, login form харагдсан.
- Эхний Railway deployment: `194b45c0-b4dc-4b98-ba5f-112e5f05e876`, startup complete, Uvicorn ажилласан; traceback/volume permission error байгаагүй. Тухайн startup-д Tailscale key invalid байсан.

### Түр зогсолтын дараах шинэ төлөв — 2026-09-08 14:14 UTC

Ажил түр зогссон хооронд тусдаа шинэ commit/deploy хийгдсэн. Тэдгээрийг хуучин release-ээр дараагүй. Энэ багцын `view_renderer.py`, `reveal_job.py`, `lib/supabase/auth.ts`, `lib/supabase/middleware.ts` нь шалгасан source-той ижил хэвээр байгааг локал SHA-256 manifest-аар тулгасан.

- aicctv.dev одоо `dpl_Hxa3cS46uxVRkYAMGwEgztxYTL3v` (`mongolz-pc9csd7p3-mongolz.vercel.app`) руу зааж байна; Vercel Ready.
- Railway-ийн одоогийн deployment `bcaa4045-4a01-4b2b-bc4c-b4554df2eeca` SUCCESS; эхний deployment шинэ хувилбараар солигдсон тул REMOVED болсон.
- aicctv.dev болон config-error login HTTP 200. `/api/uptime` HTTP 200, DB/ML хоёул ok. ML root HTTP 200, `active_cameras: 0`.
- Одоогийн source дээр Jest 31 suite / 343 тест, Python ML 210 тест тэнцсэн. Одоогийн production дээр desktop/mobile public/login 28 тест дахин тэнцсэн.
- Одоогийн Railway deployment-ийн 09:30–09:40 UTC startup log: `invalid key`, `tailscale up failed`, дараа нь `Application startup complete`; traceback/permission error байгаагүй. Камерын сүлжээг сэргээхэд хүчинтэй enrollment шаардлагатай.
- Контейнерийн source hash/Tailscale-ийн шууд төлөвийг SSH-ээр унших оролдлого локал SSH key байхгүйгээс хийгдээгүй. Startup log болон API liveness-ийг бодит CCTV frame-ийн баталгаа гэж үзэхгүй.

Эцсийн тайлан бичих үед shared workspace-ийн ML файлуудад тусдаа шинэ өөрчлөлтүүд нэмэгдэж эхэлсэн. Дээрх test/hash нотолгоо нь шалгасан мөчийн snapshot-д хамаарна; дараа нэмэгдсэн өөрчлөлтүүдийг энэ release-ийн баталгаажуулалтад хамруулсан гэж үзэхгүй.

## Үлдсэн ажил

Энэ багц v1-ийн бүх ажлыг дуусгаагүй. Түр зогсолтын үеийн шинэ commit-ууд MFA data-tier хамгаалалт, atomic throttle, backup artifact болон audit read coverage нэмсэн; тэдгээрийг энэ эхний багцад хийсэн гэж тооцохгүй. Бодит CCTV/бичлэгийн authenticated end-to-end урсгал, durable incoming upload/processing, операторын үлдсэн UI урсгал, тусгаарласан backup restore drill-ийн баталгаа шаардлагатай хэвээр. Cold/warm playback-ийг synthetic encrypted recording-оор баталсан.
