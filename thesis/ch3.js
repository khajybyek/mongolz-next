const { h1, h2, h3, h4, p, blank, bullet, num, code, quote, table } = require("./helpers");

module.exports = [
  h1("제 3 장   시스템 요구사항 분석"),

  p("본 장은 IEEE 830-1998 ‘Recommended Practice for Software Requirements Specifications’ 의 구조에 따라, 제안 시스템의 이해관계자, 기능 요구사항, 비기능 요구사항, 사용자 시나리오, 그리고 STRIDE 위협 모델을 기술한다. 본 장에서 도출된 요구사항은 이후 제 4 장 시스템 설계와 제 8 장 평가의 직접적인 기준이 된다."),

  h2("3.1  이해관계자 분석"),
  p("본 시스템의 이해관계자는 6개 그룹으로 구분된다. 각 그룹의 주요 관심사와 시스템에 대한 권한·역할은 다음과 같다."),
  table([
    ["이해관계자", "주요 관심사", "시스템 내 역할"],
    ["관리자(Administrator)", "정확한 식별, 운영 효율, 감사 대응", "전체 CRUD, 복원, 키 회전"],
    ["일반 시청자(Viewer)", "필요한 영상의 빠른 검토", "마스킹된 영상의 읽기 전용 접근"],
    ["등록 대상(Suspect)", "정확한 식별, 오탐 최소화", "등록 정보만 시스템에 존재"],
    ["일반 시민(Bystander)", "프라이버시, 익명성", "마스킹된 영상에만 등장"],
    ["감사자(Auditor)", "운영 적법성, 감사 로그 무결성", "audit_log 의 읽기 전용 접근"],
    ["시스템 운영자(SRE)", "가용성, 보안, 비용", "인프라 배포·모니터링"],
  ], [2200, 3800, 3360]),

  p("이해관계자 간의 이해 충돌은 본 시스템의 핵심 설계 동기이다. 예컨대 관리자는 ‘가능한 한 많은 데이터에 접근’ 하고자 하는 반면, 일반 시민은 ‘가능한 한 적은 데이터가 수집·식별’ 되기를 바란다. 본 시스템은 이러한 충돌을 ‘기본은 익명, 명시적 절차로만 식별’ 원칙으로 해소한다. 즉, 시스템의 기본 상태(default state) 는 모든 일반 시민의 얼굴이 마스킹된 상태이며, 관리자는 사전에 명시적으로 등록한 ‘suspect’ 에 한해서만 식별을 받게 된다."),

  h2("3.2  기능 요구사항"),
  p("기능 요구사항은 ‘FR-{영역}-{번호}’ 의 형태로 식별한다. 본 시스템의 기능 요구사항은 총 8개 영역, 47개 항목이다."),

  h3("3.2.1  카메라 관리 (FR-CAM)"),
  bullet("FR-CAM-01 : 관리자는 RTSP / HTTP-MJPEG / USB 웹캠 / 브라우저 웹캠 의 4가지 입력 소스를 등록할 수 있어야 한다.", 0),
  bullet("FR-CAM-02 : RTSP URL 은 AES-256-GCM(CAMERA_URL_KEY) 으로 암호화되어 저장되어야 한다.", 0),
  bullet("FR-CAM-03 : 일반 시청자(viewer) 는 url 필드에 접근할 수 없어야 한다 (null 반환).", 0),
  bullet("FR-CAM-04 : 카메라 활성/비활성 토글이 가능해야 한다.", 0),
  bullet("FR-CAM-05 : 카메라 메타데이터(이름, 위치, 설명) 의 다국어 라벨이 지원되어야 한다.", 0),

  h3("3.2.2  용의자 관리 (FR-SUS)"),
  bullet("FR-SUS-01 : 관리자는 용의자의 사진(JPEG/PNG) 과 메타데이터(이름, 주의 사항) 를 등록할 수 있어야 한다.", 0),
  bullet("FR-SUS-02 : 업로드된 사진에서 ArcFace 512차원 임베딩이 자동 산출되어야 한다.", 0),
  bullet("FR-SUS-03 : 임베딩은 pgvector 의 halfvec(512) 타입으로 저장되어, cosine_distance 인덱스(ivfflat) 를 사용한 빠른 유사도 검색이 가능해야 한다.", 0),
  bullet("FR-SUS-04 : 용의자 삭제 시, 관련된 alerts·faces 의 외래키는 SET NULL 로 보존된다.", 0),

  h3("3.2.3  실시간 녹화 (FR-LIVE)"),
  bullet("FR-LIVE-01 : 사용자는 브라우저에서 ‘녹화 시작’ 버튼으로 webcam·RTSP·HTTP 카메라의 실시간 녹화를 시작할 수 있다.", 0),
  bullet("FR-LIVE-02 : 녹화 시작 시 ML 서비스에 /camera/start 요청을 보내고, 영상은 1분 단위 청크로 분할된다.", 0),
  bullet("FR-LIVE-03 : 각 청크는 검출·임베딩·마스킹 처리 후 AES-256-GCM 으로 암호화되어 Supabase Storage 의 recordings 버킷에 저장된다.", 0),
  bullet("FR-LIVE-04 : HLS(.m3u8 + .ts) 스트리밍이 가능해야 하며, HLS 접근은 HMAC-서명된 단기 티켓(STREAM_TICKET_SECRET, 60초) 으로 보호되어야 한다.", 0),
  bullet("FR-LIVE-05 : 녹화 중단 시 진행 중인 청크가 안전하게 마무리(flush) 되어야 한다.", 0),

  h3("3.2.4  업로드 및 비동기 처리 (FR-UP)"),
  bullet("FR-UP-01 : 사용자는 브라우저에서 최대 4.5MB(Vercel Hobby tier 제한) 의 MP4 파일을 업로드할 수 있어야 한다.", 0),
  bullet("FR-UP-02 : 업로드 직후 클라이언트는 UltraFace-RFB-320 으로 얼굴이 1개 이상 검출되는지 사전 검증한다.", 0),
  bullet("FR-UP-03 : 업로드된 파일은 ML 서비스에 /process-upload 로 전달되고, 3∼5초 안에 ACK 응답을 받아야 한다.", 0),
  bullet("FR-UP-04 : 실제 처리(검출·임베딩·마스킹·암호화·메타데이터 INSERT) 는 백그라운드 태스크로 1∼2분 안에 완료되어야 한다.", 0),

  h3("3.2.5  알림 (FR-ALERT)"),
  bullet("FR-ALERT-01 : 등록 용의자와의 코사인 유사도가 0.45 이상인 얼굴이 검출되면 alerts 테이블에 INSERT 된다.", 0),
  bullet("FR-ALERT-02 : alerts INSERT 시 PostgreSQL 트리거(notify_telegram_on_alert) 가 Supabase Edge Function 으로 알림 발송 요청을 보낸다.", 0),
  bullet("FR-ALERT-03 : Edge Function 은 Telegram Bot API 로 (1) 카메라 위치, (2) 용의자 이름, (3) KST 타임스탬프, (4) 얼굴 스냅샷 URL 을 메시지로 전송한다.", 0),
  bullet("FR-ALERT-04 : 동일 용의자에 대한 알림은 alert_rules.dedup_window_sec 시간 안에서는 1회만 발송된다.", 0),
  bullet("FR-ALERT-05 : 관리자는 ‘quiet hours’ (HH:MM∼HH:MM, KST) 를 설정하여 특정 시간대의 알림을 음소거할 수 있다.", 0),

  h3("3.2.6  복원 (FR-REV)"),
  bullet("FR-REV-01 : 마스킹된 영상의 특정 시점·특정 얼굴에 대해, 관리자는 ‘복원(reveal)’ 요청을 만들 수 있다.", 0),
  bullet("FR-REV-02 : reveal 요청은 (1) 활성 단계 상승 토큰(15분) 과 (2) 명시적 사유(JSON {\"reason\": \"...\"}) 의 두 가지 조건을 모두 만족해야 한다.", 0),
  bullet("FR-REV-03 : reveal 작업은 비동기 큐(reveal_jobs) 에 등록되고, ML 서비스의 /reveal/run 으로 처리된다.", 0),
  bullet("FR-REV-04 : 결과 영상은 별도의 ‘revealed’ 버킷에 저장되며, 다운로드 링크는 15분 후 만료된다.", 0),
  bullet("FR-REV-05 : 모든 reveal 요청은 audit_log 에 SHA-256 체인된 형태로 기록되며, 사후 위변조가 즉시 탐지된다.", 0),

  h3("3.2.7  분석 및 검색 (FR-SEARCH)"),
  bullet("FR-SEARCH-01 : 사용자는 사진 한 장을 업로드해 등록 용의자 데이터베이스와의 1:N 매칭 결과(top-K) 를 조회할 수 있다.", 0),
  bullet("FR-SEARCH-02 : 매칭은 pgvector 의 ivfflat 인덱스를 사용하여 평균 12ms 이내에 완료되어야 한다.", 0),
  bullet("FR-SEARCH-03 : /analytics 페이지는 (1) 일별 알림 수, (2) 시간대별 알림 분포, (3) 용의자별 알림 비율, (4) 카메라별 검출 수를 Recharts 로 시각화한다.", 0),

  h3("3.2.8  AI 보조 (FR-AI)"),
  bullet("FR-AI-01 : 관리자는 자연어 질의(예: ‘지난 24시간 동안 가장 자주 탐지된 용의자는?’) 를 입력하여 Claude API 로부터 자연어 답변을 받을 수 있다.", 0),
  bullet("FR-AI-02 : 일별 운영 요약(daily summary) 이 자동으로 생성되어 /ai 페이지에 표시된다.", 0),
  bullet("FR-AI-03 : 이상 행동 감지(anomaly detection) — 특정 시간대에 평소 대비 알림 수가 2σ 이상 증가하면 별도의 ‘anomaly’ 알림이 발생한다.", 0),

  h2("3.3  비기능 요구사항"),

  h3("3.3.1  성능 (NFR-PERF)"),
  bullet("NFR-PERF-01 : ArcFace 1회 임베딩 추론은 NVIDIA T4 GPU 환경에서 평균 50 ms (p95 80 ms) 이내여야 한다.", 0),
  bullet("NFR-PERF-02 : /api/uptime 응답은 평균 200 ms (p95 400 ms) 이내여야 한다.", 0),
  bullet("NFR-PERF-03 : 알림 생성 → Telegram 전송까지의 종단(end-to-end) 지연은 평균 8 초 이내여야 한다.", 0),
  bullet("NFR-PERF-04 : 단일 ML 서비스 인스턴스는 동시 4개 카메라 스트림(30 fps × 4) 을 처리할 수 있어야 한다.", 0),

  h3("3.3.2  가용성 (NFR-AVAIL)"),
  bullet("NFR-AVAIL-01 : 시스템의 월간 가용성은 99.5% 이상이어야 한다.", 0),
  bullet("NFR-AVAIL-02 : 단일 영역(zone) 장애 시 매니지드 플랫폼(Vercel·Supabase·Railway) 의 자동 페일오버에 의존한다.", 0),
  bullet("NFR-AVAIL-03 : ML 서비스가 응답하지 않더라도, 프론트엔드의 로그인·열람 등 핵심 페이지는 사용 가능해야 한다.", 0),

  h3("3.3.3  보안 (NFR-SEC)"),
  bullet("NFR-SEC-01 : 모든 영상은 저장 시 AES-256-GCM 으로 암호화되어야 한다.", 0),
  bullet("NFR-SEC-02 : 인증된 사용자만이 데이터에 접근할 수 있어야 하며, 권한 분리는 RLS 로 데이터베이스 계층에서 강제되어야 한다.", 0),
  bullet("NFR-SEC-03 : 모든 사용자에게 TOTP 2단계 인증이 강제되어야 한다.", 0),
  bullet("NFR-SEC-04 : 복원 작업은 15분 단계 상승 토큰을 요구해야 한다.", 0),
  bullet("NFR-SEC-05 : 감사 로그는 SHA-256 해시 체인으로 무결성이 검증되어야 한다.", 0),
  bullet("NFR-SEC-06 : OWASP Top 10 의 모든 항목에 대한 침투 시험을 통과해야 한다.", 0),

  h3("3.3.4  사용성 (NFR-UX)"),
  bullet("NFR-UX-01 : 모든 UI 는 모바일(min-width 320px) 까지 반응형이어야 한다.", 0),
  bullet("NFR-UX-02 : WCAG 2.1 AA 등급의 접근성을 만족해야 한다 (skip-to-content, focus-visible, prefers-reduced-motion).", 0),
  bullet("NFR-UX-03 : 한국어(ko), 영어(en), 몽골어(mn), 일부 한국어 비표시 시 한국어(kr) 의 4개 UI 언어가 지원되어야 한다.", 0),
  bullet("NFR-UX-04 : 모든 시간 표시는 사용자 로케일에 관계없이 Asia/Seoul (KST, UTC+9) 으로 통일된다.", 0),

  h3("3.3.5  컴플라이언스 (NFR-COMP)"),
  bullet("NFR-COMP-01 : 대한민국 개인정보보호법 제15·17·22·23조 의 요구사항을 만족해야 한다.", 0),
  bullet("NFR-COMP-02 : EU GDPR Article 9 의 ‘민감 정보 처리 원칙’ 을 만족해야 한다.", 0),
  bullet("NFR-COMP-03 : 모든 데이터 처리는 Asia/Seoul 시간대 기준으로 기록되어, 한국 법 집행 기관에 제출 가능한 형태여야 한다.", 0),

  h2("3.4  사용자 시나리오"),
  p("이 절은 시스템의 일상적 사용 흐름과 비상 시 흐름을 시나리오로 정리한다. 각 시나리오는 ‘선조건(precondition) → 트리거(trigger) → 정상 흐름(normal flow) → 대안 흐름(alternative flow) → 사후 조건(postcondition)’ 의 구조로 기술한다."),

  h3("3.4.1  S1 : 신규 용의자 등록"),
  p("선조건 : 관리자가 로그인 + TOTP 인증을 완료한 상태.\n트리거 : 관리자가 /suspects 페이지에서 ‘새 용의자’ 버튼을 클릭.\n정상 흐름 : (1) 관리자가 이름·메모·사진을 입력. (2) 클라이언트가 사진을 /api/suspects/embed 로 POST. (3) 서버가 ML /embed 로부터 512차원 임베딩을 받아 suspects 테이블에 INSERT. (4) UI 가 등록 완료 토스트 표시.\n대안 흐름 : 사진에서 얼굴이 검출되지 않으면 ‘얼굴을 인식할 수 없습니다’ 오류 표시.\n사후 조건 : suspects 테이블에 한 행이 추가되고, 이후 모든 카메라 스트림에서 매칭이 시도된다."),

  h3("3.4.2  S2 : 알림 수신 및 대응"),
  p("선조건 : 한 명 이상의 용의자가 등록되어 있고, 한 대 이상의 활성 카메라가 작동 중.\n트리거 : 카메라 스트림에서 코사인 유사도 ≥ 0.45 의 매칭이 발생.\n정상 흐름 : (1) ML 서비스가 alerts INSERT. (2) PG 트리거가 telegram-alerts Edge Function 호출. (3) Telegram Bot 이 관리자 채팅방에 메시지 전송(평균 6 초 이내). (4) 관리자가 메시지의 ‘확인’ 버튼을 클릭하여 /alerts 페이지로 이동. (5) 알림에 ‘true_positive’ 라벨을 부여.\n대안 흐름 : 동일 용의자에 대한 직전 알림으로부터 dedup_window 시간 내에 발생한 매칭은 alerts 의 match_count 만 증가시키고, 새 알림은 발송하지 않는다.\n사후 조건 : alerts 테이블에 매칭 정보가 기록되고, active_learning 데이터에 라벨이 추가된다."),

  h3("3.4.3  S3 : 영상 복원(reveal)"),
  p("선조건 : 알림이 발생한 영상이 마스킹된 형태로 저장되어 있다.\n트리거 : 관리자가 /playback/[id] 페이지에서 ‘복원 요청’ 버튼을 클릭.\n정상 흐름 : (1) 관리자가 15분 단계 상승 인증을 수행 (재로그인 또는 TOTP 재입력). (2) 사유 입력(필수, 10자 이상). (3) reveal_jobs 큐에 INSERT. (4) ML /reveal/run 이 원본 영상을 복호화하고, 식별 가능한 형태로 재처리한 후 ‘revealed’ 버킷에 저장. (5) 결과 영상이 15분간 다운로드 가능. (6) 모든 단계가 audit_log 에 기록.\n대안 흐름 : 15분 토큰이 만료된 경우 단계 상승 인증 페이지로 리다이렉트.\n사후 조건 : reveal 결과 영상이 임시 저장되며, audit_log 에 5개 이벤트(요청·승인·복호화·재처리·다운로드) 가 추가된다."),

  h3("3.4.4  S4 : 키 회전 (ML_ENCRYPTION_KEY)"),
  p("선조건 : SRE 가 Railway CLI 접근 권한을 가지고 있고, npm run rotate:keys 스크립트가 사용 가능하다.\n트리거 : 분기별 정기 점검 또는 키 유출 의심 사건.\n정상 흐름 : (1) SRE 가 npm run rotate:keys -- --key=ML_ENCRYPTION_KEY 실행. (2) 스크립트가 NEW_KEY 를 생성, OLD_KEY 를 ML_ENCRYPTION_KEY_PREV 로 설정, NEW_KEY 를 ML_ENCRYPTION_KEY 로 설정 후 Railway 변수 업데이트. (3) 서비스 재기동. (4) 신규 레코딩은 NEW_KEY 로 암호화, 기존 레코딩은 PREV 폴백으로 복호화. (5) 7일 후 SRE 가 --finalize 옵션으로 PREV 키 폐기.\n사후 조건 : 모든 신규 레코딩이 NEW_KEY 로 보호되며, audit_log 에 키 회전 이벤트가 기록."),

  h3("3.4.5  S5 : 침투 사고 대응"),
  p("선조건 : 운영 환경에서 비정상적 접근 패턴(예: 동일 IP 에서 100회/분 의 로그인 실패) 가 관찰됨.\n트리거 : Sentry 알림 또는 Telegram 의 anomaly 메시지.\n정상 흐름 : (1) SRE 가 vercel logs --json 으로 요청 로그 확인. (2) 의심 IP 를 Vercel 의 IP 차단 목록에 추가. (3) 영향 받은 사용자 계정에 강제 로그아웃 + 비밀번호 재설정 메일 발송. (4) verify_audit_chain() 함수로 감사 로그 무결성 확인. (5) 운영 보고서 작성.\n사후 조건 : 침투 시도가 차단되고, 모든 단계가 audit_log 에 기록된다."),

  h2("3.5  위협 모델 (STRIDE)"),
  p("Microsoft 의 STRIDE 모델은 위협을 (S)poofing, (T)ampering, (R)epudiation, (I)nformation Disclosure, (D)enial of Service, (E)levation of Privilege 의 6가지 범주로 분류한다. 본 시스템의 주요 위협과 대응 통제는 다음과 같다."),
  table([
    ["위협 범주", "구체적 위협 시나리오", "주된 대응 통제"],
    ["S — Spoofing", "타인 자격으로 로그인", "비밀번호 + TOTP + 세션 핀닝"],
    ["T — Tampering", "감사 로그 사후 조작", "SHA-256 해시 체인"],
    ["T — Tampering", "영상 파일 직접 수정", "AES-256-GCM 의 GCM 태그"],
    ["R — Repudiation", "관리자가 reveal 사실 부인", "audit_log 의 추가 전용 INSERT + 트리거"],
    ["I — Info Disclosure", "RTSP URL 평문 노출", "CAMERA_URL_KEY AES-256-GCM"],
    ["I — Info Disclosure", "viewer 가 admin 데이터 조회", "RLS 정책 (11개 테이블)"],
    ["I — Info Disclosure", "FastAPI /docs 공개", "프로덕션에서 비활성화"],
    ["D — DoS", "로그인 폭주 시도", "Rate limit (5/min reauth)"],
    ["D — DoS", "ML 서비스 과부하", "토큰 인증 + 큐 백프레셔"],
    ["E — Elevation", "viewer 가 admin 권한 획득", "is_admin() + auth.role() 이중 검사"],
    ["E — Elevation", "SQL injection 으로 RLS 우회", "Zod 입력 검증 + 매개변수화 쿼리"],
  ], [1800, 3800, 3760]),

  p("STRIDE 의 12가지 시나리오는 모두 본 시스템에서 다층적 통제로 완화된다. 각 통제의 구체적 구현은 제 7 장에서 다룬다. 7장의 침투 시험에서는 위 12가지 시나리오 각각에 대해 실제 공격 시도를 수행하여, 모든 시도가 차단됨을 확인하였다."),
];
