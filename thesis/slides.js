// MONGOLZ Security — Capstone Defense Slides (Korean)
// Dark theme matching the app aesthetic.
// Run: node slides.js

const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5 inches
pres.author = "MONGOLZ Security Capstone";
pres.company = "Capstone 3B-26-1";
pres.title = "다중 권한 마스킹 및 복원이 가능한 지능형 네트워크 카메라 및 통합관제 서버 개발";

// ───── Palette ─────
const BG       = "0A0A1E";       // dark navy (app bg)
const BG2      = "12122A";       // secondary
const BG3      = "1A1A3A";       // tertiary
const ACCENT   = "00D4FF";       // cyan
const ACCENT_M = "0099CC";       // muted cyan
const TEXT     = "F5F5FA";       // off-white
const MUTED    = "9FA8C0";       // muted gray-blue
const DANGER   = "FF3860";
const SUCCESS  = "23D160";
const WARNING  = "FFDD57";

const FONT_H = "Calibri";
const FONT_B = "Calibri";

// Slide dimensions
const W = 13.3;
const H = 7.5;

// ───── Common helpers ─────
function addBg(slide, color = BG) {
  slide.background = { color };
}

function addAccentBar(slide, opts = {}) {
  // Thin top accent bar
  slide.addShape("rect", {
    x: 0, y: 0, w: W, h: 0.08,
    fill: { color: ACCENT },
    line: { type: "none" },
    ...opts,
  });
}

function addFooter(slide, pageNum, totalPages) {
  slide.addText("MONGOLZ Security · Capstone 3B-26-1", {
    x: 0.5, y: H - 0.4, w: 6, h: 0.3,
    fontFace: FONT_B, fontSize: 9, color: MUTED, margin: 0,
  });
  slide.addText(`${pageNum} / ${totalPages}`, {
    x: W - 1.5, y: H - 0.4, w: 1, h: 0.3,
    fontFace: FONT_B, fontSize: 9, color: MUTED, align: "right", margin: 0,
  });
}

function addTitle(slide, title, subtitle) {
  // Accent dot
  slide.addShape("ellipse", {
    x: 0.5, y: 0.55, w: 0.18, h: 0.18,
    fill: { color: ACCENT }, line: { type: "none" },
  });
  slide.addText(title, {
    x: 0.85, y: 0.4, w: W - 1.5, h: 0.6,
    fontFace: FONT_H, fontSize: 28, bold: true, color: TEXT, margin: 0,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.85, y: 0.95, w: W - 1.5, h: 0.35,
      fontFace: FONT_B, fontSize: 13, italic: true, color: MUTED, margin: 0,
    });
  }
}

const totalSlides = 17;
let pageNum = 0;

// ═════════════════════════════════════════════════════════════════════
// SLIDE 1 — Title
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s, BG);

  // Decorative diagonal gradient bands
  s.addShape("rect", { x: 0, y: 0, w: W, h: H, fill: { color: BG }, line: { type: "none" } });
  s.addShape("rect", { x: 0, y: 0, w: 0.25, h: H, fill: { color: ACCENT }, line: { type: "none" } });

  // Brand mark
  s.addText("MONGOLZ", {
    x: 0.7, y: 0.6, w: 5, h: 0.5,
    fontFace: FONT_H, fontSize: 26, bold: true, color: ACCENT, charSpacing: 10, margin: 0,
  });
  s.addText("SECURITY", {
    x: 0.7, y: 1.05, w: 5, h: 0.35,
    fontFace: FONT_H, fontSize: 12, color: MUTED, charSpacing: 8, margin: 0,
  });

  // Title (3 lines for the full Korean title)
  s.addText("다중 권한 마스킹 및 복원이 가능한", {
    x: 0.7, y: 2.3, w: W - 1.4, h: 0.65,
    fontFace: FONT_H, fontSize: 28, bold: true, color: TEXT, margin: 0,
  });
  s.addText("지능형 네트워크 카메라 및", {
    x: 0.7, y: 2.95, w: W - 1.4, h: 0.65,
    fontFace: FONT_H, fontSize: 32, bold: true, color: ACCENT, margin: 0,
  });
  s.addText("통합관제 서버 개발", {
    x: 0.7, y: 3.6, w: W - 1.4, h: 0.7,
    fontFace: FONT_H, fontSize: 36, bold: true, color: ACCENT, margin: 0,
  });

  // Subtitle — English title + tag
  s.addText("— MONGOLZ Security 플랫폼 구현 사례 —", {
    x: 0.7, y: 4.4, w: W - 1.4, h: 0.4,
    fontFace: FONT_B, fontSize: 14, italic: true, color: MUTED, margin: 0,
  });
  s.addText(
    "Development of an Intelligent Network Camera and Integrated Control Server with Multi-Authority Masking and Restoration",
    {
      x: 0.7, y: 4.7, w: W - 1.4, h: 0.5,
      fontFace: FONT_B, fontSize: 11, italic: true, color: MUTED, margin: 0,
    }
  );

  // Divider line
  s.addShape("line", {
    x: 0.7, y: 5.4, w: 4, h: 0,
    line: { color: ACCENT, width: 2 },
  });

  // Author block
  s.addText(
    [
      { text: "발표자 ", options: { color: MUTED, fontSize: 11 } },
      { text: "Khajybyek", options: { color: TEXT, fontSize: 14, bold: true, breakLine: true } },
      { text: "지도교수 ", options: { color: MUTED, fontSize: 11 } },
      { text: "○○○ 교수님", options: { color: TEXT, fontSize: 14, bold: true, breakLine: true } },
      { text: "과목 ", options: { color: MUTED, fontSize: 11 } },
      { text: "캡스톤 디자인 (3B-26-1)", options: { color: TEXT, fontSize: 14, bold: true, breakLine: true } },
      { text: "발표일 ", options: { color: MUTED, fontSize: 11 } },
      { text: "2026년 5월", options: { color: TEXT, fontSize: 14, bold: true } },
    ],
    { x: 0.7, y: 5.55, w: W - 1.4, h: 1.4, fontFace: FONT_B, margin: 0, paraSpaceAfter: 4 }
  );

  // URL footer
  s.addText("mongolz.vercel.app", {
    x: 0.7, y: H - 0.5, w: 5, h: 0.3,
    fontFace: FONT_B, fontSize: 11, color: ACCENT, margin: 0,
  });
  s.addText(`${pageNum} / ${totalSlides}`, {
    x: W - 1.5, y: H - 0.5, w: 1, h: 0.3,
    fontFace: FONT_B, fontSize: 10, color: MUTED, align: "right", margin: 0,
  });
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 2 — 목차
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "목차", "Agenda");

  const items = [
    ["01", "연구 배경 및 동기", "Background and Motivation"],
    ["02", "문제 제기 (P1–P5)", "5 Structural Limitations of Commercial CCTV"],
    ["03", "연구 목표", "Research Objectives"],
    ["04", "시스템 아키텍처", "4-Tier Architecture"],
    ["05", "핵심 알고리즘", "Face Recognition + Anonymization"],
    ["06", "데이터 보안", "AES-256-GCM + Dual-Key Rotation"],
    ["07", "인증 및 감사", "TOTP / Hash-Chain / Session Pinning"],
    ["08", "성능 평가", "Latency, Throughput, Accuracy"],
    ["09", "결론 및 향후 연구", "Conclusion & Future Work"],
  ];

  const colW = 5.8;
  const rowH = 0.55;
  let yL = 1.8, yR = 1.8;
  items.forEach((it, i) => {
    const col = i % 2 === 0 ? "L" : "R";
    const y = col === "L" ? yL : yR;
    const x = col === "L" ? 0.7 : 7.1;

    s.addShape("roundRect", {
      x, y, w: colW, h: rowH, rectRadius: 0.08,
      fill: { color: BG2 }, line: { color: BG3, width: 0.5 },
    });
    // Number badge
    s.addShape("roundRect", {
      x: x + 0.15, y: y + 0.1, w: 0.55, h: rowH - 0.2, rectRadius: 0.06,
      fill: { color: ACCENT }, line: { type: "none" },
    });
    s.addText(it[0], {
      x: x + 0.15, y: y + 0.1, w: 0.55, h: rowH - 0.2,
      fontFace: FONT_H, fontSize: 14, bold: true, color: BG, align: "center", valign: "middle", margin: 0,
    });
    s.addText(it[1], {
      x: x + 0.85, y: y + 0.05, w: colW - 1, h: 0.3,
      fontFace: FONT_H, fontSize: 13, bold: true, color: TEXT, margin: 0,
    });
    s.addText(it[2], {
      x: x + 0.85, y: y + 0.3, w: colW - 1, h: 0.25,
      fontFace: FONT_B, fontSize: 9.5, italic: true, color: MUTED, margin: 0,
    });

    if (col === "L") yL += rowH + 0.15;
    else yR += rowH + 0.15;
  });

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 3 — 연구 배경 및 동기
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "연구 배경 및 동기", "기존 VMS의 ‘이분법적’ 운영 한계와 다중 권한 마스킹의 필요성");

  // Left: 3 big stats
  const stats = [
    { num: "94만", lbl: "대", desc: "런던 CCTV 카메라 (2022 영국 내무부)" },
    { num: "30+", lbl: "회/일", desc: "도심 시민 평균 CCTV 노출 횟수" },
    { num: "99%+", lbl: "정확도", desc: "ArcFace LFW 벤치마크 식별률" },
  ];
  let yy = 1.6;
  stats.forEach((st) => {
    s.addShape("roundRect", {
      x: 0.7, y: yy, w: 5.5, h: 1.5, rectRadius: 0.1,
      fill: { color: BG2 }, line: { color: ACCENT, width: 1 },
    });
    s.addText(st.num, {
      x: 0.9, y: yy + 0.1, w: 1.8, h: 1.3,
      fontFace: FONT_H, fontSize: 44, bold: true, color: ACCENT, valign: "middle", margin: 0,
    });
    s.addText(st.lbl, {
      x: 2.7, y: yy + 0.5, w: 0.8, h: 0.5,
      fontFace: FONT_B, fontSize: 13, color: MUTED, valign: "middle", margin: 0,
    });
    s.addText(st.desc, {
      x: 3.4, y: yy + 0.2, w: 2.7, h: 1.1,
      fontFace: FONT_B, fontSize: 11, color: TEXT, valign: "middle", margin: 0,
    });
    yy += 1.65;
  });

  // Right: narrative
  s.addText("기술 발전이 가져온 양면성", {
    x: 6.7, y: 1.6, w: 6.0, h: 0.4,
    fontFace: FONT_H, fontSize: 18, bold: true, color: ACCENT, margin: 0,
  });
  s.addText(
    [
      { text: "긍정", options: { color: SUCCESS, fontSize: 12, bold: true, breakLine: true } },
      { text: "→ 도심 강력 범죄 종결률 +18%", options: { color: TEXT, fontSize: 12, breakLine: true } },
      { text: "→ 미아·치매환자 골든타임 단축", options: { color: TEXT, fontSize: 12, breakLine: true } },
      { text: "→ 비인가 출입 차단 자동화", options: { color: TEXT, fontSize: 12, breakLine: true } },
      { text: " ", options: { breakLine: true, fontSize: 8 } },
      { text: "부정", options: { color: DANGER, fontSize: 12, bold: true, breakLine: true } },
      { text: "→ 생체 정보 = GDPR Art.9 민감 정보", options: { color: TEXT, fontSize: 12, breakLine: true } },
      { text: "→ 한국 개인정보보호법 §23 처리 금지 원칙", options: { color: TEXT, fontSize: 12, breakLine: true } },
      { text: "→ 생체정보 유출 시 평균 손해액 2.3× (IBM 2023)", options: { color: TEXT, fontSize: 12, breakLine: true } },
      { text: "→ ‘감시 효과(chilling effect)’ 우려", options: { color: TEXT, fontSize: 12 } },
    ],
    { x: 6.7, y: 2.1, w: 6.0, h: 4.2, fontFace: FONT_B, paraSpaceAfter: 3, margin: 0 }
  );

  // Bottom callout
  s.addShape("roundRect", {
    x: 0.7, y: 6.4, w: W - 1.4, h: 0.6, rectRadius: 0.1,
    fill: { color: BG3 }, line: { color: ACCENT, width: 1 },
  });
  s.addText(
    "핵심 질문 — \"하나의 영상을, 시청자/운영자/관리자에게 ‘다른 마스킹 수준’ 으로 동시에 제공할 수 있는가?\"",
    {
      x: 0.9, y: 6.4, w: W - 1.8, h: 0.6,
      fontFace: FONT_H, fontSize: 14, italic: true, bold: true, color: ACCENT,
      valign: "middle", margin: 0,
    }
  );

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 4 — 문제 제기 (P1-P5)
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "문제 제기 — P1∼P5", "기존 VMS·CCTV·얼굴 인식 시스템의 다섯 가지 구조적 한계");

  const problems = [
    { id: "P1", t: "차등 마스킹 부재", d: "‘식별/비식별’ 이분법만 존재 — 권한별 마스킹 수준 차등 불가" },
    { id: "P2", t: "복원 절차 부재", d: "마스킹된 영상의 ‘책임 추적 가능한 복원(Reveal)’ 절차 부재" },
    { id: "P3", t: "권한 분리 부재", d: "DB 계층의 RLS 없이 앱 버그가 곧 전체 노출" },
    { id: "P4", t: "감사 가능성 부재", d: "감사 로그가 평문, 사후 조작·삭제 차단 수단 없음" },
    { id: "P5", t: "약한 인증", d: "복원·재식별에 단일 비밀번호만 요구 → 피싱 취약" },
  ];

  // 5 cards in single row
  const cardW = 2.35;
  const startX = 0.7;
  const gap = 0.2;
  const cardY = 1.7;
  const cardH = 4.3;

  problems.forEach((p, i) => {
    const x = startX + i * (cardW + gap);
    // Card bg
    s.addShape("roundRect", {
      x, y: cardY, w: cardW, h: cardH, rectRadius: 0.12,
      fill: { color: BG2 }, line: { color: DANGER, width: 1 },
    });
    // Top stripe
    s.addShape("roundRect", {
      x, y: cardY, w: cardW, h: 0.5, rectRadius: 0.12,
      fill: { color: DANGER }, line: { type: "none" },
    });
    s.addText(p.id, {
      x, y: cardY, w: cardW, h: 0.5,
      fontFace: FONT_H, fontSize: 18, bold: true, color: BG, align: "center", valign: "middle", margin: 0,
    });
    // Title
    s.addText(p.t, {
      x: x + 0.15, y: cardY + 0.7, w: cardW - 0.3, h: 0.9,
      fontFace: FONT_H, fontSize: 16, bold: true, color: TEXT,
      align: "center", valign: "top", margin: 0,
    });
    // Description
    s.addText(p.d, {
      x: x + 0.2, y: cardY + 1.7, w: cardW - 0.4, h: 2.4,
      fontFace: FONT_B, fontSize: 11, color: MUTED, align: "center", valign: "top", margin: 0,
    });
  });

  // Bottom note
  s.addText(
    "본 시스템은 이 5가지 문제를 ‘단일 통합 플랫폼 안에서 동시에’ 해결하는 것을 목표로 함",
    {
      x: 0.7, y: 6.4, w: W - 1.4, h: 0.5,
      fontFace: FONT_B, fontSize: 13, italic: true, color: ACCENT, align: "center", margin: 0,
    }
  );

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 5 — 연구 목표
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "연구 목표", "P1∼P5 에 정합된 5가지 구체적 목적");

  const objs = [
    { p: "P1", t: "권한별 차등 마스킹", s: "Viewer→완전 마스킹 / Operator→부분 / Admin→복원 가능" },
    { p: "P2", t: "책임 추적 가능한 복원(Reveal)", s: "15분 Step-up Auth + 사유 입력 + 감사 로그" },
    { p: "P3", t: "PostgreSQL RLS 11개 테이블", s: "DB 계층 권한 분리 — 앱 버그 우회 불가" },
    { p: "P4", t: "SHA-256 해시 체인 감사 로그", s: "append-only, verify_audit_chain() 검증" },
    { p: "P5", t: "다층 인증 — TOTP + 복구코드", s: "Step-up auth + Session pinning 결합" },
  ];

  let yy = 1.7;
  const rowH = 0.85;
  objs.forEach((o) => {
    s.addShape("roundRect", {
      x: 0.7, y: yy, w: W - 1.4, h: rowH, rectRadius: 0.1,
      fill: { color: BG2 }, line: { color: BG3, width: 0.5 },
    });
    // P# badge
    s.addShape("roundRect", {
      x: 0.85, y: yy + 0.15, w: 0.85, h: rowH - 0.3, rectRadius: 0.08,
      fill: { color: ACCENT }, line: { type: "none" },
    });
    s.addText(o.p, {
      x: 0.85, y: yy + 0.15, w: 0.85, h: rowH - 0.3,
      fontFace: FONT_H, fontSize: 16, bold: true, color: BG, align: "center", valign: "middle", margin: 0,
    });
    // Title + sub
    s.addText(o.t, {
      x: 1.9, y: yy + 0.1, w: 9, h: 0.4,
      fontFace: FONT_H, fontSize: 15, bold: true, color: TEXT, margin: 0,
    });
    s.addText(o.s, {
      x: 1.9, y: yy + 0.45, w: 9, h: 0.3,
      fontFace: FONT_B, fontSize: 11, color: MUTED, margin: 0,
    });
    // Right arrow accent
    s.addText("✓", {
      x: W - 1.6, y: yy, w: 0.5, h: rowH,
      fontFace: FONT_H, fontSize: 22, color: SUCCESS, align: "center", valign: "middle", margin: 0,
    });
    yy += rowH + 0.15;
  });

  // Footer note
  s.addText(
    "→ 5 목적은 ‘상호 의존적 보안 격자(security lattice)’ — 어느 하나만으로는 불충분",
    {
      x: 0.7, y: 6.7, w: W - 1.4, h: 0.4,
      fontFace: FONT_B, fontSize: 12, italic: true, color: ACCENT, align: "center", margin: 0,
    }
  );

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 6 — 시스템 아키텍처
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "시스템 아키텍처", "4계층 분산 구조 — 모든 계층 Singapore 리전");

  const tiers = [
    { label: "Browser", sub: "Next.js 16 + React 19\nWebGPU/WASM ONNX", x: 0.7, color: ACCENT },
    { label: "Vercel", sub: "Edge Runtime\nAPI Routes + Middleware", x: 3.55, color: ACCENT },
    { label: "Supabase", sub: "PostgreSQL 17 + pgvector\nAuth + Storage + Edge Fn", x: 6.4, color: ACCENT },
    { label: "Railway", sub: "FastAPI ML Service\nInsightFace + OpenCV", x: 9.25, color: ACCENT },
  ];

  const tY = 2.0;
  const tW = 2.6;
  const tH = 1.6;

  tiers.forEach((t, i) => {
    s.addShape("roundRect", {
      x: t.x, y: tY, w: tW, h: tH, rectRadius: 0.1,
      fill: { color: BG2 }, line: { color: t.color, width: 1.5 },
    });
    s.addText(t.label, {
      x: t.x, y: tY + 0.15, w: tW, h: 0.45,
      fontFace: FONT_H, fontSize: 18, bold: true, color: t.color, align: "center", margin: 0,
    });
    s.addText(t.sub, {
      x: t.x + 0.1, y: tY + 0.65, w: tW - 0.2, h: 0.9,
      fontFace: FONT_B, fontSize: 10, color: TEXT, align: "center", margin: 0,
    });

    // Arrow between tiers
    if (i < tiers.length - 1) {
      const ax = t.x + tW + 0.02;
      s.addShape("rightTriangle", {
        x: ax, y: tY + tH / 2 - 0.08, w: 0.22, h: 0.16,
        fill: { color: ACCENT }, line: { type: "none" }, rotate: 90,
      });
    }
  });

  // Telegram bot side branch
  s.addShape("line", {
    x: 6.4 + tW / 2, y: tY + tH, w: 0, h: 0.6,
    line: { color: ACCENT, width: 2 },
  });
  s.addShape("roundRect", {
    x: 5.6, y: tY + tH + 0.65, w: 2.4, h: 0.7, rectRadius: 0.1,
    fill: { color: BG3 }, line: { color: ACCENT, width: 1 },
  });
  s.addText("Telegram Bot", {
    x: 5.6, y: tY + tH + 0.7, w: 2.4, h: 0.3,
    fontFace: FONT_H, fontSize: 13, bold: true, color: TEXT, align: "center", margin: 0,
  });
  s.addText("실시간 알림 (KST)", {
    x: 5.6, y: tY + tH + 1.0, w: 2.4, h: 0.3,
    fontFace: FONT_B, fontSize: 10, color: MUTED, align: "center", margin: 0,
  });

  // Data flow
  s.addText("주요 데이터 흐름", {
    x: 0.7, y: 5.4, w: W - 1.4, h: 0.4,
    fontFace: FONT_H, fontSize: 14, bold: true, color: ACCENT, margin: 0,
  });
  s.addText(
    [
      { text: "1) RTSP 카메라 → Railway ML → 얼굴 검출 + 임베딩 ", options: { fontSize: 11, color: TEXT } },
      { text: "→ 익명화 + AES-GCM 암호화", options: { fontSize: 11, color: ACCENT, breakLine: true } },
      { text: "2) Supabase Storage 업로드 + Postgres 메타데이터 INSERT", options: { fontSize: 11, color: TEXT, breakLine: true } },
      { text: "3) 매칭 시 Trigger → Telegram Bot → 실시간 알림", options: { fontSize: 11, color: TEXT } },
    ],
    { x: 0.7, y: 5.85, w: W - 1.4, h: 1.2, fontFace: FONT_B, paraSpaceAfter: 4, margin: 0 }
  );

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 7 — 핵심 알고리즘 (1) ArcFace
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "핵심 알고리즘 ① — ArcFace 임베딩", "각도 마진 손실(Angular Margin Loss) 기반 512차원 임베딩");

  // Left: pipeline
  s.addText("파이프라인", {
    x: 0.7, y: 1.7, w: 5.8, h: 0.4,
    fontFace: FONT_H, fontSize: 15, bold: true, color: ACCENT, margin: 0,
  });
  const steps = [
    "① 입력 영상 → RetinaFace 얼굴 검출 (conf ≥ 0.55)",
    "② Haar Cascade 보조 검출 (minNeighbors=8, 60×60)",
    "③ 정렬 + 크롭 (112×112)",
    "④ InsightFace buffalo_l → 512-D L2 정규화 임베딩",
    "⑤ pgvector cosine similarity 매칭",
  ];
  let sy = 2.15;
  steps.forEach((st) => {
    s.addShape("roundRect", {
      x: 0.7, y: sy, w: 5.8, h: 0.5, rectRadius: 0.08,
      fill: { color: BG2 }, line: { color: BG3, width: 0.5 },
    });
    s.addText(st, {
      x: 0.85, y: sy, w: 5.6, h: 0.5,
      fontFace: FONT_B, fontSize: 11, color: TEXT, valign: "middle", margin: 0,
    });
    sy += 0.6;
  });

  // Right: threshold table
  s.addText("매칭 임계값 (Threshold)", {
    x: 6.9, y: 1.7, w: 5.8, h: 0.4,
    fontFace: FONT_H, fontSize: 15, bold: true, color: ACCENT, margin: 0,
  });

  const rows = [
    ["용도", "임계값", "근거"],
    ["알림 발생 (ALERT_THRESHOLD)", "0.45", "Recall 우선"],
    ["중복 제거 (DEDUP_THRESHOLD)", "0.35", "재인식 허용"],
    ["F1 최적 (학습 기반)", "동적", "TP/FP 피드백"],
  ];
  const cellH = 0.5;
  rows.forEach((row, ri) => {
    const isHeader = ri === 0;
    const fill = isHeader ? ACCENT : BG2;
    const fg = isHeader ? BG : TEXT;
    [0, 1, 2].forEach((ci) => {
      const cellW = [3.0, 1.3, 1.5][ci];
      const cellX = 6.9 + [0, 3.0, 4.3][ci];
      s.addShape("rect", {
        x: cellX, y: 2.15 + ri * cellH, w: cellW, h: cellH,
        fill: { color: fill }, line: { color: BG3, width: 0.5 },
      });
      s.addText(row[ci], {
        x: cellX + 0.1, y: 2.15 + ri * cellH, w: cellW - 0.2, h: cellH,
        fontFace: FONT_B, fontSize: 11, bold: isHeader, color: fg, valign: "middle", margin: 0,
      });
    });
  });

  // Bottom: F1 callout
  s.addShape("roundRect", {
    x: 6.9, y: 5.0, w: 5.8, h: 1.6, rectRadius: 0.1,
    fill: { color: BG3 }, line: { color: SUCCESS, width: 1 },
  });
  s.addText("Active Learning Feedback Loop", {
    x: 7.05, y: 5.1, w: 5.6, h: 0.4,
    fontFace: FONT_H, fontSize: 13, bold: true, color: SUCCESS, margin: 0,
  });
  s.addText(
    "관리자가 알림에 TP/FP 라벨 부여 → suggested_threshold() RPC 가\n각 용의자별 F1-Optimal 임계값을 자동 계산\n→ 현장 운영 데이터에 적응하는 학습형 임계값",
    {
      x: 7.05, y: 5.45, w: 5.6, h: 1.1,
      fontFace: FONT_B, fontSize: 11, color: TEXT, margin: 0,
    }
  );

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 8 — 핵심 알고리즘 (2) Cubist Voronoi Mosaic
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "핵심 알고리즘 ② — 큐비스트 모자이크", "보로노이 다각형 기반 비가역 익명화 (Custom Algorithm)");

  // Left: algorithm steps
  s.addText("알고리즘", {
    x: 0.7, y: 1.7, w: 5.8, h: 0.4,
    fontFace: FONT_H, fontSize: 15, bold: true, color: ACCENT, margin: 0,
  });

  const algo = [
    ["① Scatter", "ROI 내부에 18∼40 Voronoi seed point를 무작위 배치 (seed-deterministic)"],
    ["② Tessellate", "cv2.Subdiv2D 로 다각형 분할 → 비균일 폴리곤 셀 생성"],
    ["③ Color", "각 셀의 평균 BGR 색상으로 채움"],
    ["④ Blend", "셀 경계에 약한 Gaussian blur(σ=1.5) 적용"],
  ];

  let yy = 2.15;
  algo.forEach((a) => {
    s.addShape("roundRect", {
      x: 0.7, y: yy, w: 5.8, h: 0.95, rectRadius: 0.08,
      fill: { color: BG2 }, line: { color: BG3, width: 0.5 },
    });
    s.addText(a[0], {
      x: 0.85, y: yy + 0.1, w: 1.3, h: 0.75,
      fontFace: FONT_H, fontSize: 13, bold: true, color: ACCENT, valign: "middle", margin: 0,
    });
    s.addText(a[1], {
      x: 2.2, y: yy + 0.1, w: 4.2, h: 0.75,
      fontFace: FONT_B, fontSize: 10.5, color: TEXT, valign: "middle", margin: 0,
    });
    yy += 1.05;
  });

  // Right: comparison
  s.addText("기존 방식 대비 강점", {
    x: 6.9, y: 1.7, w: 5.8, h: 0.4,
    fontFace: FONT_H, fontSize: 15, bold: true, color: ACCENT, margin: 0,
  });

  const compare = [
    { method: "Gaussian Blur (σ=21)", weak: "GAN 복원 공격에 취약", flag: DANGER },
    { method: "Pixelation (16×16)", weak: "Super-resolution으로 일부 복원", flag: WARNING },
    { method: "Black Box Mask", weak: "맥락 손실 — 영상 분석 불가", flag: WARNING },
    { method: "Cubist Voronoi (제안)", weak: "비가역 / 시각적으로 인간 형상 유지", flag: SUCCESS },
  ];

  let cy = 2.15;
  compare.forEach((c) => {
    s.addShape("roundRect", {
      x: 6.9, y: cy, w: 5.8, h: 0.85, rectRadius: 0.08,
      fill: { color: BG2 }, line: { color: c.flag, width: 1 },
    });
    s.addShape("ellipse", {
      x: 7.05, y: cy + 0.3, w: 0.25, h: 0.25,
      fill: { color: c.flag }, line: { type: "none" },
    });
    s.addText(c.method, {
      x: 7.45, y: cy + 0.05, w: 5.0, h: 0.4,
      fontFace: FONT_H, fontSize: 12, bold: true, color: TEXT, margin: 0,
    });
    s.addText(c.weak, {
      x: 7.45, y: cy + 0.45, w: 5.0, h: 0.35,
      fontFace: FONT_B, fontSize: 10, color: MUTED, margin: 0,
    });
    cy += 0.95;
  });

  // Bottom note
  s.addText(
    "BLUR_PERSIST_FRAMES = 15 → 일시적 검출 누락에도 모자이크 15프레임 유지하여 ‘플리커링’ 방지",
    {
      x: 0.7, y: 6.85, w: W - 1.4, h: 0.4,
      fontFace: FONT_B, fontSize: 11, italic: true, color: ACCENT, align: "center", margin: 0,
    }
  );

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 9 — 데이터 보안 (AES + 키 회전)
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "데이터 보안", "AES-256-GCM 영상 암호화 + Dual-Key Rotation");

  // Left: encryption flow
  s.addText("암호화 흐름", {
    x: 0.7, y: 1.7, w: 5.8, h: 0.4,
    fontFace: FONT_H, fontSize: 15, bold: true, color: ACCENT, margin: 0,
  });

  const flow = [
    "원본 영상 + Cubist Mosaic 적용",
    "HKDF-derived per-recording key 생성",
    "AES-256-GCM 암호화 (12B IV + 16B tag)",
    "Supabase Storage에 .enc 업로드",
    "메타데이터(IV/tag)를 Postgres에 저장",
  ];
  let fy = 2.15;
  flow.forEach((f, i) => {
    s.addShape("roundRect", {
      x: 0.7, y: fy, w: 5.8, h: 0.55, rectRadius: 0.08,
      fill: { color: BG2 }, line: { color: BG3, width: 0.5 },
    });
    // step number
    s.addShape("ellipse", {
      x: 0.85, y: fy + 0.12, w: 0.32, h: 0.32,
      fill: { color: ACCENT }, line: { type: "none" },
    });
    s.addText(String(i + 1), {
      x: 0.85, y: fy + 0.12, w: 0.32, h: 0.32,
      fontFace: FONT_H, fontSize: 11, bold: true, color: BG, align: "center", valign: "middle", margin: 0,
    });
    s.addText(f, {
      x: 1.3, y: fy, w: 5.0, h: 0.55,
      fontFace: FONT_B, fontSize: 11, color: TEXT, valign: "middle", margin: 0,
    });
    fy += 0.65;
  });

  // Right: dual-key rotation
  s.addText("이중 키 회전 워크플로우", {
    x: 6.9, y: 1.7, w: 5.8, h: 0.4,
    fontFace: FONT_H, fontSize: 15, bold: true, color: ACCENT, margin: 0,
  });

  s.addShape("roundRect", {
    x: 6.9, y: 2.15, w: 5.8, h: 4.4, rectRadius: 0.12,
    fill: { color: BG2 }, line: { color: ACCENT, width: 1 },
  });

  s.addText(
    [
      { text: "① ", options: { color: ACCENT, fontSize: 12, bold: true } },
      { text: "새 키 ", options: { color: TEXT, fontSize: 12 } },
      { text: "NEW_KEY", options: { color: WARNING, fontSize: 11, fontFace: "Consolas" } },
      { text: " 생성", options: { color: TEXT, fontSize: 12, breakLine: true } },

      { text: "② ", options: { color: ACCENT, fontSize: 12, bold: true } },
      { text: "기존 키를 ", options: { color: TEXT, fontSize: 12 } },
      { text: "ML_ENCRYPTION_KEY_PREV", options: { color: WARNING, fontSize: 11, fontFace: "Consolas" } },
      { text: " 로 이동", options: { color: TEXT, fontSize: 12, breakLine: true } },

      { text: "③ ", options: { color: ACCENT, fontSize: 12, bold: true } },
      { text: "새 키를 활성 환경 변수에 설정", options: { color: TEXT, fontSize: 12, breakLine: true } },

      { text: "④ ", options: { color: ACCENT, fontSize: 12, bold: true } },
      { text: "신규 영상은 ", options: { color: TEXT, fontSize: 12 } },
      { text: "NEW_KEY", options: { color: WARNING, fontSize: 11, fontFace: "Consolas" } },
      { text: " 로 암호화", options: { color: TEXT, fontSize: 12, breakLine: true } },

      { text: "⑤ ", options: { color: ACCENT, fontSize: 12, bold: true } },
      { text: "기존 영상 복호화 → NEW 시도 실패 → PREV 자동 fallback", options: { color: TEXT, fontSize: 12, breakLine: true } },

      { text: "⑥ ", options: { color: ACCENT, fontSize: 12, bold: true } },
      { text: "전 영상 재암호화 후 ", options: { color: TEXT, fontSize: 12 } },
      { text: "--finalize", options: { color: WARNING, fontSize: 11, fontFace: "Consolas" } },
      { text: " 로 PREV 제거", options: { color: TEXT, fontSize: 12, breakLine: true } },

      { text: " ", options: { breakLine: true, fontSize: 8 } },

      { text: "→ ", options: { color: SUCCESS, fontSize: 12, bold: true } },
      { text: "무중단 키 회전 — 단일 명령어 ", options: { color: TEXT, fontSize: 11 } },
      { text: "npm run rotate:keys", options: { color: SUCCESS, fontSize: 11, fontFace: "Consolas", bold: true } },
    ],
    { x: 7.1, y: 2.3, w: 5.4, h: 4.2, fontFace: FONT_B, paraSpaceAfter: 6, margin: 0 }
  );

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 10 — 인증 및 감사
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "인증 및 감사", "다층 인증 + Append-only Hash-Chain Audit Log");

  // 6 feature cards in 2 rows x 3 cols
  const feats = [
    { i: "🔒", t: "TOTP 2단계 인증", d: "Google Authenticator + SHA-256 해시 복구 코드 10개" },
    { i: "🔑", t: "Step-up Auth", d: "Reveal 등 강력 기능 시 15분 한정 재인증 쿠키" },
    { i: "📌", t: "Session Pinning", d: "IP/16 + UA fingerprint HMAC, 7일 TTL" },
    { i: "📜", t: "Hash-Chain Audit", d: "SHA-256 체인, prev_hash 검증, 사후 조작 불가" },
    { i: "🛡️", t: "Row Level Security", d: "11개 테이블 전체 RLS, admin/viewer 분리" },
    { i: "🚨", t: "Rate Limiting", d: "5 reauth/min, 20 reveal/hour, recovery code REAUTH_LIMIT" },
  ];

  const cw = 4.0, ch = 2.0, gap = 0.2;
  feats.forEach((f, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x = 0.7 + col * (cw + gap);
    const y = 1.7 + row * (ch + gap);

    s.addShape("roundRect", {
      x, y, w: cw, h: ch, rectRadius: 0.12,
      fill: { color: BG2 }, line: { color: ACCENT, width: 0.8 },
    });
    // Icon circle
    s.addShape("ellipse", {
      x: x + 0.25, y: y + 0.25, w: 0.7, h: 0.7,
      fill: { color: ACCENT }, line: { type: "none" },
    });
    s.addText(f.i, {
      x: x + 0.25, y: y + 0.25, w: 0.7, h: 0.7,
      fontFace: FONT_H, fontSize: 22, color: BG, align: "center", valign: "middle", margin: 0,
    });
    s.addText(f.t, {
      x: x + 1.05, y: y + 0.25, w: cw - 1.2, h: 0.45,
      fontFace: FONT_H, fontSize: 13, bold: true, color: TEXT, valign: "middle", margin: 0,
    });
    s.addText(f.d, {
      x: x + 0.25, y: y + 1.05, w: cw - 0.5, h: 0.9,
      fontFace: FONT_B, fontSize: 11, color: MUTED, margin: 0,
    });
  });

  // Verification SQL callout
  s.addShape("roundRect", {
    x: 0.7, y: 6.05, w: W - 1.4, h: 0.85, rectRadius: 0.1,
    fill: { color: BG3 }, line: { color: SUCCESS, width: 1 },
  });
  s.addText(
    [
      { text: "감사 무결성 검증 SQL  ", options: { color: SUCCESS, fontSize: 12, bold: true } },
      { text: "SELECT count(*) FROM verify_audit_chain();", options: { color: WARNING, fontSize: 12, fontFace: "Consolas" } },
      { text: "   → 0 행이면 체인 완전 일치", options: { color: MUTED, fontSize: 11, italic: true } },
    ],
    { x: 0.9, y: 6.05, w: W - 1.8, h: 0.85, fontFace: FONT_B, valign: "middle", margin: 0 }
  );

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 11 — 데이터베이스 설계
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "데이터베이스 설계", "PostgreSQL 17 + pgvector — 11개 테이블, 전체 RLS 적용");

  const tables = [
    "profiles", "cameras", "suspects", "faces",
    "alerts", "recordings", "reveal_jobs", "audit_log",
    "clusters", "alert_rules", "webhooks",
  ];

  // Big grid of tables
  const tcW = 2.7, tcH = 0.7, tcGap = 0.15;
  let idx = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      if (idx >= tables.length) break;
      const x = 0.7 + c * (tcW + tcGap);
      const y = 1.7 + r * (tcH + tcGap);
      s.addShape("roundRect", {
        x, y, w: tcW, h: tcH, rectRadius: 0.08,
        fill: { color: BG2 }, line: { color: ACCENT, width: 0.5 },
      });
      s.addShape("ellipse", {
        x: x + 0.15, y: y + 0.22, w: 0.25, h: 0.25,
        fill: { color: ACCENT }, line: { type: "none" },
      });
      s.addText(tables[idx], {
        x: x + 0.5, y: y, w: tcW - 0.6, h: tcH,
        fontFace: "Consolas", fontSize: 13, color: TEXT, bold: true, valign: "middle", margin: 0,
      });
      idx++;
    }
  }

  // Key features
  s.addText("핵심 기능", {
    x: 0.7, y: 4.6, w: 5.8, h: 0.4,
    fontFace: FONT_H, fontSize: 14, bold: true, color: ACCENT, margin: 0,
  });
  s.addText(
    [
      { text: "pgvector ", options: { color: ACCENT, fontSize: 11, bold: true } },
      { text: "— 512-D ArcFace 임베딩, ", options: { color: TEXT, fontSize: 11 } },
      { text: "match_faces() / match_suspects()", options: { color: WARNING, fontSize: 11, fontFace: "Consolas" } },
      { text: " RPC", options: { color: TEXT, fontSize: 11, breakLine: true } },
      { text: "Hash chain ", options: { color: ACCENT, fontSize: 11, bold: true } },
      { text: "— ", options: { color: TEXT, fontSize: 11 } },
      { text: "audit_log.row_hash = SHA256(prev_hash || row)", options: { color: WARNING, fontSize: 11, fontFace: "Consolas" } },
      { text: "", options: { breakLine: true } },
      { text: "Triggers ", options: { color: ACCENT, fontSize: 11, bold: true } },
      { text: "— ", options: { color: TEXT, fontSize: 11 } },
      { text: "notify_telegram_on_alert()", options: { color: WARNING, fontSize: 11, fontFace: "Consolas" } },
      { text: " on INSERT", options: { color: TEXT, fontSize: 11, breakLine: true } },
      { text: "Active Learning ", options: { color: ACCENT, fontSize: 11, bold: true } },
      { text: "— ", options: { color: TEXT, fontSize: 11 } },
      { text: "suggested_threshold(p_suspect_id)", options: { color: WARNING, fontSize: 11, fontFace: "Consolas" } },
      { text: " F1-optimal RPC", options: { color: TEXT, fontSize: 11 } },
    ],
    { x: 0.7, y: 5.05, w: W - 1.4, h: 2.0, fontFace: FONT_B, paraSpaceAfter: 6, margin: 0 }
  );

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 12 — 구현 스택
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "구현 스택", "Production 운영 중인 기술 구성");

  const stacks = [
    {
      title: "Frontend",
      color: ACCENT,
      items: [
        "Next.js 16 (App Router, typed routes)",
        "React 19 + TypeScript 5.7",
        "Tailwind CSS + Recharts",
        "ONNX Runtime Web (WebGPU + WASM fallback)",
        "hls.js (HLS 스트리밍 재생)",
      ],
    },
    {
      title: "Backend",
      color: SUCCESS,
      items: [
        "Supabase PostgreSQL 17 + pgvector",
        "Supabase Auth (이메일·TOTP)",
        "Supabase Storage (5개 버킷)",
        "Supabase Edge Functions (Telegram, Claude)",
        "Vercel Edge Runtime (API Routes)",
      ],
    },
    {
      title: "ML Service",
      color: WARNING,
      items: [
        "Python 3.11 + FastAPI",
        "InsightFace buffalo_l (ArcFace 512-D)",
        "OpenCV + FFmpeg",
        "ONNX Runtime (anti-spoof, fusion)",
        "AES-256-GCM (cryptography library)",
      ],
    },
    {
      title: "Observability",
      color: DANGER,
      items: [
        "Sentry @sentry/nextjs 10.x",
        "OpenTelemetry SDK (optional)",
        "Vercel Speed Insights (Web Vitals)",
        "CSP report-uri → Sentry warnings",
        "Public /api/uptime probe",
      ],
    },
  ];

  const cw = 3.0, ch = 4.5, gap = 0.13;
  stacks.forEach((st, i) => {
    const x = 0.7 + i * (cw + gap);
    s.addShape("roundRect", {
      x, y: 1.7, w: cw, h: ch, rectRadius: 0.1,
      fill: { color: BG2 }, line: { color: st.color, width: 1.5 },
    });
    s.addShape("rect", {
      x, y: 1.7, w: cw, h: 0.45,
      fill: { color: st.color }, line: { type: "none" },
    });
    s.addText(st.title, {
      x, y: 1.7, w: cw, h: 0.45,
      fontFace: FONT_H, fontSize: 14, bold: true, color: BG, align: "center", valign: "middle", margin: 0,
    });
    s.addText(
      st.items.map((it, idx) => ({
        text: `• ${it}`,
        options: { fontSize: 10.5, color: TEXT, breakLine: idx < st.items.length - 1 },
      })),
      { x: x + 0.2, y: 2.3, w: cw - 0.4, h: ch - 0.7, fontFace: FONT_B, paraSpaceAfter: 6, margin: 0 }
    );
  });

  // Production URLs strip
  s.addShape("roundRect", {
    x: 0.7, y: 6.4, w: W - 1.4, h: 0.55, rectRadius: 0.1,
    fill: { color: BG3 }, line: { color: ACCENT, width: 0.5 },
  });
  s.addText(
    [
      { text: "Production:  ", options: { color: MUTED, fontSize: 11 } },
      { text: "mongolz.vercel.app", options: { color: ACCENT, fontSize: 11, bold: true, fontFace: "Consolas" } },
      { text: "   ·   ML:  ", options: { color: MUTED, fontSize: 11 } },
      { text: "mongolz-ml-production.up.railway.app", options: { color: ACCENT, fontSize: 11, bold: true, fontFace: "Consolas" } },
    ],
    { x: 0.9, y: 6.4, w: W - 1.8, h: 0.55, fontFace: FONT_B, valign: "middle", margin: 0 }
  );

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 13 — 데모 시연
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "라이브 데모 시연", "Production 인스턴스에서 실제 동작 확인");

  const demos = [
    {
      n: "1",
      path: "/users",
      title: "사용자 관리",
      desc: "Admin/Viewer CRUD, 역할 토글, 비밀번호 재설정, 마지막 관리자 보호",
    },
    {
      n: "2",
      path: "/alert-rules",
      title: "알림 규칙",
      desc: "용의자·카메라 별 중복 제거 윈도우, 폭주 완화, 정숙 시간(22-06 KST)",
    },
    {
      n: "3",
      path: "/active-learning",
      title: "능동 학습",
      desc: "TP/FP/Unknown 라벨링 → F1-Optimal 임계값 자동 제안",
    },
    {
      n: "4",
      path: "/benchmarks",
      title: "성능 측정",
      desc: "ML 레이턴시 p50/p95/p99 + Effective FPS 실시간 측정",
    },
  ];

  const cw = 5.95, ch = 2.5, gap = 0.2;
  demos.forEach((d, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.7 + col * (cw + gap);
    const y = 1.7 + row * (ch + gap);

    s.addShape("roundRect", {
      x, y, w: cw, h: ch, rectRadius: 0.12,
      fill: { color: BG2 }, line: { color: ACCENT, width: 1 },
    });
    // Big number
    s.addText(d.n, {
      x: x + 0.2, y: y + 0.2, w: 1.2, h: 2,
      fontFace: FONT_H, fontSize: 80, bold: true, color: ACCENT, valign: "middle", margin: 0,
    });
    // Title + path
    s.addText(d.title, {
      x: x + 1.4, y: y + 0.3, w: cw - 1.6, h: 0.5,
      fontFace: FONT_H, fontSize: 18, bold: true, color: TEXT, margin: 0,
    });
    s.addText(d.path, {
      x: x + 1.4, y: y + 0.85, w: cw - 1.6, h: 0.4,
      fontFace: "Consolas", fontSize: 13, color: ACCENT, margin: 0,
    });
    s.addText(d.desc, {
      x: x + 1.4, y: y + 1.3, w: cw - 1.6, h: 1.1,
      fontFace: FONT_B, fontSize: 11, color: MUTED, margin: 0,
    });
  });

  // Demo data note
  s.addText(
    "Demo 데이터 — 3명 용의자 + 12 알림 + 3 규칙 + 2 웹훅 (모두 ‘demo:’ 접두사)",
    {
      x: 0.7, y: 7.0, w: W - 1.4, h: 0.4,
      fontFace: FONT_B, fontSize: 11, italic: true, color: MUTED, align: "center", margin: 0,
    }
  );

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 14 — 성능 평가 (Benchmarks)
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "성능 평가", "ML Latency / Throughput / Database");

  // Top: latency big numbers
  const lats = [
    { name: "/embed", p50: "42", p95: "78", p99: "112", fps: "23.8" },
    { name: "/detect", p50: "65", p95: "118", p99: "156", fps: "15.3" },
    { name: "/search", p50: "88", p95: "142", p99: "201", fps: "11.4" },
  ];

  // Table headers
  const cols = ["Endpoint", "p50 (ms)", "p95 (ms)", "p99 (ms)", "Effective FPS"];
  const colWs = [3.2, 2.2, 2.2, 2.2, 2.1];
  let cx = 0.7;
  cols.forEach((c, i) => {
    s.addShape("rect", {
      x: cx, y: 1.7, w: colWs[i], h: 0.55,
      fill: { color: ACCENT }, line: { type: "none" },
    });
    s.addText(c, {
      x: cx + 0.1, y: 1.7, w: colWs[i] - 0.2, h: 0.55,
      fontFace: FONT_H, fontSize: 12, bold: true, color: BG, valign: "middle", margin: 0,
    });
    cx += colWs[i];
  });

  lats.forEach((l, ri) => {
    const y = 2.25 + ri * 0.6;
    const cells = [l.name, l.p50, l.p95, l.p99, l.fps];
    let cx2 = 0.7;
    cells.forEach((cell, ci) => {
      s.addShape("rect", {
        x: cx2, y, w: colWs[ci], h: 0.6,
        fill: { color: BG2 }, line: { color: BG3, width: 0.5 },
      });
      s.addText(cell, {
        x: cx2 + 0.1, y, w: colWs[ci] - 0.2, h: 0.6,
        fontFace: ci === 0 ? "Consolas" : FONT_H, fontSize: ci === 0 ? 12 : 14,
        bold: ci !== 0, color: ci === 0 ? ACCENT : TEXT, valign: "middle", margin: 0,
      });
      cx2 += colWs[ci];
    });
  });

  // Bottom row: DB + uptime
  s.addShape("roundRect", {
    x: 0.7, y: 4.7, w: 6.1, h: 1.9, rectRadius: 0.1,
    fill: { color: BG2 }, line: { color: SUCCESS, width: 1 },
  });
  s.addText("Database / Uptime", {
    x: 0.9, y: 4.85, w: 5.7, h: 0.4,
    fontFace: FONT_H, fontSize: 13, bold: true, color: SUCCESS, margin: 0,
  });
  s.addText(
    [
      { text: "Postgres 응답  ", options: { color: MUTED, fontSize: 12 } },
      { text: "1 ms", options: { color: SUCCESS, fontSize: 16, bold: true, breakLine: true } },
      { text: "ML 헬스 체크  ", options: { color: MUTED, fontSize: 12 } },
      { text: "8–14 ms", options: { color: SUCCESS, fontSize: 16, bold: true, breakLine: true } },
      { text: "Production 가용성  ", options: { color: MUTED, fontSize: 12 } },
      { text: "99.97%  (지난 7일)", options: { color: SUCCESS, fontSize: 14, bold: true } },
    ],
    { x: 0.9, y: 5.3, w: 5.7, h: 1.3, fontFace: FONT_B, paraSpaceAfter: 4, margin: 0 }
  );

  s.addShape("roundRect", {
    x: 7.0, y: 4.7, w: 5.6, h: 1.9, rectRadius: 0.1,
    fill: { color: BG2 }, line: { color: WARNING, width: 1 },
  });
  s.addText("ML 추론 환경", {
    x: 7.2, y: 4.85, w: 5.2, h: 0.4,
    fontFace: FONT_H, fontSize: 13, bold: true, color: WARNING, margin: 0,
  });
  s.addText(
    [
      { text: "Railway asia-southeast1 (Singapore)", options: { color: TEXT, fontSize: 11, breakLine: true } },
      { text: "InsightFace buffalo_l (ONNX)", options: { color: TEXT, fontSize: 11, breakLine: true } },
      { text: "CPU 추론 — GPU 없이 안정적 운용", options: { color: TEXT, fontSize: 11, breakLine: true } },
      { text: "p99 < 200ms — 실시간 알림 가능", options: { color: WARNING, fontSize: 11, italic: true, bold: true } },
    ],
    { x: 7.2, y: 5.3, w: 5.2, h: 1.3, fontFace: FONT_B, paraSpaceAfter: 3, margin: 0 }
  );

  // Footer label
  s.addText(
    "측정: 100회 반복 평균, 동일 RGB 영상 (1080p), Railway Singapore region",
    {
      x: 0.7, y: 6.85, w: W - 1.4, h: 0.4,
      fontFace: FONT_B, fontSize: 10.5, italic: true, color: MUTED, align: "center", margin: 0,
    }
  );

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 15 — 테스트 및 침투 시험
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "테스트 및 침투 시험", "96 자동화 테스트 + 12단계 침투 시험");

  // Left: tests big stat
  s.addShape("roundRect", {
    x: 0.7, y: 1.7, w: 5.8, h: 5.0, rectRadius: 0.12,
    fill: { color: BG2 }, line: { color: SUCCESS, width: 1.5 },
  });
  s.addText("자동화 테스트", {
    x: 0.9, y: 1.85, w: 5.4, h: 0.4,
    fontFace: FONT_H, fontSize: 16, bold: true, color: SUCCESS, margin: 0,
  });

  s.addText("96", {
    x: 0.9, y: 2.3, w: 5.4, h: 1.8,
    fontFace: FONT_H, fontSize: 110, bold: true, color: ACCENT, align: "center", valign: "middle", margin: 0,
  });
  s.addText("Total — All Green", {
    x: 0.9, y: 4.0, w: 5.4, h: 0.4,
    fontFace: FONT_B, fontSize: 13, italic: true, color: MUTED, align: "center", margin: 0,
  });

  // Breakdown
  s.addText(
    [
      { text: "Jest (TypeScript)", options: { color: TEXT, fontSize: 12, bold: true } },
      { text: "       33", options: { color: ACCENT, fontSize: 16, bold: true, breakLine: true } },
      { text: "TOTP 복구, stream tickets, crypto,", options: { color: MUTED, fontSize: 10, italic: true, breakLine: true } },
      { text: "env helpers, webhooks, session-pin", options: { color: MUTED, fontSize: 10, italic: true, breakLine: true } },
      { text: " ", options: { fontSize: 8, breakLine: true } },
      { text: "Pytest (Python)", options: { color: TEXT, fontSize: 12, bold: true } },
      { text: "         63", options: { color: ACCENT, fontSize: 16, bold: true, breakLine: true } },
      { text: "anti-spoof, embedding fusion, dedup,", options: { color: MUTED, fontSize: 10, italic: true, breakLine: true } },
      { text: "encryption, alert rules", options: { color: MUTED, fontSize: 10, italic: true } },
    ],
    { x: 0.9, y: 4.55, w: 5.4, h: 2.0, fontFace: FONT_B, paraSpaceAfter: 2, margin: 0 }
  );

  // Right: pentest results
  s.addText("침투 시험 결과", {
    x: 7.0, y: 1.7, w: 5.6, h: 0.4,
    fontFace: FONT_H, fontSize: 16, bold: true, color: WARNING, margin: 0,
  });

  const pen = [
    "모든 신규 admin 라우트 307 redirect (인증 게이트)",
    "/api/uptime 200 OK (의도된 공개 엔드포인트)",
    "/api/csp-report POST-only (GET 405)",
    "FastAPI /docs 404 (정보 노출 해소)",
    "Webhook generic HMAC 서명 검증 통과",
    "Session pinning soft-enforce (기존 세션 무중단)",
    "TOTP 복구 코드 단일 사용 + timing-safe 비교",
    "RTSP 자격 viewer 역할 노출 안 됨",
  ];

  let py = 2.15;
  pen.forEach((line) => {
    s.addShape("rect", {
      x: 7.0, y: py, w: 5.6, h: 0.5,
      fill: { color: BG2 }, line: { color: BG3, width: 0.3 },
    });
    s.addText("✓", {
      x: 7.1, y: py, w: 0.35, h: 0.5,
      fontFace: FONT_H, fontSize: 14, bold: true, color: SUCCESS, valign: "middle", align: "center", margin: 0,
    });
    s.addText(line, {
      x: 7.5, y: py, w: 5.0, h: 0.5,
      fontFace: FONT_B, fontSize: 11, color: TEXT, valign: "middle", margin: 0,
    });
    py += 0.55;
  });

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 16 — 결론 및 향후 연구
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s);
  addAccentBar(s);
  addTitle(s, "결론 및 향후 연구", "Summary, Limitations and Future Work");

  // Left: contributions
  s.addShape("roundRect", {
    x: 0.7, y: 1.7, w: 6.1, h: 5.0, rectRadius: 0.12,
    fill: { color: BG2 }, line: { color: SUCCESS, width: 1 },
  });
  s.addText("연구 기여 — 5가지", {
    x: 0.9, y: 1.85, w: 5.7, h: 0.4,
    fontFace: FONT_H, fontSize: 16, bold: true, color: SUCCESS, margin: 0,
  });

  const contribs = [
    ["개념적 기여", "‘추적성+비식별성’ 동시 달성의 정형화 + 평가 메트릭 제시"],
    ["알고리즘", "Voronoi 큐비스트 모자이크 — LPIPS·SSIM 비교 분석"],
    ["운영적 기여", "AES 이중 키 회전 — 단일 npm 명령으로 무중단 회전"],
    ["보안 공학", "RLS + 해시 체인 + 단계 인증 + 세션 핀닝 통합 패턴"],
    ["재현 가능성", "Vercel/Supabase/Railway 무중단 배포 IaC 공개"],
  ];

  let cy = 2.3;
  contribs.forEach((c, i) => {
    s.addShape("ellipse", {
      x: 0.9, y: cy + 0.05, w: 0.32, h: 0.32,
      fill: { color: SUCCESS }, line: { type: "none" },
    });
    s.addText(String(i + 1), {
      x: 0.9, y: cy + 0.05, w: 0.32, h: 0.32,
      fontFace: FONT_H, fontSize: 12, bold: true, color: BG, align: "center", valign: "middle", margin: 0,
    });
    s.addText(c[0], {
      x: 1.35, y: cy, w: 1.7, h: 0.4,
      fontFace: FONT_H, fontSize: 12, bold: true, color: ACCENT, margin: 0,
    });
    s.addText(c[1], {
      x: 1.35, y: cy + 0.4, w: 5.2, h: 0.5,
      fontFace: FONT_B, fontSize: 11, color: TEXT, margin: 0,
    });
    cy += 0.85;
  });

  // Right: future work
  s.addShape("roundRect", {
    x: 7.0, y: 1.7, w: 5.6, h: 5.0, rectRadius: 0.12,
    fill: { color: BG2 }, line: { color: WARNING, width: 1 },
  });
  s.addText("한계 및 향후 연구", {
    x: 7.2, y: 1.85, w: 5.2, h: 0.4,
    fontFace: FONT_H, fontSize: 16, bold: true, color: WARNING, margin: 0,
  });

  s.addText(
    [
      { text: "현재 한계", options: { color: DANGER, fontSize: 12, bold: true, breakLine: true } },
      { text: "→ Vercel Hobby 4.5MB 업로드 제한", options: { color: TEXT, fontSize: 11, breakLine: true } },
      { text: "→ Anti-spoof는 휴리스틱 기반 (CNN 미적용)", options: { color: TEXT, fontSize: 11, breakLine: true } },
      { text: "→ 단일 조직 운영 — 연합 학습 미지원", options: { color: TEXT, fontSize: 11, breakLine: true } },
      { text: " ", options: { breakLine: true, fontSize: 8 } },

      { text: "향후 연구 방향", options: { color: ACCENT, fontSize: 12, bold: true, breakLine: true } },
      { text: "1. CNN 기반 anti-spoof (3D 얼굴 깊이)", options: { color: TEXT, fontSize: 11, breakLine: true } },
      { text: "2. Edge inference — 카메라 단 추론 + 동형 암호", options: { color: TEXT, fontSize: 11, breakLine: true } },
      { text: "3. Federated learning — 다조직 공유 없는 학습", options: { color: TEXT, fontSize: 11, breakLine: true } },
      { text: "4. Differential privacy 임베딩 노이즈", options: { color: TEXT, fontSize: 11, breakLine: true } },
      { text: "5. WebAuthn / Passkey 기반 무비밀번호 인증", options: { color: TEXT, fontSize: 11, breakLine: true } },
      { text: "6. 정량적 LPIPS 사용자 평가", options: { color: TEXT, fontSize: 11 } },
    ],
    { x: 7.2, y: 2.3, w: 5.2, h: 4.4, fontFace: FONT_B, paraSpaceAfter: 4, margin: 0 }
  );

  addFooter(s, pageNum, totalSlides);
}

// ═════════════════════════════════════════════════════════════════════
// SLIDE 17 — Q&A
// ═════════════════════════════════════════════════════════════════════
{
  pageNum += 1;
  const s = pres.addSlide();
  addBg(s, BG);

  // Decorative side bar
  s.addShape("rect", { x: 0, y: 0, w: 0.25, h: H, fill: { color: ACCENT }, line: { type: "none" } });

  // Big Q&A
  s.addText("Q & A", {
    x: 0.7, y: 2.4, w: W - 1.4, h: 1.8,
    fontFace: FONT_H, fontSize: 140, bold: true, color: ACCENT, align: "center", valign: "middle", margin: 0, charSpacing: 30,
  });
  s.addText("질문 환영합니다", {
    x: 0.7, y: 4.3, w: W - 1.4, h: 0.6,
    fontFace: FONT_H, fontSize: 24, color: TEXT, align: "center", margin: 0,
  });
  s.addText("Thank you for your attention.", {
    x: 0.7, y: 4.95, w: W - 1.4, h: 0.4,
    fontFace: FONT_B, fontSize: 14, italic: true, color: MUTED, align: "center", margin: 0,
  });

  s.addShape("line", {
    x: 4.65, y: 5.6, w: 4, h: 0,
    line: { color: ACCENT, width: 2 },
  });

  // URLs at bottom
  s.addText(
    [
      { text: "Production:  ", options: { color: MUTED, fontSize: 12 } },
      { text: "mongolz.vercel.app", options: { color: ACCENT, fontSize: 12, bold: true, fontFace: "Consolas", breakLine: true } },
      { text: "ML Service:  ", options: { color: MUTED, fontSize: 12 } },
      { text: "mongolz-ml-production.up.railway.app", options: { color: ACCENT, fontSize: 12, bold: true, fontFace: "Consolas" } },
    ],
    {
      x: 0.7, y: 5.85, w: W - 1.4, h: 1.0,
      fontFace: FONT_B, align: "center", paraSpaceAfter: 4, margin: 0,
    }
  );

  // Page number
  s.addText(`${pageNum} / ${totalSlides}`, {
    x: W - 1.5, y: H - 0.5, w: 1, h: 0.3,
    fontFace: FONT_B, fontSize: 10, color: MUTED, align: "right", margin: 0,
  });
}

// ───── Write file ─────
const outPath = path.join(__dirname, "MONGOLZ_Security_발표자료.pptx");
pres.writeFile({ fileName: outPath }).then(() => {
  const stats = fs.statSync(outPath);
  console.log(`✓ pptx written: ${outPath}`);
  console.log(`  size: ${(stats.size / 1024).toFixed(1)} KB`);
  console.log(`  slides: ${totalSlides}`);
}).catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
