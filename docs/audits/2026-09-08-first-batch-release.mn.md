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
- Vercel production build амжилттай болсон. Runtime болон production promotion үр дүнг доор бүртгэнэ.

## Release

Source файлуудыг Git-ийн tracked болон unignored жагсаалтаас цэвэр түр хавтас руу хуулсан. Local cache, venv, node_modules, environment secrets ороогүй; зөвхөн Vercel project холбоосыг тусад нь хуулсан. Эх source working tree болон local dependency-г зөөгөөгүй. Шинэ dependency, SQL migration байхгүй.

- Vercel deployment: `dpl_BC8ga3vZ7gpGj9zdzki3DEkbSNdM` (`mongolz-rbcvobhcs-mongolz.vercel.app`), build READY; domain promotion шалгалт хүлээгдэж байна.
- Railway deployment: `194b45c0-b4dc-4b98-ba5f-112e5f05e876`, build эхэлсэн; runtime шалгалт хүлээгдэж байна.

## Үлдсэн ажил

Энэ багц v1-ийн бүх ажлыг дуусгаагүй. Tailscale enrollment/бодит CCTV, DB түвшний MFA ба atomic TOTP throttle, durable incoming upload/processing, операторын UI урсгал, backup restore drill дараагийн ажлууд хэвээр. Cold/warm playback-ийг synthetic encrypted recording-оор баталсан; production CCTV footage-ийн authenticated end-to-end шалгалт хийгдээгүй.
