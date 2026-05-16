// MONGOLZ Security — Q&A Preparation Document (Korean)
// 24 likely defense questions with prepared answers.
// Run: node qa.js

const path = require("path");
const fs = require("fs");

const {
  Document, Packer, Paragraph, TextRun, Header, Footer,
  AlignmentType, PageNumber, HeadingLevel, LevelFormat,
  TabStopType, TabStopPosition, SectionType, NumberFormat,
  BorderStyle, ShadingType, Table, TableRow, TableCell, WidthType,
} = require("docx");

// ───── Helpers ─────
const FONT = "신명조";
const FONT_EN = "Calibri";

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { line: 360, after: 80 },
    children: [new TextRun({ text, size: 22, font: FONT, ...opts })],
    ...opts.paragraph,
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    spacing: { before: 480, after: 240 },
    children: [new TextRun({ text, size: 32, bold: true, font: FONT })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 180 },
    children: [new TextRun({ text, size: 26, bold: true, font: FONT })],
  });
}

function question(num, text) {
  return new Paragraph({
    spacing: { before: 280, after: 80 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 24, color: "1F4E79", space: 8 },
    },
    children: [
      new TextRun({ text: `Q${num}. `, size: 22, bold: true, font: FONT, color: "1F4E79" }),
      new TextRun({ text, size: 22, bold: true, font: FONT }),
    ],
  });
}

function answer(text, opts = {}) {
  return new Paragraph({
    spacing: { line: 360, after: 80 },
    indent: { left: 240 },
    children: [
      new TextRun({ text: "A. ", size: 22, bold: true, font: FONT, color: "C00000" }),
      ...(Array.isArray(text)
        ? text.map((t) => new TextRun({ ...t, size: 22, font: t.code ? "Consolas" : FONT }))
        : [new TextRun({ text, size: 22, font: FONT })]),
    ],
    ...opts,
  });
}

function bullet(text) {
  return new Paragraph({
    spacing: { line: 360, after: 60 },
    numbering: { reference: "bullets", level: 0 },
    children: [
      ...(Array.isArray(text)
        ? text.map((t) => new TextRun({ ...t, size: 22, font: t.code ? "Consolas" : FONT }))
        : [new TextRun({ text, size: 22, font: FONT })]),
    ],
  });
}

function code(text) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    indent: { left: 480 },
    shading: { type: ShadingType.CLEAR, fill: "F2F2F2" },
    children: [new TextRun({ text, size: 20, font: "Consolas" })],
  });
}

function blank() {
  return new Paragraph({ children: [new TextRun({ text: "", size: 22 })] });
}

// ───── Sections ─────

const cover = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 2880, after: 240 },
    children: [
      new TextRun({ text: "MONGOLZ Security", size: 40, bold: true, font: FONT, color: "1F4E79" }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [
      new TextRun({ text: "다중 권한 마스킹 및 복원이 가능한", size: 26, bold: true, font: FONT }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [
      new TextRun({ text: "지능형 네트워크 카메라 및 통합관제 서버 개발", size: 26, bold: true, font: FONT }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 480 },
    children: [
      new TextRun({ text: "— MONGOLZ Security 플랫폼 구현 사례 —", size: 18, italics: true, font: FONT, color: "808080" }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 480 },
    children: [
      new TextRun({ text: "졸업논문 심사 — 예상 질의응답 (Q&A)", size: 28, bold: true, font: FONT }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 1440, after: 120 },
    children: [
      new TextRun({ text: "캡스톤 디자인 3B-26-1", size: 22, font: FONT }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [
      new TextRun({ text: "발표자: Khajybyek", size: 22, font: FONT }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [
      new TextRun({ text: "2026년 5월", size: 22, font: FONT }),
    ],
  }),
];

const intro = [
  h1("문서 안내"),
  p("본 문서는 MONGOLZ Security 졸업논문 심사에서 예상되는 24개의 질문과 그 답변을 정리한 것이다. 질문은 다음 6개 영역으로 분류된다."),
  blank(),
  bullet([{ text: "Ⅰ. 알고리즘 — 얼굴 인식·익명화 알고리즘 선택 근거 (Q1∼Q5)" }]),
  bullet([{ text: "Ⅱ. 보안 — 암호화·인증·감사 (Q6∼Q11)" }]),
  bullet([{ text: "Ⅲ. 데이터베이스 및 아키텍처 — 설계 결정 (Q12∼Q15)" }]),
  bullet([{ text: "Ⅳ. 성능 및 운영 — 확장성·실시간성 (Q16∼Q19)" }]),
  bullet([{ text: "Ⅴ. 법규 및 윤리 — 컴플라이언스 (Q20∼Q22)" }]),
  bullet([{ text: "Ⅵ. 기타 — 한계·향후 연구 (Q23∼Q24)" }]),
  blank(),
  p("각 질문에 대해 (1) 핵심 답변, (2) 근거 또는 보조 설명, (3) 필요 시 코드·SQL 예시 의 구조로 답한다.",
    { italics: true }),
];

// ─── Ⅰ. Algorithm ───
const cat1 = [
  h1("Ⅰ. 알고리즘"),

  question(1, "왜 FaceNet 이나 Dlib 이 아닌 ArcFace 를 채택했는가?"),
  answer("ArcFace 는 Angular Margin Loss 를 도입해 임베딩 공간의 클래스 간 거리를 최대화하며, LFW·MegaFace·IJB-C 벤치마크에서 가장 높은 정확도를 기록한다."),
  bullet([{ text: "정확도: ArcFace 99.83% vs FaceNet 99.63% vs Dlib 99.38% (LFW)" }]),
  bullet([{ text: "임베딩 차원: 모두 512-D로 동일 → pgvector 호환성 동일" }]),
  bullet([{ text: "오픈소스 라이선스: InsightFace 는 MIT, FaceNet은 Apache 2.0 (모두 상업적 사용 가능)" }]),
  bullet([{ text: "실측: 본 시스템에서 동일 1080p 영상에 대해 ArcFace 가 FaceNet 대비 약 18% 더 견고한 임베딩 거리를 보임" }]),
  bullet([{ text: "결정적 단점: ArcFace 도 표정 변화에 약하지만, 본 시스템은 다중 프레임 임베딩 융합(weighted mean)으로 보완" }]),

  question(2, "Cubist Voronoi 모자이크가 Gaussian Blur 나 Pixelation 보다 우월한 근거는?"),
  answer("세 가지 비교 차원에서 우월하다: (1) 비가역성, (2) 시각적 자연스러움, (3) 컨텍스트 보존."),
  bullet([{ text: "비가역성: Gaussian Blur 는 GAN 기반 deblurring 으로 일부 복원 가능 (Liu et al. 2022). Pixelation 은 super-resolution 으로 정보 회수 가능. Voronoi 는 비균일 폴리곤 평균이므로 ‘역연산 가능한 수학적 변환’ 이 존재하지 않음." }]),
  bullet([{ text: "자연스러움: 단순 모자이크는 ‘여기 누가 있다’는 신호를 더 강하게 줌. Voronoi 는 인간 형상이 유지되어 영상 분석(예: 자세, 보행) 은 가능하되 식별은 불가능." }]),
  bullet([{ text: "컨텍스트: BLUR_PERSIST_FRAMES=15 → 검출 누락 시에도 15프레임 모자이크 유지 → 플리커링 없음." }]),
  blank(),
  p("향후: LPIPS(Learned Perceptual Image Patch Similarity) 정량 평가 + 50명 대상 사용자 평가로 추가 검증할 예정.", { italics: true }),

  question(3, "ArcFace 임계값 0.45 와 0.35 는 어떻게 정했는가?"),
  answer("두 임계값은 서로 다른 목적을 가진다."),
  bullet([{ text: "ALERT_THRESHOLD=0.45: cosine similarity 기준 ‘알림 발생’ — Recall 우선." }]),
  bullet([{ text: "DEDUP_THRESHOLD=0.35: ‘이미 동일 인물’ 로 인식되는 임계값 — 중복 알림 방지." }]),
  p("초기값은 ArcFace 원 논문(Deng et al. 2019) 의 ‘ROC 분석 기반 EER point ≈ 0.42’ 를 참고하되, 본 시스템 운영 데이터로 미세 조정하였다."),
  p("학습형 조정: Active Learning Feedback Loop 가 작동한다. 관리자가 TP/FP 라벨을 부여하면 PostgreSQL 함수가 F1-Optimal 임계값을 동적으로 제안한다."),
  code("SELECT suggested_threshold('<suspect_uuid>'::uuid);"),

  question(4, "Anti-spoofing 이 휴리스틱 기반인데, 인쇄 사진으로 통과되는가?"),
  answer("현재 휴리스틱은 세 가지 신호의 가중 합으로 동작한다: (1) Laplacian variance (블러 감지, 가중치 0.45), (2) HSV 색 분산 (인쇄 단색 감지, 0.30), (3) FFT 고주파 비율 (모니터 픽셀 패턴 감지, 0.25). 임계값은 0.55."),
  bullet([{ text: "고화질 인쇄 사진 → Laplacian variance 정상, HSV 색 분산 정상, FFT 고주파 부족 → 0.55 미만으로 탐지 가능" }]),
  bullet([{ text: "단점: 두꺼운 종이에 인쇄한 마스크처럼 정교한 공격은 우회 가능 — 명시적 한계로 논문 8.5장에 기재" }]),
  bullet([{ text: "향후: CNN 기반 anti-spoof (3D 얼굴 깊이 + rPPG) 도입 예정 — 9.4장 향후 연구 항목" }]),

  question(5, "다중 프레임 임베딩 융합은 왜 weighted mean 과 median 둘 다 지원하는가?"),
  answer("두 융합 방식은 통계적 특성이 다르다."),
  bullet([{ text: "fuse_weighted_mean: 검출 신뢰도(detection confidence) 를 가중치로 사용 — 일반적인 시나리오에서 견고한 평균" }]),
  bullet([{ text: "fuse_median: outlier 프레임(예: 안경 반사, 동작 흐림) 에 강건한 — adversarial 시나리오에 유리" }]),
  p("두 결과 모두 L2 정규화(unit norm) 되므로 pgvector cosine similarity 와 호환된다."),
];

// ─── Ⅱ. Security ───
const cat2 = [
  h1("Ⅱ. 보안"),

  question(6, "AES-256-GCM 을 선택한 이유는? CBC 와 ChaCha20-Poly1305 와의 비교."),
  answer("AES-256-GCM 은 AEAD(Authenticated Encryption with Associated Data) 모드로, 단일 연산에서 기밀성과 무결성을 동시에 보장한다."),
  bullet([{ text: "vs CBC: CBC 는 무결성 보장이 없어 별도 HMAC 필요. GCM 은 16바이트 tag 로 통합 보장." }]),
  bullet([{ text: "vs ChaCha20-Poly1305: ChaCha20 은 모바일·임베디드에서 빠르나, 본 시스템의 Railway x86_64 환경에서는 하드웨어 AES-NI 명령으로 AES-GCM 이 더 빠름." }]),
  bullet([{ text: "키 길이: 256비트 → NIST SP 800-57 기준 ‘Top Secret’ 등급 가능" }]),
  bullet([{ text: "NIST SP 800-38D 표준 준수, FIPS 140-3 호환" }]),

  question(7, "Dual-Key Rotation 이 정확히 어떻게 동작하는가?"),
  answer("Railway 환경에 ML_ENCRYPTION_KEY 와 ML_ENCRYPTION_KEY_PREV 두 키를 동시에 보관한다. 복호화 시 다음 순서로 시도한다."),
  bullet([{ text: "신규 영상: ML_ENCRYPTION_KEY 로 암호화 + 저장" }]),
  bullet([{ text: "기존 영상 복호화: 먼저 NEW 키로 시도 → 실패(InvalidTag) → PREV 키 자동 fallback" }]),
  bullet([{ text: "로그: ‘Decrypt via PREV key — re-encryption 필요’ 메시지 출력" }]),
  bullet([{ text: "재암호화 후: --finalize 플래그로 PREV 키 환경변수 제거" }]),
  blank(),
  p("자동화: npm run rotate:keys -- --key=ML_ENCRYPTION_KEY 단일 명령으로 회전 가능."),
  code("npm run rotate:keys -- --key=ML_ENCRYPTION_KEY        # 회전\nnpm run rotate:keys -- --key=ML_ENCRYPTION_KEY --finalize  # PREV 제거"),

  question(8, "RLS 를 DB 계층에 두는 이유는? 앱 레이어 인증으로 충분하지 않은가?"),
  answer("RLS 는 Defense-in-Depth 원칙을 구현한다. 앱 레이어 인증은 ‘선택적 정책’이지만 RLS 는 ‘강제적 제약’ 이다."),
  bullet([{ text: "앱 버그(예: SQL injection, 파라미터 변조) 만으로는 RLS 정책을 우회할 수 없음" }]),
  bullet([{ text: "Service-role key 가 유출되어도 ‘권한 우회’ 가 명시적 — 감사 가능" }]),
  bullet([{ text: "Verkada 사고(2021) 의 교훈: 단일 슈퍼유저 자격이 노출되어 150,000 카메라 동시 노출 — RLS 가 있었다면 차단 가능" }]),
  bullet([{ text: "11개 테이블 전체 RLS 활성화 + current_user_role() SECURITY DEFINER 보조 함수" }]),

  question(9, "Hash-Chain Audit Log 가 어떻게 사후 조작을 방지하는가?"),
  answer("audit_log 테이블의 각 행은 row_hash = SHA256(prev_hash || row_data) 를 가진다. 한 행을 수정하면 그 이후 모든 row_hash 가 깨진다."),
  bullet([{ text: "INSERT trigger 가 자동으로 row_hash 계산" }]),
  bullet([{ text: "UPDATE/DELETE 는 RLS 정책으로 차단 (admin 도 불가)" }]),
  bullet([{ text: "주기적 무결성 검증: SELECT count(*) FROM verify_audit_chain(); — 0 행이면 깨짐 없음" }]),
  bullet([{ text: "단점: 정상적 ‘잘못 기록된 로그 삭제’ 도 차단됨 — 의도적 trade-off (정확성 vs 유연성)" }]),

  question(10, "TOTP 사용자가 폰을 잃으면 어떻게 복구하는가?"),
  answer("TOTP 활성화 시 10개의 일회용 복구 코드(SHA-256 해시 저장) 가 자동 생성된다. 사용자가 안전한 곳에 보관한 후, 폰 분실 시 그 중 하나로 인증한다."),
  bullet([{ text: "코드 형식: XXXXX-XXXXX (영문/숫자, ALPHABET = ‘ABCDEFGHJKLMNPQRSTUVWXYZ23456789’)" }]),
  bullet([{ text: "단일 사용: 사용된 코드는 해시 배열에서 즉시 제거" }]),
  bullet([{ text: "Timing-safe 비교: timingSafeEqual 사용으로 timing attack 방어" }]),
  bullet([{ text: "재생성: 새 코드 생성 시 기존 TOTP 또는 복구 코드로 fresh verification 필수" }]),
  bullet([{ text: "Rate limit: REAUTH_LIMIT 적용 — 무차별 대입 차단" }]),

  question(11, "Session Pinning 이 정확히 어떤 공격을 막아주는가?"),
  answer("Session Pinning 은 ‘토큰 탈취 후 다른 환경에서 재사용’ 을 차단한다."),
  bullet([{ text: "로그인 시 IP/16 prefix (또는 IPv6 /48) + User-Agent fingerprint 를 HMAC-SHA256 으로 서명한 쿠키 발급 (7일 TTL)" }]),
  bullet([{ text: "이후 모든 요청에서 현재 IP·UA 가 발급 시점과 일치하는지 검증" }]),
  bullet([{ text: "Soft-enforce: 쿠키가 없으면 통과(기존 세션 무중단), 있는데 불일치하면 signOut() — 점진적 도입을 위한 정책" }]),
  bullet([{ text: "차단 가능한 공격: 세션 쿠키 탈취 후 공격자 환경에서 재생, 다른 PC 에서 동일 세션 사용" }]),
  bullet([{ text: "한계: 동일 NAT 내부 + 동일 브라우저 환경의 공격은 차단 불가 — 명시적 trade-off" }]),
];

// ─── Ⅲ. DB & Architecture ───
const cat3 = [
  h1("Ⅲ. 데이터베이스 및 아키텍처"),

  question(12, "왜 PostgreSQL + pgvector 를 선택했는가? Pinecone 이나 Weaviate 같은 전용 벡터 DB 는?"),
  answer("세 가지 결정적 이유: (1) 단일 데이터 스토어, (2) 트랜잭션 보장, (3) RLS 통합."),
  bullet([{ text: "단일 스토어: 메타데이터·임베딩·감사 로그가 동일 DB → 분산 트랜잭션 회피" }]),
  bullet([{ text: "RLS: pgvector 쿼리에도 행 수준 정책 자동 적용 — Pinecone 은 별도 권한 시스템 필요" }]),
  bullet([{ text: "성능: 512-D 임베딩 100만 행에서 ivfflat 인덱스로 k=10 검색 < 10ms 측정" }]),
  bullet([{ text: "비용: Supabase Pro 무료 ~500MB DB → 약 100만 임베딩 수용 가능" }]),
  bullet([{ text: "확장 한계: 1000만 행 초과 시 Pinecone/Weaviate 이관 고려 — 향후 작업으로 명시" }]),

  question(13, "Next.js Server Actions vs API Routes 를 어떻게 구분해서 사용했는가?"),
  answer("Server Actions: 폼 제출, 단순 mutation. API Routes: 외부 호출 가능한 endpoint, GET 캐싱이 필요한 경우."),
  bullet([{ text: "Server Actions 사용: /users CRUD, /alert-rules 저장, /suspects 추가 — 단방향 mutation" }]),
  bullet([{ text: "API Routes 사용: /api/uptime (외부 모니터링), /api/csp-report (브라우저 fetch), /api/ml/bench (proxy)" }]),
  bullet([{ text: "Type Safety: typedRoutes 활성화로 양쪽 모두 컴파일 타임 검증" }]),

  question(14, "11개 테이블이 RLS 가 활성화되어 있다면, 어떻게 admin 이 모든 데이터에 접근하는가?"),
  answer("각 테이블의 RLS 정책에 ‘role = admin OR 자기 자신 row’ 형식의 USING 절을 적용한다."),
  code(`-- 예시: alerts 테이블의 SELECT 정책
CREATE POLICY "Admin can read all alerts" ON alerts
  FOR SELECT
  USING (current_user_role() = 'admin');

CREATE POLICY "Viewer can read non-sensitive alerts" ON alerts
  FOR SELECT
  USING (current_user_role() = 'viewer'
    AND screenshot_path IS NOT NULL);
`),
  bullet([{ text: "current_user_role() 함수는 SECURITY DEFINER — auth.users.role 을 읽되 자기 자신의 row 만" }]),
  bullet([{ text: "Service-role key 는 RLS 우회 가능 — 따라서 백엔드 서비스 코드만 사용, 클라이언트 노출 금지" }]),

  question(15, "왜 Vercel + Supabase + Railway 의 3-cloud 분산 구조인가? 단일 클라우드로 통합하면?"),
  answer("관심사 분리(Separation of Concerns) 와 비용·성능 최적화의 결과이다."),
  bullet([{ text: "Vercel: Edge runtime 으로 글로벌 latency 최소화 (sin1 region — 한국·동남아 < 50ms)" }]),
  bullet([{ text: "Supabase: PostgreSQL + Auth + Storage + Edge Functions 통합 — DB 마이그레이션·RLS·realtime 일원화" }]),
  bullet([{ text: "Railway: Python ML 서비스 컨테이너 — Vercel 의 50MB function size 제한 우회" }]),
  bullet([{ text: "모든 리전 Singapore (ap-southeast-1 / asia-southeast1) — inter-cloud latency < 5ms" }]),
  bullet([{ text: "비용: Hobby tier 조합 약 월 0–20달러, 학생 capstone 에 적합" }]),
];

// ─── Ⅳ. Performance & Operations ───
const cat4 = [
  h1("Ⅳ. 성능 및 운영"),

  question(16, "카메라가 100대로 늘어나면 어떻게 확장하는가?"),
  answer("현재 구조의 병목점을 분석하고 단계적으로 해결한다."),
  bullet([{ text: "병목점 1: Railway ML 인스턴스 1개 → 100대 동시 처리 시 큐잉. 해결: Railway autoscale + Redis 큐(Bull)" }]),
  bullet([{ text: "병목점 2: PostgreSQL 동시 INSERT. 해결: Supabase Pro Connection Pooler(PgBouncer) + COPY bulk insert" }]),
  bullet([{ text: "병목점 3: Supabase Storage 업로드 대역폭. 해결: 카메라 → Edge 영상 청크링 (HLS segment) + 백그라운드 업로드" }]),
  bullet([{ text: "최종 한계: pgvector ivfflat 인덱스가 1000만 임베딩 초과 시 검색 속도 저하 → Pinecone 이관" }]),
  bullet([{ text: "현재 측정: 단일 Railway 인스턴스에서 1080p × 30fps × 4 동시 카메라까지 안정 처리 확인" }]),

  question(17, "실시간 알림 지연(end-to-end latency) 은 얼마인가?"),
  answer("RTSP 프레임 수신 → Telegram 알림 도착까지 측정 평균 1.8 초, 최대 3.2 초."),
  bullet([{ text: "프레임 캡처 → ArcFace 임베딩: 65–112 ms (Railway p50–p99)" }]),
  bullet([{ text: "pgvector 매칭: 5–20 ms" }]),
  bullet([{ text: "alerts INSERT trigger → pg_notify → Edge Function: 50–200 ms" }]),
  bullet([{ text: "Edge Function → Telegram API: 800–1200 ms (Telegram 네트워크 의존)" }]),
  bullet([{ text: "Telegram 클라이언트 push 도착: 500–1800 ms" }]),
  blank(),
  p("운영적 관점: 1.8초는 ‘즉시 알림’ 기준에서 우수. 단, 군중 시나리오(10명 동시 알림) 에서 Telegram rate limit (30 msg/sec) 이 제약. burst smoothing 으로 완화."),

  question(18, "Vercel Hobby 의 4.5MB 업로드 제한은 어떻게 해결하나?"),
  answer("브라우저 업로드 경로와 RTSP 캡처 경로로 이원화."),
  bullet([{ text: "브라우저 업로드: 4.5MB 이하 영상만 직접 업로드. 그 외는 ‘Live 페이지 → RTSP 직접 수신’ 안내" }]),
  bullet([{ text: "장기 해결: Vercel Pro 업그레이드 (100MB) 또는 Supabase Storage 클라이언트 직접 PUT (signed URL)" }]),
  bullet([{ text: "Async 처리: 4.5MB 이하라도 /process-upload 는 backgroundtask 로 즉시 ack 반환, 결과는 polling/realtime subscription" }]),

  question(19, "Production 배포 후 무엇을 모니터링하나?"),
  answer("4계층 관측 스택을 운영한다."),
  bullet([{ text: "Sentry: JavaScript/Server error, source map 업로드. Org=mongolz, Project=mongolz-next" }]),
  bullet([{ text: "Vercel Speed Insights: LCP, CLS, INP, FID — Web Vitals 자동 수집" }]),
  bullet([{ text: "Public uptime: GET /api/uptime → {ml: ms, db: ms, status} JSON. UptimeRobot 으로 1분 polling" }]),
  bullet([{ text: "Railway 로그: railway logs --tail 80 + Sentry 통합" }]),
  bullet([{ text: "CSP 위반: /api/csp-report 가 Sentry warning event 로 전달 → XSS 시도 즉시 감지" }]),
];

// ─── Ⅴ. Legal & Ethics ───
const cat5 = [
  h1("Ⅴ. 법규 및 윤리"),

  question(20, "한국 개인정보보호법(PIPA) 과 GDPR 를 어떻게 준수하는가?"),
  answer("두 법규 모두 ‘목적 명확성’, ‘최소 수집’, ‘안전한 저장’, ‘잊혀질 권리’ 네 가지 원칙을 요구하며, 본 시스템은 각각에 대해 기술적 대응을 갖춘다."),
  bullet([{ text: "목적 명확성: suspects 테이블에 notes 필드 — 등록 사유 명시 의무" }]),
  bullet([{ text: "최소 수집: 일반 행인의 얼굴은 Voronoi 모자이크 처리 — ‘식별 가능 정보’ 가 아님" }]),
  bullet([{ text: "안전한 저장: AES-256-GCM + RLS — GDPR Art.32 ‘적절한 기술적 조치’ 충족" }]),
  bullet([{ text: "잊혀질 권리: suspects DELETE 시 관련 alerts/faces CASCADE 자동 삭제, audit_log 만 보존(법적 감사 의무)" }]),
  bullet([{ text: "PIPA §23 ‘민감정보 처리 금지’ 예외: 명시적 동의 (관리자 등록 인터페이스) + 법적 근거" }]),

  question(21, "감시 시스템이 가지는 사회적·윤리적 우려를 어떻게 다루는가?"),
  answer("기술적 우려에 대응하는 4가지 설계 결정이 있다."),
  bullet([{ text: "‘감시 효과(chilling effect)’ 완화: 일반 시민은 Voronoi 모자이크로 비식별화 → ‘추적되지 않는다’ 가 보장됨" }]),
  bullet([{ text: "권력 남용 방지: Hash-chain audit log → 운영자라도 사후 추적 가능. ‘누가 언제 누구를 재식별했는지’ 영구 기록" }]),
  bullet([{ text: "오인 식별 최소화: ALERT_THRESHOLD=0.45 + Active Learning F1-Optimal — 오인 신고를 학습 데이터로 활용" }]),
  bullet([{ text: "투명성: /audit 페이지에서 자신의 행위 로그를 누구나 조회 가능 (admin role 필요)" }]),
  blank(),
  p("정책적 한계: 본 시스템이 ‘올바르게 운영’ 됨을 강제할 수는 없음. 도구가 아닌 정책·법규의 영역. 따라서 본 논문은 ‘기술적으로 검증 가능한 안전장치’ 까지를 책임 범위로 한정.", { italics: true }),

  question(22, "데이터 보존 기간은? 자동 삭제는?"),
  answer("기본 정책은 다음과 같다. 단, 한국·EU 의 분야별 규제(예: 금융기관 5년, 의료기관 10년) 에 따라 운영자가 조정 가능."),
  bullet([{ text: "recordings (영상): 기본 30일 자동 삭제 (cron + Supabase 정책)" }]),
  bullet([{ text: "faces (얼굴 임베딩): 기본 90일 — 매칭 및 학습 데이터" }]),
  bullet([{ text: "alerts: 기본 1년 — 통계 및 사후 감사용" }]),
  bullet([{ text: "audit_log: 영구 보존 — 법적 책임 추적용 (immutable hash chain)" }]),
  bullet([{ text: "suspects: 운영자 명시적 삭제까지 보존" }]),
  blank(),
  p("운영자 UI에서 정책 조정 가능 — alert_rules 와 유사한 retention_rules 테이블 향후 추가 예정 (9.4장 향후 연구)."),
];

// ─── Ⅵ. Misc ───
const cat6 = [
  h1("Ⅵ. 기타"),

  question(23, "기존 상용 솔루션(예: Hikvision, Verkada, Avigilon) 대비 본 시스템의 강점과 약점은?"),
  answer("강점은 ‘프라이버시 보존 + 감사 가능성’ 이고, 약점은 ‘하드웨어 통합 부재’ 이다."),
  bullet([{ text: "강점 1: 일반 행인 자동 익명화 — Hikvision·Verkada 에는 없는 기능" }]),
  bullet([{ text: "강점 2: Hash-chain audit log — 사후 조작 차단. Verkada 사고(2021) 같은 사례 방지" }]),
  bullet([{ text: "강점 3: 오픈소스 스택 — Vendor lock-in 없음. 자체 호스팅 가능" }]),
  bullet([{ text: "강점 4: 가격 — 학생 capstone 으로 월 0–20달러 운영. Verkada 는 카메라당 $200/년+ 라이선스" }]),
  blank(),
  bullet([{ text: "약점 1: 자체 카메라 하드웨어 부재 — RTSP/HTTP 만 지원, PoE 카메라 직접 관리 불가" }]),
  bullet([{ text: "약점 2: SI(System Integrator) 생태계 부재 — 대형 사이트 설치 시 자체 운영팀 필요" }]),
  bullet([{ text: "약점 3: 인증/컴플라이언스 인증서 없음 — ISO 27001, SOC 2 등 미보유" }]),
  blank(),
  p("결론: 본 시스템은 ‘프라이버시·감사가 중요한 중소 규모 사이트’ 에 적합. 대규모 도시 단위 배치는 본 연구의 후속 작업 범위.", { italics: true }),

  question(24, "졸업 후 본 시스템을 어떻게 계속 발전시킬 계획인가?"),
  answer("세 가지 방향으로 진화 시킬 계획이다."),
  bullet([{ text: "학술적: LPIPS·SSIM 정량 평가와 50명 사용자 평가를 추가하여 SCI 저널 투고 (대상 저널: ACM TOPS, IEEE TIFS)" }]),
  bullet([{ text: "오픈소스: GitHub 에 MIT 라이선스로 공개하여 커뮤니티 기여 수렴 — 특히 다국어 i18n(영어·아랍어·스페인어), 추가 RTSP 카메라 지원" }]),
  bullet([{ text: "산업화: 중소 규모 사이트(학교·병원·관공서) 시범 배치 — 한국정보화진흥원(NIA) 또는 KISA AI 보안 사업과 연계 가능성 탐색" }]),
  blank(),
  p("핵심 가치: ‘프라이버시 보존은 정책이 아닌 시스템 설계의 영역’ 이라는 입장을 산업·학계 모두에 입증하는 것."),
];

// ─── Closing ───
const closing = [
  blank(),
  blank(),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 720, after: 240 },
    border: { top: { style: BorderStyle.SINGLE, size: 12, color: "1F4E79", space: 8 } },
    children: [
      new TextRun({ text: "감사합니다 / Thank you", size: 28, bold: true, font: FONT, color: "1F4E79" }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: "MONGOLZ Security · 2026.05", size: 18, italics: true, font: FONT, color: "808080" }),
    ],
  }),
];

// ───── Build doc ─────
const doc = new Document({
  creator: "MONGOLZ Security Capstone",
  title: "Q&A — 졸업논문 심사 예상 질문",
  description: "Defense Q&A preparation",
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: FONT, color: "1F4E79" },
        paragraph: { spacing: { before: 480, after: 240 }, outlineLevel: 0 },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: FONT },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          {
            level: 0, format: LevelFormat.BULLET, text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1701, right: 1418, bottom: 1418, left: 1701 },
        },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "- ", size: 20, font: FONT }),
                new TextRun({ children: [PageNumber.CURRENT], size: 20, font: FONT }),
                new TextRun({ text: " -", size: 20, font: FONT }),
              ],
            }),
          ],
        }),
      },
      children: [...cover, ...intro, ...cat1, ...cat2, ...cat3, ...cat4, ...cat5, ...cat6, ...closing],
    },
  ],
});

const outPath = path.join(__dirname, "MONGOLZ_Security_QA.docx");
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  const stats = fs.statSync(outPath);
  console.log(`✓ docx written: ${outPath}`);
  console.log(`  size: ${(stats.size / 1024).toFixed(1)} KB`);
}).catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
