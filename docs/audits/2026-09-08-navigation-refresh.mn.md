# Navigation шинэчлэлт

2026-09-08 · Sidebar, header, mobile цэс.

- 42 destination-ийг зургаан бүлэгт зохион байгуулсан. Өдөр тутмын үндсэн хуудаснууд үргэлж харагдана; нэмэлт хэрэгслүүд эвхэгдэнэ.
- Desktop sidebar 272px эсвэл 76px icon горимтой; хэмжээ болон бүлгийн сонголт localStorage-д хадгалагдана. Хайлт, route-ийн active төлөв, keyboard focus хадгалагдана.
- Mobile дээр floating tab bar, safe-area зай, бүтэн drawer. MN/EN/KR, dark/light хувилбаруудтай.
- Viewer/auditor/admin эрх болон бүх route-ийг хадгалсан. Logo-ийн dark горимын contrast зассан.

## Баталгаажуулалт

- Navigation Jest: 8 тест; focused ESLint, typecheck тэнцсэн.
- Бодит React component-уудыг тусгаарласан локал preview-д шалгасан: 45 browser assertion (320–1440px, 3 хэл, 2 theme, role visibility, compact persistence, drawer, focus, Safari).
- Нэмэлтээр нэг бүлгийн дотор palette-аас шилжихэд бүлэг нээгдэх болон mobile visible label/accessibility нэр тохирохыг шалгасан. Console runtime алдаа гараагүй.
- Screenshot-оор desktop dark/light, compact болон mobile/drawer шалгасан. Preview нь зөвхөн shell бөгөөд production хэрэглэгчээр нэвтэрсэн end-to-end шалгалт биш.

## Production

- Base commit: `a8ab8d8`; зөвхөн navigation-ийн 8 source/test файлыг нэмсэн. Shared workspace-ийн бусад үргэлжилж буй засварыг энэ deployment-д багтаагаагүй; translation файлаас navigation блокуудыг л авсан.
- Final deployment: `dpl_8vR6EyfwhehppQ9FGMpZaHC4ch6M`, `mongolz-fr9apmvsd-mongolz.vercel.app`; production build READY, promote амжилттай.
- aicctv.dev рүү production promotion хийсэн.
- Domain inspect шинэ deployment-ийг заасан; `/`, `/login`, `/api/uptime` HTTP 200, DB/ML ok. Нэвтрээгүй `/dashboard` хүсэлт login руу зөв шилжсэн.
