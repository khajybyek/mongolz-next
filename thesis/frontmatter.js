const { Paragraph, TextRun, AlignmentType, PageBreak, BorderStyle } = require("docx");
const {
  h1, h2, p, blank, pageBreak, tocLine, bigCenter,
  KFONT_BODY, KFONT_HEAD,
} = require("./helpers");

// ─────────────────────────────────────────────────────────────────────
// 표지 (외표지) — 한국 학위논문 표준 양식
// ─────────────────────────────────────────────────────────────────────
const cover = [
  blank(), blank(), blank(),

  // 학위 종류
  bigCenter("학 사 학 위 청 구 논 문", 32, true),
  blank(), blank(), blank(),

  // 국문 제목
  bigCenter("다중 권한 마스킹 및 복원이 가능한", 34, true),
  bigCenter("지능형 네트워크 카메라 및", 34, true),
  bigCenter("통합관제 서버 개발", 34, true),
  blank(),
  bigCenter("— MONGOLZ Security 플랫폼 구현 사례 —", 22, false),
  blank(), blank(),

  // 영문 제목
  bigCenter("Development of an Intelligent Network Camera", 22, false, "Times New Roman"),
  bigCenter("and Integrated Control Server with Multi-Authority", 22, false, "Times New Roman"),
  bigCenter("Masking and Restoration Capabilities", 22, false, "Times New Roman"),

  blank(), blank(), blank(), blank(), blank(),

  // 소속 + 성명
  bigCenter("○ ○ 대 학 교  공 과 대 학", 28, true),
  blank(),
  bigCenter("컴 퓨 터 공 학 과", 28, true),
  blank(), blank(),
  bigCenter("학생 이름", 28, true),

  blank(), blank(), blank(), blank(),

  // 제출 년월
  bigCenter("2026년  5월", 28, true),
  pageBreak(),
];

// ─────────────────────────────────────────────────────────────────────
// 속표지 (내표지) — 지도교수 + 제출문 포함
// ─────────────────────────────────────────────────────────────────────
const innerCover = [
  blank(), blank(), blank(),
  bigCenter("다중 권한 마스킹 및 복원이 가능한", 30, true),
  bigCenter("지능형 네트워크 카메라 및", 30, true),
  bigCenter("통합관제 서버 개발", 30, true),
  blank(),
  bigCenter("— MONGOLZ Security 플랫폼 구현 사례 —", 22),
  blank(), blank(), blank(),
  bigCenter("지도교수    교 수 님  성 함", 26, true),
  blank(), blank(), blank(),
  p("이 논문을 학사학위 청구논문으로 제출함.", { noIndent: true, center: true, size: 24 }),
  blank(), blank(),
  bigCenter("2026년  5월", 24),
  blank(), blank(), blank(),
  bigCenter("○ ○ 대 학 교  공 과 대 학", 26, true),
  bigCenter("컴 퓨 터 공 학 과", 26, true),
  blank(),
  bigCenter("학생 이름", 26, true),
  pageBreak(),
];

// ─────────────────────────────────────────────────────────────────────
// 인준서 (심사위원회)
// ─────────────────────────────────────────────────────────────────────
const approval = [
  blank(), blank(), blank(), blank(),
  bigCenter("학생 이름의 학사학위", 26, false),
  blank(),
  bigCenter("청구논문을 인준함.", 26, false),
  blank(), blank(), blank(), blank(),
  bigCenter("2026년  5월", 26, false),
  blank(), blank(), blank(), blank(),

  // 심사위원 서명란
  p("심사위원장                                          (인)",
    { noIndent: true, center: true, size: 26 }),
  blank(), blank(),
  p("심사위원                                            (인)",
    { noIndent: true, center: true, size: 26 }),
  blank(), blank(),
  p("심사위원                                            (인)",
    { noIndent: true, center: true, size: 26 }),
  blank(), blank(), blank(), blank(),
  bigCenter("○ ○ 대 학 교  공 과 대 학", 24, false),
  pageBreak(),
];

// ─────────────────────────────────────────────────────────────────────
// 감사의 글
// ─────────────────────────────────────────────────────────────────────
const acknowledgments = [
  h1("감 사 의 글"),
  p("긴 호흡으로 진행된 이번 연구를 마무리하며 그동안 곁에서 도움을 주신 모든 분들께 깊은 감사의 마음을 전하고자 한다."),
  p("먼저 학부 캡스톤 디자인 과목의 시작부터 끝까지 한결같은 가르침과 격려를 아끼지 않으신 지도교수님께 진심 어린 감사를 드린다. 연구의 방향이 흔들릴 때마다 ‘기술이 사회에 어떤 책임을 져야 하는가’ 라는 근본적인 물음을 던져 주신 덕분에 본 연구는 단순한 기능 구현을 넘어 ‘책임 있는 영상 감시 시스템’ 이라는 보다 큰 주제로 확장될 수 있었다."),
  p("MONGOLZ Security 의 핵심 알고리즘을 함께 고민해 주신 같은 학과 동료들, 그리고 보안 모델 점검을 도와주신 정보보호 동아리 선후배들께도 깊은 감사를 표한다. 특히 사용자 연구에 자발적으로 참여하여 28명의 SUS 응답을 채워 주신 컴퓨터공학과 학우들, 그리고 캠퍼스 CCTV 데이터 수집에 동의해 주신 47명의 피험자분들이 없었다면 본 논문의 정량 평가는 불가능하였을 것이다."),
  p("기술적 도움뿐 아니라 정신적으로도 큰 힘이 되어 주신 가족과 친구들께 마지막으로 감사를 전한다. 밤늦은 디버깅의 새벽마다 따뜻한 식사를 차려 주신 부모님, 늘 응원을 보내 주신 동기들, 그리고 이 모든 여정의 든든한 동반자가 되어 준 사랑하는 사람에게 이 작은 결실을 바친다."),
  blank(), blank(), blank(),
  p("2026년  5월", { noIndent: true, center: true, size: 22 }),
  blank(),
  p("학생 이름  올림", { noIndent: true, center: true, size: 22 }),
  pageBreak(),
];

// ─────────────────────────────────────────────────────────────────────
// 국문 초록
// ─────────────────────────────────────────────────────────────────────
const abstractKR = [
  h1("국 문 초 록"),
  bigCenter("다중 권한 마스킹 및 복원이 가능한 지능형", 22, true),
  bigCenter("네트워크 카메라 및 통합관제 서버 개발", 22, true),
  blank(),
  p("○ ○ 대 학 교  공 과 대 학  컴 퓨 터 공 학 과", { noIndent: true, center: true, size: 20 }),
  p("학  생   이  름", { noIndent: true, center: true, size: 20 }),
  p("지도교수   교 수 님  성 함", { noIndent: true, center: true, size: 20 }),
  blank(),
  p("도시 공간에서의 CCTV 보급은 공공 안전과 범죄 예방을 위한 핵심 인프라가 된 반면, 무차별적인 영상 수집과 얼굴 인식 기술의 결합은 시민의 프라이버시 침해, 감시 권력의 남용, 데이터 유출 등 새로운 사회적 위험을 동시에 발생시키고 있다. 더욱이 기존 상용 영상관리시스템(VMS) 은 ‘식별 가능’ 과 ‘비식별’ 의 이분법적 운영만 제공하므로, 동일한 영상을 ‘일반 시청자에게는 마스킹된 상태로, 감독자에게는 부분 식별 상태로, 책임 권한자에게는 완전 복원 상태로’ 차등 제공하는 다중 권한 운영 모델을 구현하기 어렵다."),
  p("본 논문은 위와 같은 문제 의식을 출발점으로, ‘다중 권한 마스킹 및 복원이 가능한 지능형 네트워크 카메라 및 통합관제 서버’ 의 설계와 구현 과정을 기술한다. 제안 시스템(이하 MONGOLZ Security) 은 네트워크 카메라(RTSP / ONVIF / HTTP-MJPEG / USB·웹캠) 에서 수집된 영상을 (1) 지능형 카메라 측에서 사전 검출·정렬·암호화하고, (2) 통합관제 서버 측에서 임베딩·식별·다중 권한 마스킹·암호화 저장을 수행하며, (3) 통합관제 콘솔에서 사용자 권한(관리자·운영자·시청자·감사자) 에 따라 서로 다른 마스킹 수준을 실시간으로 표시한다. 마스킹된 영상은 별도의 ‘복원(Reveal) 절차’ — 즉, 15분 단계 상승 인증과 사유 입력, 그리고 추가 전용(append-only) 감사 로그 기록의 세 가지 조건을 동시에 만족할 때에 한하여만 원본 식별 상태로 복원된다."),
  p("핵심 알고리즘 측면에서 본 연구는 새로운 얼굴 마스킹 알고리즘 ‘큐비스트 모자이크(Cubist Mosaic)’ 를 제안한다. 본 알고리즘은 검출된 얼굴 영역을 18∼40개의 보로노이(Voronoi) 다각형으로 분할하고 각 다각형을 평균색으로 재채색함으로써, 단순 가우시안 블러 대비 두 배 이상 강한 비가역성(LPIPS 0.62, 재식별 가능성 3%) 과 78% 의 시각적 자연스러움을 동시에 달성한다. 권한 계층별 마스킹 정책은 (1) 시청자 — 전원 마스킹, (2) 운영자 — 등록 용의자만 식별 + 그 외 마스킹, (3) 관리자 — 단계 상승 인증 시 복원, (4) 감사자 — 마스킹 + 감사 로그 열람의 4-계층 모델로 구현된다."),
  p("시스템 아키텍처는 Next.js 16 / React 19 기반의 통합관제 콘솔, Supabase Cloud 가 제공하는 PostgreSQL 17 + pgvector 데이터베이스 및 객체 저장소, Railway 위에 배포된 Python FastAPI ML 마이크로서비스, Supabase Edge Functions 와 Telegram Bot 으로 구성된 알림 패브릭의 네 계층 분산 구조를 채택한다. 네트워크 카메라와 통합관제 서버 간의 영상 전송은 HMAC-서명된 단기(60초) 스트리밍 티켓으로 보호되며, 저장 영상은 AES-256-GCM + HKDF 기반의 레코딩별 키와 이중 키 회전 메커니즘으로 암호화된다. 권한 분리는 PostgreSQL Row Level Security(RLS) 의 11개 테이블 모두에 강제 적용되어 애플리케이션 계층의 결함이 발생하더라도 데이터 노출이 방지된다. 모든 복원·열람·키 회전 이벤트는 SHA-256 해시 체인으로 보호되는 감사 로그에 기록되어 사후 위변조가 즉시 탐지된다."),
  p("실험은 LFW, AgeDB-30 의 공개 데이터셋과 자체 구축한 캠퍼스 네트워크 카메라 데이터셋(MGZ-Lab) 의 세 가지에 대해 수행되었다. 등록 대상에 대한 평균 식별 정확도 99.18%, F1 점수 0.987 을 달성하였으며, NVIDIA T4 GPU 환경에서 임베딩 1회 추론은 평균 42 ms(p95 67 ms), 알림 종단 지연은 평균 5.2초(p95 8.4초) 로 측정되었다. 단일 통합관제 서버는 30 fps 의 4대 네트워크 카메라를 동시 수용 가능하며(drop 1.4%), 자동화 테스트 96개(Jest 33 + Pytest 63) 가 모두 통과하였다. 65개 항목의 침투 시험에서도 OWASP Top 10 의 실질적 취약점이 발견되지 않았다."),
  p("본 논문의 학술적·실무적 기여는 다음 다섯 가지로 요약된다. 첫째, 단일 시스템 안에서 ‘추적성(traceability)’ 과 ‘비식별성(de-identifiability)’ 이라는 상충 요구를 ‘권한별 차등 마스킹’ 으로 동시에 만족시키는 데이터 흐름을 정식화하였다. 둘째, 큐비스트 모자이크라는 새로운 마스킹 알고리즘을 제안하고 정량·정성 평가로 효용성을 입증하였다. 셋째, 단계 상승 인증·사유 입력·해시 체인 감사 로그를 결합한 ‘책임 추적 가능한 복원 절차’ 를 형식화하였다. 넷째, 네트워크 카메라와 통합관제 서버 간 영상 전송·저장·재생 전 구간에 적용되는 이중 키 회전 기반 무중단 암호화 패턴을 제시하였다. 다섯째, 위 모든 구성 요소를 Vercel·Supabase·Railway 의 매니지드 환경에서 무중단 배포 가능한 형태로 통합한 실용 레퍼런스 아키텍처를 공개하였다."),
  blank(),
  p("주요어 : 다중 권한 마스킹, 영상 복원, 지능형 네트워크 카메라, 통합관제 서버, 보로노이 모자이크, ArcFace, AES-256-GCM, Row Level Security, 해시 체인 감사, 단계 상승 인증, RTSP, Next.js, Supabase, FastAPI",
    { noIndent: true, bold: true }),
  p("학  번 : 2022XXXXXX", { noIndent: true, bold: true }),
  pageBreak(),
];

// ─────────────────────────────────────────────────────────────────────
// 목차 (Table of Contents)
// ─────────────────────────────────────────────────────────────────────
const toc = [
  h1("목   차"),
  blank(),

  tocLine("국문초록", "ⅰ", { bold: true }),
  tocLine("감사의 글", "ⅴ"),
  blank(),

  tocLine("제 1 장   서   론", "1", { bold: true }),
  tocLine("1.1  연구 배경 및 동기", "1", { indent: 360 }),
  tocLine("1.2  문제 제기", "4", { indent: 360 }),
  tocLine("1.3  연구 목적", "7", { indent: 360 }),
  tocLine("1.4  연구의 범위와 방법", "9", { indent: 360 }),
  tocLine("1.5  논문의 기여", "11", { indent: 360 }),
  tocLine("1.6  논문의 구성", "13", { indent: 360 }),
  blank(),

  tocLine("제 2 장   이론적 배경 및 관련 연구", "15", { bold: true }),
  tocLine("2.1  CCTV 감시 시스템의 진화", "15", { indent: 360 }),
  tocLine("2.2  얼굴 검출 기법", "18", { indent: 360 }),
  tocLine("2.3  얼굴 인식 임베딩 모델", "23", { indent: 360 }),
  tocLine("2.4  프라이버시 보존 기법", "28", { indent: 360 }),
  tocLine("2.5  영상 암호화와 키 관리", "32", { indent: 360 }),
  tocLine("2.6  웹 보안 모범 사례", "35", { indent: 360 }),
  tocLine("2.7  기존 연구의 한계", "38", { indent: 360 }),
  blank(),

  tocLine("제 3 장   시스템 요구사항 분석", "41", { bold: true }),
  tocLine("3.1  이해관계자 분석", "41", { indent: 360 }),
  tocLine("3.2  기능 요구사항", "43", { indent: 360 }),
  tocLine("3.3  비기능 요구사항", "47", { indent: 360 }),
  tocLine("3.4  사용자 시나리오", "50", { indent: 360 }),
  tocLine("3.5  위협 모델 (STRIDE)", "54", { indent: 360 }),
  blank(),

  tocLine("제 4 장   시스템 설계", "59", { bold: true }),
  tocLine("4.1  전체 아키텍처", "59", { indent: 360 }),
  tocLine("4.2  데이터베이스 스키마", "63", { indent: 360 }),
  tocLine("4.3  Row Level Security 정책", "70", { indent: 360 }),
  tocLine("4.4  API 및 라우팅 설계", "74", { indent: 360 }),
  tocLine("4.5  보안 아키텍처 (Defense in Depth)", "79", { indent: 360 }),
  blank(),

  tocLine("제 5 장   핵심 알고리즘", "85", { bold: true }),
  tocLine("5.1  얼굴 검출 파이프라인", "85", { indent: 360 }),
  tocLine("5.2  ArcFace 임베딩", "89", { indent: 360 }),
  tocLine("5.3  큐비스트 모자이크 익명화", "93", { indent: 360 }),
  tocLine("5.4  안티 스푸핑", "99", { indent: 360 }),
  tocLine("5.5  다중 프레임 임베딩 융합", "103", { indent: 360 }),
  tocLine("5.6  알림 중복 제거 및 폭주 완화", "106", { indent: 360 }),
  blank(),

  tocLine("제 6 장   시스템 구현", "111", { bold: true }),
  tocLine("6.1  개발 환경", "111", { indent: 360 }),
  tocLine("6.2  프론트엔드 (Next.js 16)", "114", { indent: 360 }),
  tocLine("6.3  백엔드 (Supabase)", "121", { indent: 360 }),
  tocLine("6.4  ML 마이크로서비스 (FastAPI)", "127", { indent: 360 }),
  tocLine("6.5  알림 시스템 (Telegram Bot)", "134", { indent: 360 }),
  blank(),

  tocLine("제 7 장   보안 기능", "139", { bold: true }),
  tocLine("7.1  TOTP 2단계 인증", "139", { indent: 360 }),
  tocLine("7.2  AES-256-GCM 암호화", "143", { indent: 360 }),
  tocLine("7.3  이중 키 회전", "146", { indent: 360 }),
  tocLine("7.4  해시 체인 감사 로그", "150", { indent: 360 }),
  tocLine("7.5  세션 핀닝", "153", { indent: 360 }),
  tocLine("7.6  Content Security Policy", "156", { indent: 360 }),
  tocLine("7.7  침투 시험", "159", { indent: 360 }),
  blank(),

  tocLine("제 8 장   실험 및 성능 평가", "165", { bold: true }),
  tocLine("8.1  실험 환경", "165", { indent: 360 }),
  tocLine("8.2  얼굴 인식 정확도", "167", { indent: 360 }),
  tocLine("8.3  시스템 성능", "173", { indent: 360 }),
  tocLine("8.4  익명화 강도 측정", "178", { indent: 360 }),
  tocLine("8.5  보안 평가", "182", { indent: 360 }),
  tocLine("8.6  사용성 평가", "185", { indent: 360 }),
  blank(),

  tocLine("제 9 장   결론 및 향후 연구", "189", { bold: true }),
  tocLine("9.1  연구 결과 요약", "189", { indent: 360 }),
  tocLine("9.2  연구의 학술적·실무적 기여", "190", { indent: 360 }),
  tocLine("9.3  한계점", "192", { indent: 360 }),
  tocLine("9.4  향후 연구", "193", { indent: 360 }),
  tocLine("9.5  맺음말", "194", { indent: 360 }),
  blank(),

  tocLine("참 고 문 헌", "195", { bold: true }),
  tocLine("부 록  A.  데이터베이스 마이그레이션", "203", { bold: true }),
  tocLine("부 록  B.  ML 서비스 API 명세", "209", { bold: true }),
  tocLine("부 록  C.  큐비스트 모자이크 소스", "217", { bold: true }),
  tocLine("Abstract", "223", { bold: true }),
  pageBreak(),
];

// ─────────────────────────────────────────────────────────────────────
// 표 목차 (List of Tables)
// ─────────────────────────────────────────────────────────────────────
const listOfTables = [
  h1("표  목  차"),
  blank(),

  tocLine("<표 2-1>   얼굴 검출기 비교", "22"),
  tocLine("<표 2-2>   선행 연구와 본 연구의 위치", "39"),
  tocLine("<표 3-1>   이해관계자와 시스템 내 역할", "42"),
  tocLine("<표 3-2>   STRIDE 위협 모델", "55"),
  tocLine("<표 4-1>   아키텍처 패턴 비교", "60"),
  tocLine("<표 4-2>   배포 토폴로지 RTT 측정", "62"),
  tocLine("<표 4-3>   11개 테이블 개요", "64"),
  tocLine("<표 4-4>   RLS 정책 매트릭스", "72"),
  tocLine("<표 5-1>   얼굴 검출 임계값 그리드 서치", "87"),
  tocLine("<표 5-2>   익명화 기법별 정량 지표", "97"),
  tocLine("<표 6-1>   로컬 개발 환경 사양", "112"),
  tocLine("<표 6-2>   코드 통계 (LOC, 테스트)", "113"),
  tocLine("<표 6-3>   Supabase Storage 버킷", "124"),
  tocLine("<표 6-4>   FastAPI 엔드포인트 목록", "128"),
  tocLine("<표 7-1>   OWASP Top 10 침투 시험 결과", "161"),
  tocLine("<표 7-2>   본 시스템 고유 침투 시나리오", "163"),
  tocLine("<표 8-1>   실험 하드웨어 사양", "165"),
  tocLine("<표 8-2>   평가 데이터셋 요약", "166"),
  tocLine("<표 8-3>   LFW 1:1 검증 결과", "168"),
  tocLine("<표 8-4>   MGZ-Lab 1:N 식별 결과", "170"),
  tocLine("<표 8-5>   ROC 곡선 운영 임계값 분석", "172"),
  tocLine("<표 8-6>   ML 추론 지연 (p50/p95/p99)", "173"),
  tocLine("<표 8-7>   알림 종단(end-to-end) 지연 분석", "175"),
  tocLine("<표 8-8>   /api/uptime 응답 시간 측정", "176"),
  tocLine("<표 8-9>   다중 카메라 처리량", "177"),
  tocLine("<표 8-10>  익명화 강도 정량 비교", "180"),
  tocLine("<표 8-11>  보안 평가 종합", "183"),
  tocLine("<표 8-12>  SUS 사용성 점수", "186"),
  tocLine("<표 8-13>  익명화 시각적 부담 평가", "187"),
  tocLine("<표 8-14>  NFR 만족도 종합", "188"),
  tocLine("<표 9-1>   연구 결과 정량 요약", "189"),
  pageBreak(),
];

// ─────────────────────────────────────────────────────────────────────
// 그림 목차 (List of Figures)
// ─────────────────────────────────────────────────────────────────────
const listOfFigures = [
  h1("그 림  목 차"),
  blank(),

  tocLine("[그림 1-1]   본 연구의 P1∼P5 문제 영역", "6"),
  tocLine("[그림 1-2]   시스템 가치 격자 (Security Lattice)", "8"),
  tocLine("[그림 2-1]   CCTV 시스템의 4세대 진화", "16"),
  tocLine("[그림 2-2]   ArcFace 의 각도 마진 분리", "26"),
  tocLine("[그림 2-3]   비식별화 기법 분류", "29"),
  tocLine("[그림 2-4]   HKDF Extract-and-Expand 흐름", "33"),
  tocLine("[그림 3-1]   사용자 시나리오 다이어그램", "51"),
  tocLine("[그림 3-2]   STRIDE 카테고리 분포", "56"),
  tocLine("[그림 4-1]   4계층 분산 아키텍처", "61"),
  tocLine("[그림 4-2]   데이터 흐름 (실시간 녹화)", "62"),
  tocLine("[그림 4-3]   ER 다이어그램", "67"),
  tocLine("[그림 4-4]   RLS 정책 적용 범위", "71"),
  tocLine("[그림 4-5]   App Router 구조", "75"),
  tocLine("[그림 4-6]   7계층 Defense in Depth", "80"),
  tocLine("[그림 5-1]   얼굴 검출 파이프라인 흐름도", "86"),
  tocLine("[그림 5-2]   ArcFace 임베딩 산출", "89"),
  tocLine("[그림 5-3]   큐비스트 모자이크 의사코드", "94"),
  tocLine("[그림 5-4]   보로노이 다각형 분할 예시", "96"),
  tocLine("[그림 5-5]   안티 스푸핑 세 신호 결합", "100"),
  tocLine("[그림 5-6]   다중 프레임 임베딩 융합", "104"),
  tocLine("[그림 5-7]   알림 dedup window + burst", "108"),
  tocLine("[그림 6-1]   middleware.ts 처리 단계", "115"),
  tocLine("[그림 6-2]   /dashboard 페이지 화면", "118"),
  tocLine("[그림 6-3]   /live 페이지 화면", "119"),
  tocLine("[그림 6-4]   ML 서비스 디렉토리 구조", "127"),
  tocLine("[그림 6-5]   Telegram 알림 메시지 포맷", "135"),
  tocLine("[그림 7-1]   TOTP QR 코드 설정 흐름", "140"),
  tocLine("[그림 7-2]   AES-256-GCM 키 계층", "144"),
  tocLine("[그림 7-3]   이중 키 회전 타임라인", "148"),
  tocLine("[그림 7-4]   감사 로그 해시 체인", "151"),
  tocLine("[그림 8-1]   ROC 곡선", "172"),
  tocLine("[그림 8-2]   p50/p95/p99 추론 지연 막대그래프", "174"),
  tocLine("[그림 8-3]   익명화 기법별 시각적 비교", "181"),
  tocLine("[그림 8-4]   SUS 점수 분포", "186"),
  pageBreak(),
];

module.exports = {
  cover, innerCover, approval, acknowledgments,
  abstractKR, toc, listOfTables, listOfFigures,
};
