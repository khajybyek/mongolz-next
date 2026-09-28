/**
 * MONGOLZ Security — Multi-language Support
 * mongolz/translations.py-аас шилжүүлсэн.
 */

export const LANGUAGES = {
  mn: "Монгол",
  en: "English",
  kr: "한국어",
} as const;

export type Lang = keyof typeof LANGUAGES;

export const T = {
  close: { mn: "Хаах", en: "Close", kr: "닫기" },
  // UI copy for the operations overview and public preview.
  dash_operations: { mn: "Аюулгүй байдлын хяналт", en: "Security overview", kr: "보안 현황" },
  dash_trend_description: { mn: "Өдөр тутмын сэрэмжлүүлэг · Солонгосын цагаар", en: "Daily alert volume · Korea Standard Time", kr: "일별 알림 수 · 한국 표준시" },
  dash_alerts_empty_description: { mn: "Шинэ илрүүлэлт энд харагдана. Холбогдсон камеруудыг хяналтын хэсгээс үзээрэй.", en: "New detections will appear here. Open monitoring to watch connected cameras.", kr: "새로운 감지 내역이 여기에 표시됩니다. 모니터링에서 연결된 카메라를 확인하세요." },
  dash_activity_description: { mn: "Сүүлийн сэрэмжлүүлэг болон хэрэглэгчийн үйлдэл", en: "Recent alerts and account activity", kr: "최근 알림 및 계정 활동" },
  dash_data_unavailable: { mn: "Мэдээлэл авах боломжгүй", en: "Data unavailable", kr: "데이터를 불러올 수 없습니다" },
  dash_realtime_connected: { mn: "Холбогдсон", en: "Connected", kr: "연결됨" },
  dash_realtime_connecting: { mn: "Холбогдож байна", en: "Connecting", kr: "연결 중" },
  dash_realtime_offline: { mn: "Холболт тасарсан", en: "Connection interrupted", kr: "연결 끊김" },
  dash_ml_service: { mn: "Таних үйлчилгээ", en: "Recognition service", kr: "인식 서비스" },
  dash_database: { mn: "Өгөгдлийн сан", en: "Database", kr: "데이터베이스" },
  dash_no_baseline: { mn: "Өмнөх хугацаанд сэрэмжлүүлэг бүртгэгдээгүй", en: "No previous-period alerts", kr: "이전 기간의 알림 없음" },
  dash_enabled_cameras: { mn: "Идэвхжүүлсэн камер", en: "Enabled cameras", kr: "활성화된 카메라" },
  dash_login_failed: { mn: "Нэвтрэх оролдлого амжилтгүй", en: "Sign-in failed", kr: "로그인 실패" },
  dash_login_blocked: { mn: "Нэвтрэхийг хориглосон", en: "Sign-in blocked", kr: "로그인 차단됨" },
  dash_reveal_requested: { mn: "Нүүр ил болгох хүсэлт", en: "Reveal requested", kr: "공개 요청됨" },
  dash_reveal_approved: { mn: "Нүүр ил болгохыг зөвшөөрсөн", en: "Reveal approved", kr: "공개 승인됨" },
  dash_reveal_rejected: { mn: "Нүүр ил болгохоос татгалзсан", en: "Reveal rejected", kr: "공개 거부됨" },
  dash_reveal_completed: { mn: "Нүүр ил болгож дууссан", en: "Reveal completed", kr: "공개 완료됨" },
  home_preview_label: { mn: "Интерфэйсийн жишээ", en: "Product preview", kr: "제품 미리보기" },
  home_preview_note: { mn: "Жишээ өгөгдөл · Бодит хяналтын мэдээлэл нэвтэрсний дараа харагдана", en: "Illustrative data · Sign in to view your workspace", kr: "예시 데이터 · 로그인하여 실제 현황을 확인하세요" },
  home_workspace: { mn: "Хяналтын төв", en: "Control center", kr: "통합 관제" },
  home_privacy_label: { mn: "Нууцлалын хамгаалалт", en: "Privacy protection", kr: "개인정보 보호" },
  home_access_label: { mn: "Эрхийн удирдлага", en: "Access control", kr: "접근 권한 관리" },
  home_open_feature: { mn: "Нээх", en: "Explore", kr: "살펴보기" },
  home_stat_locales: { mn: "Интерфэйсийн хэл", en: "Interface languages", kr: "인터페이스 언어" },
  home_stat_locales_value: { mn: "MN · EN · KR", en: "MN · EN · KR", kr: "MN · EN · KR" },

  // ── Navigation ──
  nav_dashboard: { mn: "Хяналтын самбар", en: "Dashboard", kr: "대시보드" },
  nav_live: { mn: "Live бичлэг", en: "Live Feed", kr: "라이브" },
  nav_playback: { mn: "Тоглуулагч", en: "Playback", kr: "재생" },
  nav_search: { mn: "Царай хайх", en: "Face Search", kr: "얼굴 검색" },
  nav_incidents: { mn: "Хэрэг бүртгэл", en: "Incidents", kr: "사건 관리" },
  nav_suspects: { mn: "Сэжигтэн", en: "Suspects", kr: "용의자" },
  nav_alerts: { mn: "Сэрэмжлүүлэг", en: "Alerts", kr: "알림" },
  nav_analytics: { mn: "Аналитик", en: "Analytics", kr: "분석" },
  nav_ai: { mn: "AI Шинжилгээ", en: "AI Analysis", kr: "AI 분석" },
  nav_faces: { mn: "Бүх царайнууд", en: "All Faces", kr: "모든 얼굴" },
  nav_audit: { mn: "Аудит лог", en: "Audit Log", kr: "감사 로그" },
  nav_cameras: { mn: "Камер удирдах", en: "Cameras", kr: "카메라" },
  nav_settings: { mn: "Тохиргоо", en: "Settings", kr: "설정" },
  nav_docs: { mn: "Баримтжуулалт", en: "Docs", kr: "문서" },
  nav_users: { mn: "Хэрэглэгчид", en: "Users", kr: "사용자" },
  nav_alert_rules: { mn: "Дүрэм", en: "Alert Rules", kr: "알림 규칙" },
  nav_webhooks: { mn: "Webhook", en: "Webhooks", kr: "웹훅" },
  nav_active_learning: { mn: "Active Learning", en: "Active Learning", kr: "학습 피드백" },
  nav_benchmarks: { mn: "Гүйцэтгэл", en: "Benchmarks", kr: "성능" },
  nav_reveal_approvals: { mn: "Reveal зөвшөөрөл", en: "Reveal Approvals", kr: "공개 승인" },
  nav_retention: { mn: "Хадгалах хугацаа", en: "Retention", kr: "보존 정책" },
  nav_alerts_live: { mn: "Alerts Live", en: "Alerts Live", kr: "실시간 알림" },
  nav_db_monitor: { mn: "DB Performance", en: "DB Performance", kr: "DB 성능" },

  // ── Login ──
  login_title: { mn: "Нэвтрэх", en: "Sign In", kr: "로그인" },
  login_email: { mn: "Имэйл эсвэл хэрэглэгчийн нэр", en: "Email or username", kr: "이메일 또는 사용자명" },
  login_pass: { mn: "Нууц үг", en: "Password", kr: "비밀번호" },
  login_btn: { mn: "Нэвтрэх", en: "Sign In", kr: "로그인" },
  login_error: {
    mn: "И-мэйл эсвэл нууц үг буруу!",
    en: "Invalid email or password!",
    kr: "이메일 또는 비밀번호가 잘못되었습니다!",
  },
  logout: { mn: "Гарах", en: "Logout", kr: "로그아웃" },

  // ── Dashboard ──
  total_faces: { mn: "Нийт царай", en: "Total Faces", kr: "총 얼굴" },
  suspects: { mn: "Сэжигтэн", en: "Suspects", kr: "용의자" },
  today_alerts: { mn: "Өнөөдрийн Alert", en: "Today's Alerts", kr: "오늘의 알림" },
  recording_days: { mn: "Бичлэгтэй өдөр", en: "Recording Days", kr: "녹화 일수" },
  daily_faces: { mn: "Өдөр бүрийн царайны тоо", en: "Daily Face Count", kr: "일별 얼굴 수" },
  recent_alerts: { mn: "Сүүлийн Alerts", en: "Recent Alerts", kr: "최근 알림" },

  // ── Live ──
  select_camera: { mn: "Камер сонгох", en: "Select Camera", kr: "카메라 선택" },
  start_recording: { mn: "Бичлэг эхлүүлэх", en: "Start Recording", kr: "녹화 시작" },
  stop_recording: { mn: "Зогсоох", en: "Stop Recording", kr: "녹화 중지" },
  camera_error: { mn: "Камер нээгдсэнгүй!", en: "Camera not available!", kr: "카메라를 사용할 수 없습니다!" },
  saved_recordings: { mn: "Хадгалагдсан бичлэгүүд", en: "Saved Recordings", kr: "저장된 녹화" },
  download: { mn: "Татах", en: "Download", kr: "다운로드" },

  // ── Suspects ──
  manage_suspects: { mn: "Сэжигтэн удирдах", en: "Manage Suspects", kr: "용의자 관리" },
  suspect_name: { mn: "Нэр", en: "Name", kr: "이름" },
  suspect_photo: { mn: "Зураг оруулах", en: "Upload Photo", kr: "사진 업로드" },
  add_suspect: { mn: "Нэмэх", en: "Add", kr: "추가" },
  delete: { mn: "Устгах", en: "Delete", kr: "삭제" },

  // ── Alerts ──
  alert_history: { mn: "Alert түүх", en: "Alert History", kr: "알림 기록" },
  no_alerts: { mn: "Alert бүртгэгдээгүй байна.", en: "No alerts recorded.", kr: "알림이 없습니다." },
  export_csv: { mn: "CSV татах", en: "Export CSV", kr: "CSV 내보내기" },

  // ── Settings ──
  settings: { mn: "Тохиргоо", en: "Settings", kr: "설정" },
  threshold: { mn: "Тааралтын босго", en: "Match Threshold", kr: "일치 임계값" },
  language: { mn: "Хэл", en: "Language", kr: "언어" },

  // ── Face Search ──
  face_search: { mn: "Царай хайх", en: "Face Search", kr: "얼굴 검색" },
  upload_face: {
    mn: "Хайх царайн зураг оруулна уу",
    en: "Upload a face image to search",
    kr: "검색할 얼굴 이미지를 업로드하세요",
  },
  search_results: { mn: "Хайлтын үр дүн", en: "Search Results", kr: "검색 결과" },
  matches_found: { mn: "Тааралт олдлоо", en: "Matches Found", kr: "일치 항목 발견" },
  no_matches: { mn: "Тааралт олдсонгүй", en: "No Matches Found", kr: "일치 항목 없음" },
  first_seen: { mn: "Анх илэрсэн", en: "First Seen", kr: "처음 발견" },
  last_seen: { mn: "Сүүлд илэрсэн", en: "Last Seen", kr: "마지막 발견" },

  // ── Audit ──
  audit_log: { mn: "Аудит лог", en: "Audit Log", kr: "감사 로그" },
  audit_desc: {
    mn: "Системд хийгдсэн бүх үйлдлийн бүртгэл",
    en: "Record of all system actions",
    kr: "모든 시스템 작업 기록",
  },
  filter_action: { mn: "Үйлдлээр шүүх", en: "Filter by Action", kr: "작업별 필터" },
  all: { mn: "Бүгд", en: "All", kr: "전체" },

  // ── Analytics ──
  analytics: { mn: "Аналитик", en: "Analytics", kr: "분석" },
  hourly_chart: { mn: "Цагаар (24ц)", en: "Hourly (24h)", kr: "시간별 (24시간)" },
  daily_chart: { mn: "Өдрөөр", en: "Daily", kr: "일별" },
  alert_chart: { mn: "Alert тоо (өдрөөр)", en: "Alerts (daily)", kr: "알림 (일별)" },
  top_suspects: { mn: "Топ сэжигтэн", en: "Top Suspects", kr: "주요 용의자" },

  // ── Cameras ──
  manage_cameras: { mn: "Камер удирдах", en: "Manage Cameras", kr: "카메라 관리" },
  camera_name: { mn: "Нэр", en: "Name", kr: "이름" },
  camera_url: { mn: "RTSP URL", en: "RTSP URL", kr: "RTSP URL" },
  camera_type: { mn: "Төрөл", en: "Type", kr: "유형" },
  add_camera: { mn: "Камер нэмэх", en: "Add Camera", kr: "카메라 추가" },

  // ── Common ──
  save: { mn: "Хадгалах", en: "Save", kr: "저장" },
  cancel: { mn: "Болих", en: "Cancel", kr: "취소" },
  confirm: { mn: "Баталгаажуулах", en: "Confirm", kr: "확인" },
  loading: { mn: "Уншиж байна...", en: "Loading...", kr: "로드 중..." },
  empty: { mn: "Өгөгдөл байхгүй", en: "No data", kr: "데이터 없음" },

  // ── Roles ──
  role_admin: { mn: "Админ", en: "Admin", kr: "관리자" },
  role_viewer: { mn: "Хянагч", en: "Viewer", kr: "뷰어" },
  role_auditor: { mn: "Аудитор", en: "Auditor", kr: "감사자" },

  // ── AI page ──
  ai_subtitle: {
    mn: "Claude AI-р DB-н статистик дээр шинжилгээ хийнэ",
    en: "Claude AI runs analytics on the database statistics",
    kr: "Claude AI가 DB 통계 데이터를 분석합니다",
  },
  ai_mode_summary: { mn: "Үнэлгээ", en: "Summary", kr: "요약" },
  ai_mode_anomaly: { mn: "Аномали", en: "Anomaly", kr: "이상 탐지" },
  ai_mode_chat: { mn: "Чат", en: "Chat", kr: "채팅" },
  ai_placeholder: {
    mn: "“Үнэлгээ” эсвэл “Аномали”-г сонгож шинжилгээ эхлүүл",
    en: "Pick “Summary” or “Anomaly” to start the analysis",
    kr: "“요약” 또는 “이상 탐지”를 선택해 분석을 시작하세요",
  },
  ai_running: {
    mn: "Claude хариулж байна...",
    en: "Claude is thinking…",
    kr: "Claude가 응답 중입니다…",
  },
  ai_run: { mn: "Шинжилгээ ажиллуулах", en: "Run analysis", kr: "분석 실행" },
  ai_chat_placeholder: {
    mn: "Аюулгүй байдлын талаар асуу...",
    en: "Ask about security…",
    kr: "보안에 대해 질문해 보세요…",
  },
  ai_send: { mn: "Илгээх", en: "Send", kr: "전송" },
  ai_error_generic: { mn: "Алдаа", en: "Error", kr: "오류" },

  // ── Page headers / common ──
  page_dashboard_subtitle: { mn: "Системийн төлөв", en: "System overview", kr: "시스템 개요" },
  total_recordings: { mn: "Нийт бичлэг", en: "Recordings", kr: "녹화" },
  recent_24h: { mn: "Сүүлийн 24 цаг", en: "Last 24h", kr: "최근 24시간" },

  // ── Reveal approvals ──
  reveal_approvals_title: { mn: "Reveal зөвшөөрөл", en: "Reveal approvals", kr: "공개 승인" },
  reveal_approvals_subtitle: {
    mn: "4-eyes principle — Reveal job-ыг зөвхөн өөр admin зөвшөөрсний дараа гүйцэтгэнэ",
    en: "4-eyes principle — a reveal job runs only after a second admin approves",
    kr: "4-eyes 원칙 — 다른 관리자의 승인 후에만 공개 작업이 실행됩니다",
  },
  pending_label: { mn: "Хүлээгдэж буй", en: "Pending", kr: "대기 중" },
  recent_decisions: { mn: "Сүүлийн шийдвэрүүд", en: "Recent decisions", kr: "최근 결정" },
  approve: { mn: "Зөвшөөрөх", en: "Approve", kr: "승인" },
  reject: { mn: "Татгалзах", en: "Reject", kr: "거부" },
  reason: { mn: "Шалтгаан", en: "Reason", kr: "사유" },
  reject_reason: { mn: "Татгалзах шалтгаан", en: "Reject reason", kr: "거부 사유" },
  requested_by: { mn: "Хүсэлт гаргасан", en: "Requested by", kr: "요청자" },
  no_pending: { mn: "Хүлээгдэж буй зөвшөөрөл байхгүй", en: "No pending approvals", kr: "대기 중인 승인이 없습니다" },
  no_decisions: { mn: "Бичлэг байхгүй", en: "No records", kr: "기록이 없습니다" },

  // ── Retention ──
  retention_title: { mn: "Хадгалах хугацааны бодлого", en: "Retention policies", kr: "보존 정책" },
  retention_subtitle: {
    mn: "Resource бүрд хэдэн хоног хадгалахыг тохируулна. Cron өдөр бүр устгана.",
    en: "Configure days-to-keep per resource. Cron sweeps daily.",
    kr: "리소스별 보존 일수를 설정합니다. 매일 크론이 정리합니다.",
  },
  run_sweep: { mn: "Гар sweep ажиллуулах", en: "Run sweep now", kr: "지금 정리 실행" },
  retention_days: { mn: "Retention (хоног)", en: "Retention (days)", kr: "보존 (일)" },
  active: { mn: "Идэвхтэй", en: "Active", kr: "활성" },
  last_swept: { mn: "Сүүлийн sweep", en: "Last sweep", kr: "최근 정리" },

  // ── DB monitor ──
  db_monitor_title: { mn: "DB Performance", en: "DB Performance", kr: "DB 성능" },
  db_monitor_subtitle: {
    mn: "pg_stat_statements — top-30 query (sorted by mean execution time)",
    en: "pg_stat_statements — top-30 queries (sorted by mean exec time)",
    kr: "pg_stat_statements — 평균 실행 시간 기준 상위 30 쿼리",
  },
  query: { mn: "Query", en: "Query", kr: "쿼리" },
  calls: { mn: "Calls", en: "Calls", kr: "호출" },

  // ── Alerts live ──
  alerts_live_title: { mn: "Бодит цагийн alert", en: "Real-time Alerts", kr: "실시간 알림" },
  alerts_live_subtitle: {
    mn: "Сүүлийн 60 минутын alerts + шууд урсгал",
    en: "Last 60 minutes of alerts + live stream",
    kr: "최근 60분 알림 + 실시간 스트림",
  },
  realtime_channel: { mn: "Realtime channel", en: "Realtime channel", kr: "실시간 채널" },
  connected: { mn: "Холбогдсон", en: "Connected", kr: "연결됨" },
  connecting: { mn: "Холбогдож байна…", en: "Connecting…", kr: "연결 중…" },
  total_in_60m: { mn: "Нийт (60 мин дотор)", en: "Total (last 60m)", kr: "총 (60분)" },
  top_suspects_label: { mn: "Топ сэжигтэн", en: "Top suspects", kr: "주요 용의자" },
  top_cameras_label: { mn: "Топ камер", en: "Top cameras", kr: "주요 카메라" },
  recent_alerts_live: { mn: "Сүүлийн alerts (live)", en: "Recent alerts (live)", kr: "최근 알림 (실시간)" },

  // ── Erase ──
  erase_title: { mn: "Бүртгэлээ устгах", en: "Erase your account", kr: "계정 삭제" },
  erase_subtitle: {
    mn: "Устгуулах эрх — GDPR Art.17 / PIPA §36",
    en: "Right to erasure — GDPR Art.17 / PIPA §36",
    kr: "삭제권 — GDPR 17조 / PIPA §36",
  },

  // ── Live — toolbar ──
  start: { mn: "Эхлүүлэх", en: "Start", kr: "시작" },
  stop: { mn: "Зогсоох", en: "Stop", kr: "중지" },
  recording_label: { mn: "Бичиж байна", en: "Recording", kr: "녹화 중" },

  // ── Generic actions / common ──
  edit: { mn: "Засах", en: "Edit", kr: "편집" },
  add: { mn: "Нэмэх", en: "Add", kr: "추가" },
  remove: { mn: "Хасах", en: "Remove", kr: "제거" },
  search_btn: { mn: "Хайх", en: "Search", kr: "검색" },
  filter: { mn: "Шүүх", en: "Filter", kr: "필터" },
  apply: { mn: "Хэрэглэх", en: "Apply", kr: "적용" },
  reset: { mn: "Сэргээх", en: "Reset", kr: "초기화" },
  back: { mn: "Буцах", en: "Back", kr: "뒤로" },
  yes: { mn: "Тийм", en: "Yes", kr: "예" },
  no: { mn: "Үгүй", en: "No", kr: "아니오" },
  enabled: { mn: "Идэвхтэй", en: "Enabled", kr: "사용" },
  disabled: { mn: "Идэвхгүй", en: "Disabled", kr: "사용 안 함" },
  on: { mn: "On", en: "On", kr: "켜짐" },
  off: { mn: "Off", en: "Off", kr: "꺼짐" },
  next_btn: { mn: "Дараа", en: "Next", kr: "다음" },
  prev_btn: { mn: "Өмнөх", en: "Previous", kr: "이전" },
  upload: { mn: "Илгээх", en: "Upload", kr: "업로드" },
  preview: { mn: "Урьдчилан харах", en: "Preview", kr: "미리보기" },
  optional: { mn: "сонголтот", en: "optional", kr: "선택" },
  required_field: { mn: "заавал", en: "required", kr: "필수" },

  // ── Dashboard ──
  dashboard_title: { mn: "Хяналтын самбар", en: "Dashboard", kr: "대시보드" },
  dashboard_subtitle: { mn: "Системийн ерөнхий төлөв", en: "System overview", kr: "시스템 개요" },

  // ── Live page ──
  live_title: { mn: "Live бичлэг", en: "Live", kr: "라이브" },
  live_subtitle: {
    mn: "Камер сонгож real-time bbox overlay-той бичлэг хийх",
    en: "Pick a camera and record with real-time bbox overlay",
    kr: "카메라를 선택하고 실시간 bbox 오버레이로 녹화하기",
  },
  no_camera_permission: {
    mn: "Камер хандах эрх олгогдсонгүй",
    en: "Camera access permission denied",
    kr: "카메라 접근 권한이 거부되었습니다",
  },
  camera_pick: { mn: "Камер сонгох", en: "Pick camera", kr: "카메라 선택" },
  no_camera_detected: { mn: "— Илрээгүй —", en: "— Not detected —", kr: "— 감지되지 않음 —" },
  click_start: { mn: "‘Эхлүүлэх’ товчийг дар", en: "Press “Start”", kr: "“시작” 버튼을 누르세요" },
  faces_label: { mn: "нүүр", en: "faces", kr: "얼굴" },
  loading_label: { mn: "loading…", en: "loading…", kr: "로딩 중…" },

  // ── Audit page ──
  audit_title: { mn: "Аудит лог", en: "Audit log", kr: "감사 로그" },
  audit_subtitle: {
    mn: "Системд гарсан бүх үйлдлийн hash-chain бүртгэл",
    en: "Hash-chain log of every system action",
    kr: "모든 시스템 작업의 해시 체인 기록",
  },
  audit_filter_action: { mn: "Үйлдэл", en: "Action", kr: "작업" },
  audit_filter_user: { mn: "Хэрэглэгч", en: "User", kr: "사용자" },
  audit_filter_q: { mn: "Хайх (detail)", en: "Search (detail)", kr: "검색 (상세)" },
  audit_filter_from: { mn: "Эхлэх огноо", en: "From", kr: "시작 날짜" },
  audit_filter_to: { mn: "Дуусах огноо", en: "To", kr: "종료 날짜" },
  audit_export: { mn: "CSV татах", en: "Export CSV", kr: "CSV 내보내기" },
  audit_no_results: { mn: "Тохирох бүртгэл олдсонгүй", en: "No matching entries", kr: "일치하는 기록이 없습니다" },
  audit_col_when: { mn: "Хэзээ", en: "When", kr: "시간" },
  audit_col_action: { mn: "Үйлдэл", en: "Action", kr: "작업" },
  audit_col_user: { mn: "Хэрэглэгч", en: "User", kr: "사용자" },
  audit_col_detail: { mn: "Дэлгэрэнгүй", en: "Detail", kr: "상세" },
  audit_col_ip: { mn: "IP", en: "IP", kr: "IP" },

  // ── Cameras ──
  cameras_title: { mn: "Камер удирдах", en: "Cameras", kr: "카메라" },
  cameras_subtitle: { mn: "Бүртгэлтэй камерууд", en: "Registered cameras", kr: "등록된 카메라" },
  schedule: { mn: "Хуваарь", en: "Schedule", kr: "일정" },
  permissions: { mn: "Эрх", en: "Permissions", kr: "권한" },
  consent_on: { mn: "✓ Consent ON — даран унтраах", en: "✓ Consent ON — click to disable", kr: "✓ Consent ON — 클릭하여 비활성화" },
  consent_off: { mn: "○ Consent off — идэвхжүүлэх", en: "○ Consent off — enable", kr: "○ Consent off — 활성화" },
  consent_badge: { mn: "Consent", en: "Consent", kr: "동의 필요" },

  // ── Schedule page ──
  schedule_title_prefix: { mn: "Хуваарь —", en: "Schedule —", kr: "일정 —" },
  schedule_subtitle: {
    mn: "Цагийн цонх бүрд нууцлалын горим сонгоно (Asia/Seoul). Цонхноос гадуур default горим үйлчилнэ.",
    en: "Pick a privacy mode per time window (Asia/Seoul). Outside every window the default mode applies.",
    kr: "시간대별로 프라이버시 모드를 선택합니다(Asia/Seoul). 어떤 시간대에도 속하지 않으면 기본 모드가 적용됩니다.",
  },
  schedule_new_window: { mn: "Шинэ window нэмэх", en: "Add new window", kr: "새 시간대 추가" },
  schedule_mode_standard: { mn: "Стандарт", en: "Standard", kr: "표준" },
  schedule_mode_private: { mn: "Нууцлал", en: "Private", kr: "프라이버시" },
  schedule_explain_title: { mn: "Горимууд юу хийдэг вэ", en: "What the modes do", kr: "모드별 동작" },
  schedule_explain_masking: {
    mn: "Нүүрний маск үргэлж идэвхтэй — шууд дамжуулалт болон playback аль ч горимд маскласан хэвээр. Хуваарь хэзээ ч видеог илрүүлэхгүй; илрүүлэлт зөвхөн 4-eyes reveal-ээр хийгдэнэ.",
    en: "Face masking is always on — live view and playback stay masked in both modes. A schedule never un-masks video; un-masking is only ever the 4-eyes reveal.",
    kr: "얼굴 마스킹은 항상 켜져 있습니다 — 두 모드 모두 실시간 화면과 재생은 마스킹된 상태입니다. 일정은 영상의 마스킹을 절대 해제하지 않으며, 해제는 오직 4-eyes reveal로만 가능합니다.",
  },
  schedule_explain_private: {
    mn: "«Нууцлал» горимд нүүр таних, нүүрний бичлэг/зураг хадгалах, сэжигтэн тулгах, сэрэмжлүүлэг, edge inference бүгд унтарна. Тэр үед бичигдсэн хэсгийг reveal хийх боломжгүй.",
    en: "Private switches off face recognition, stored faces and crops, suspect matching, alerts and edge inference. Footage captured in private mode can never be revealed.",
    kr: "프라이버시 모드에서는 얼굴 인식, 얼굴 기록·크롭 저장, 용의자 매칭, 알림, 엣지 추론이 모두 꺼집니다. 이 모드에서 촬영된 영상은 reveal할 수 없습니다.",
  },
  schedule_explain_capture: {
    mn: "Горим нь кадр бичигдэх мөчид үйлчилнэ, үзэх үед биш. Цонхны хил дээр ML үйлчилгээ аюулгүй тал руу хазайдаг: нууцлалын цонх дууссанаас хойш хэдэн секундын дараа л таних дахин асна. Өөрчлөлт ажиллаж буй камерт ихэвчлэн 30 орчим секундэд хүрнэ; ML өгөгдлийн санг уншиж чадахгүй бол сүүлд уншсан хуваарийг 10 минут хүртэл хэрэглээд, дараа нь танихыг зогсооно.",
    en: "The mode applies when a frame is captured, not when it is watched. At a window boundary the ML service errs on the safe side: recognition resumes a few seconds after a private window ends. A change usually reaches running cameras within about 30 seconds; if the ML service cannot read the database it keeps the last schedule it read for up to 10 minutes, then pauses recognition.",
    kr: "모드는 시청 시점이 아니라 프레임이 촬영되는 시점에 적용됩니다. 시간대 경계에서 ML 서비스는 안전한 쪽을 택합니다: 프라이버시 시간대가 끝나고 몇 초 뒤에야 인식이 다시 켜집니다. 변경 사항은 보통 약 30초 안에 실행 중인 카메라에 반영되며, ML 서비스가 데이터베이스를 읽지 못하면 마지막으로 읽은 일정을 최대 10분간 사용한 뒤 인식을 중지합니다.",
  },
  schedule_explain_retroactive: {
    mn: "Нууцлалын цонх нэмэх эсвэл default-ыг нууцлал болгох нь тэр цагт АЛЬ ХЭДИЙН бичигдсэн (стандарт горимд) бичлэгийг ч reveal-ээс хасна — цонх байгаа л бол. Дараа нь сулруулбал (TOTP) тэр бичлэг дахин reveal хийгдэх боломжтой болно; аль хэдийн танигдсан нүүр устахгүй. Нууцлалын горимд бичигдсэн бичлэг хожим юу ч өөрчлөгдсөн reveal хийгдэхгүй.",
    en: "Adding a private window or switching the default to private also withholds footage ALREADY recorded in those hours (in standard mode) from reveal — for as long as the window exists. Loosening it later (TOTP step-up) makes that footage revealable again; faces already identified are not deleted. Footage captured in private mode stays unrevealable whatever changes later.",
    kr: "프라이버시 시간대를 추가하거나 기본값을 프라이버시로 바꾸면 해당 시간에 이미 (표준 모드로) 녹화된 영상도 그 시간대가 존재하는 동안 reveal에서 제외됩니다. 나중에 완화하면(TOTP 재인증) 그 영상은 다시 reveal할 수 있게 되며, 이미 식별된 얼굴은 삭제되지 않습니다. 프라이버시 모드로 촬영된 영상은 이후 무엇이 바뀌어도 reveal할 수 없습니다.",
  },
  schedule_explain_stepup: {
    mn: "Хамгаалалтыг сулруулах (стандарт цонх нэмэх, нууцлалын цонх устгах, default-ыг стандарт болгох) нь TOTP баталгаажуулалт шаардаж, бусад админд мэдэгдэнэ. Чангатгах нь нэг товшилт.",
    en: "Loosening (adding a standard window, deleting a private one, switching the default to standard) needs a TOTP step-up and notifies the other admins. Tightening is one click.",
    kr: "보호를 완화하는 변경(표준 시간대 추가, 프라이버시 시간대 삭제, 기본값을 표준으로 변경)은 TOTP 재인증이 필요하며 다른 관리자에게 알림이 갑니다. 강화는 한 번의 클릭으로 됩니다.",
  },
  schedule_explain_example: {
    mn: "Жишээ: 09:00–18:00 нууцлал (ажилтан, үйлчлүүлэгчийг хэзээ ч танихгүй), ажлын бус цагт стандарт (халдагчийг таньж сэрэмжлүүлнэ) — зорилгын хязгаарлалт, өгөгдлийг цөөрүүлэх (GDPR Art.5(1)(b)(c), Art.25).",
    en: "Example: 09:00–18:00 private (staff and customers are never identified), standard after hours (recognition and alerts for intruders) — purpose limitation and data minimisation by time (GDPR Art.5(1)(b)(c), Art.25).",
    kr: "예: 09:00–18:00 프라이버시(직원과 고객은 절대 식별되지 않음), 업무 시간 외에는 표준(침입자 인식 및 알림) — 시간 기반 목적 제한 및 데이터 최소화(GDPR Art.5(1)(b)(c), Art.25).",
  },
  schedule_time_hint: {
    mn: "Дуусах цаг 24:00 байж болно; эхлэх нь болохгүй. Эхлэх > дуусах бол шөнийн цонх — эхэлсэн өдөртөө хамаарна (Ба 22:00–06:00 нь Бя 02:00-г хамарна). Бүтэн өдөр: 00:00–24:00.",
    en: "End may be 24:00, start may not. Start after end = overnight window, owned by the day it starts (Fri 22:00–06:00 covers Sat 02:00). Whole day: 00:00–24:00.",
    kr: "종료는 24:00이 될 수 있지만 시작은 안 됩니다. 시작이 종료보다 늦으면 야간 시간대이며 시작한 요일에 속합니다(금 22:00–06:00은 토 02:00 포함). 하루 전체: 00:00–24:00.",
  },
  schedule_err_time_format: { mn: "Цагийг HH:MM хэлбэрээр оруулна уу", en: "Enter times as HH:MM", kr: "시간은 HH:MM 형식으로 입력하세요" },
  schedule_err_same_time: {
    mn: "Эхлэх, дуусах цаг ижил байж болохгүй — бүтэн өдөрт 00:00–24:00 ашиглана уу",
    en: "Start and end cannot be the same — use 00:00–24:00 for a whole day",
    kr: "시작과 종료가 같을 수 없습니다 — 하루 전체는 00:00–24:00을 사용하세요",
  },
  schedule_err_start_24: {
    mn: "Цонх 24:00-д эхэлж болохгүй (24:00 нь зөвхөн дуусах цаг)",
    en: "A window cannot start at 24:00 (24:00 is an end time only)",
    kr: "시간대는 24:00에 시작할 수 없습니다(24:00은 종료 시간 전용)",
  },
  schedule_err_invalid: { mn: "Буруу утга", en: "Invalid input", kr: "잘못된 입력" },
  schedule_err_not_found: {
    mn: "Цонх олдсонгүй — аль хэдийн устгагдсан байж магадгүй",
    en: "Window not found — it may already have been removed",
    kr: "시간대를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다",
  },
  schedule_err_camera_not_found: { mn: "Камер олдсонгүй", en: "Camera not found", kr: "카메라를 찾을 수 없습니다" },
  schedule_err_conflict: {
    mn: "Энэ хооронд өөр хүн өөрчилсөн — хуудсыг сэргээгээд дахин оролдоно уу",
    en: "Someone changed this meanwhile — reload the page and try again",
    kr: "그 사이에 다른 사람이 변경했습니다 — 페이지를 새로고침하고 다시 시도하세요",
  },
  schedule_err_save_failed: { mn: "Хадгалж чадсангүй", en: "Could not save", kr: "저장하지 못했습니다" },
  schedule_note_placeholder: {
    mn: "Тэмдэглэл (optional) — ажлын цаг гэх мэт",
    en: "Note (optional) — e.g. working hours",
    kr: "메모 (선택) — 예: 근무 시간",
  },
  schedule_add_window: { mn: "Window нэмэх", en: "Add window", kr: "시간대 추가" },
  schedule_weekdays_hint: {
    mn: "Жишээ: 127 = өдөр бүр · 62 = Да-Ба ажлын өдрүүд · 65 = Ня+Бя амралт",
    en: "Examples: 127 = every day · 62 = Mon-Fri · 65 = Sun+Sat",
    kr: "예시: 127 = 매일 · 62 = 월-금 · 65 = 일+토",
  },
  schedule_col_mode: { mn: "Горим", en: "Mode", kr: "모드" },
  schedule_col_time: { mn: "Цаг", en: "Time", kr: "시간" },
  schedule_col_weekdays: { mn: "Өдрүүд", en: "Weekdays", kr: "요일" },
  schedule_col_note: { mn: "Тэмдэглэл", en: "Note", kr: "메모" },
  schedule_col_action: { mn: "Үйлдэл", en: "Action", kr: "작업" },
  schedule_empty: {
    mn: "Window бүртгэгдээгүй — default ажиллаж байна.",
    en: "No windows — default mode is in effect.",
    kr: "시간대가 없음 — 기본 모드가 적용됩니다.",
  },
  schedule_current_state: { mn: "Одоогийн төлөв", en: "Current state", kr: "현재 상태" },
  schedule_current_hint: {
    mn: "Хадгалсан хуваарийн дагуух горим (Asia/Seoul, одоо). Ажиллаж буй камер өөрчлөлтийг ихэвчлэн 30 орчим секундэд, ML өгөгдлийн санг уншиж чадахгүй бол 10 минут хүртэл хугацаанд хэрэглэнэ; бодитоор юу хэрэглэгдэж байгааг /grid дээрх шууд тэмдэг харуулна.",
    en: "Mode per the saved schedule (Asia/Seoul, now). Running cameras apply edits usually within about 30 s, or up to 10 min if the ML service cannot read the database; the live badge on /grid shows what is actually applied.",
    kr: "저장된 일정에 따른 모드(Asia/Seoul, 현재). 실행 중인 카메라는 보통 약 30초 안에, ML 서비스가 데이터베이스를 읽지 못하면 최대 10분 안에 변경을 적용합니다. 실제로 적용 중인 상태는 /grid의 실시간 배지에 표시됩니다.",
  },
  schedule_default_mode: { mn: "Default горим (window-аас гадуур)", en: "Default mode (outside windows)", kr: "기본 모드 (시간대 외)" },
  schedule_default_standard: {
    mn: "Стандарт — нүүр таних, сэрэмжлүүлэг идэвхтэй",
    en: "Standard — recognition and alerts on",
    kr: "표준 — 얼굴 인식 및 알림 켜짐",
  },
  schedule_default_private: {
    mn: "Нууцлал — нүүр таних унтарсан, reveal хийхгүй",
    en: "Private — no recognition, no reveal",
    kr: "프라이버시 — 인식 없음, reveal 불가",
  },
  schedule_default_hint: {
    mn: "Default-ыг стандарт болгох нь цонхноос гадуур нүүр танихыг дахин асаана — TOTP баталгаажуулалт шаардана.",
    en: "Switching the default to standard turns recognition back on outside windows — it needs a TOTP step-up.",
    kr: "기본값을 표준으로 바꾸면 시간대 밖에서 얼굴 인식이 다시 켜집니다 — TOTP 재인증이 필요합니다.",
  },

  // ── Permissions page ──
  permissions_title_prefix: { mn: "Эрх —", en: "Permissions —", kr: "권한 —" },
  permissions_subtitle: {
    mn: "Хэн ямар камерт хандах эрхтэйг тодорхой хязгаарлах. Хоосон бол бүх viewer/auditor хандана.",
    en: "Restrict which users can access this camera. Empty list → all viewers/auditors can.",
    kr: "이 카메라에 접근할 수 있는 사용자를 제한합니다. 비어 있으면 모든 viewer/auditor가 접근 가능합니다.",
  },
  perm_col_email: { mn: "Имэйл", en: "Email", kr: "이메일" },
  perm_col_role: { mn: "Role", en: "Role", kr: "역할" },
  perm_col_permission: { mn: "Permission", en: "Permission", kr: "권한" },
  perm_empty: {
    mn: "Хязгаарлалт байхгүй — бүх viewer/auditor хандана.",
    en: "No restrictions — all viewers/auditors can access.",
    kr: "제한 없음 — 모든 viewer/auditor가 접근 가능합니다.",
  },
  perm_grant_title: { mn: "Эрх олгох", en: "Grant access", kr: "권한 부여" },
  perm_pick_user: { mn: "— Хэрэглэгч сонгох —", en: "— Pick user —", kr: "— 사용자 선택 —" },
  perm_view: { mn: "View — playback харах", en: "View — playback only", kr: "View — 재생만" },
  perm_operate: { mn: "Удирдах — бичлэг эхлүүлэх/зогсоох", en: "Operate — start/stop recording", kr: "Operate — 녹화 시작/중지" },
  perm_grant: { mn: "Олгох", en: "Grant", kr: "부여" },

  // ── Suspects ──
  suspects_title: { mn: "Сэжигтэн удирдах", en: "Suspects", kr: "용의자 관리" },
  suspect_full_name: { mn: "Нэр", en: "Name", kr: "이름" },
  suspect_notes: { mn: "Тэмдэглэл", en: "Notes", kr: "메모" },
  suspect_add_btn: { mn: "Сэжигтэн нэмэх", en: "Add suspect", kr: "용의자 추가" },

  // ── Faces ──
  faces_title: { mn: "Илрүүлсэн царайнууд", en: "Detected faces", kr: "감지된 얼굴" },
  faces_subtitle: {
    mn: "Бүх илрүүлэлтийн галерей. Сүүлийн 60 элемент.",
    en: "Gallery of every detection. Latest 60 items.",
    kr: "전체 감지 갤러리. 최근 60개.",
  },

  // ── Search ──
  search_title: { mn: "Царай хайх", en: "Face search", kr: "얼굴 검색" },
  search_subtitle: {
    mn: "Зураг оруулаад түүнтэй ижил царайнуудыг олно",
    en: "Upload an image to find matching faces",
    kr: "이미지를 업로드하여 일치하는 얼굴 찾기",
  },
  search_no_results: { mn: "Тааралт олдсонгүй", en: "No matches", kr: "일치 항목 없음" },

  // ── Alerts (history) ──
  alerts_title: { mn: "Alert түүх", en: "Alert history", kr: "알림 기록" },
  alerts_subtitle: { mn: "Suspect-тэй тааралцал бүртгэгдсэн", en: "Recorded suspect matches", kr: "용의자 일치 기록" },

  // ── Alert rules ──
  alert_rules_title: { mn: "Alert дүрэм", en: "Alert rules", kr: "알림 규칙" },
  alert_rules_subtitle: {
    mn: "Suspect/camera тус бүрд dedup, burst, quiet hours",
    en: "Per-suspect/camera dedup, burst, quiet hours",
    kr: "용의자/카메라별 중복 제거, 폭주, 정숙 시간",
  },

  // ── Webhooks ──
  webhooks_title: { mn: "Webhook удирдах", en: "Webhooks", kr: "웹훅 관리" },
  webhooks_subtitle: {
    mn: "Slack / Discord / ерөнхий HMAC хүлээн авагч",
    en: "Slack / Discord / generic HMAC destinations",
    kr: "Slack / Discord / 일반 HMAC 대상",
  },

  // ── Active learning ──
  active_learning_title: { mn: "Active learning", en: "Active learning", kr: "학습 피드백" },
  active_learning_subtitle: {
    mn: "TP/FP/Unknown гэж label өгч F1-optimal threshold-ыг тооцоолно",
    en: "Label TP/FP/Unknown to compute F1-optimal thresholds",
    kr: "TP/FP/Unknown 라벨링으로 F1-최적 임계값 계산",
  },
  label_tp: { mn: "Жинхэнэ", en: "True positive", kr: "정탐" },
  label_fp: { mn: "Худал", en: "False positive", kr: "오탐" },
  label_unknown: { mn: "Тодорхойгүй", en: "Unknown", kr: "불명" },

  // ── Users ──
  users_title: { mn: "Хэрэглэгчид", en: "Users", kr: "사용자" },
  users_subtitle: { mn: "Бүртгэлтэй хэрэглэгчид + role удирдах", en: "Registered users + role management", kr: "등록된 사용자 + 역할 관리" },
  users_add_title: { mn: "+ Шинэ хэрэглэгч", en: "+ New user", kr: "+ 새 사용자" },
  users_email: { mn: "Имэйл", en: "Email", kr: "이메일" },
  users_pass: { mn: "Нууц үг (8+)", en: "Password (8+)", kr: "비밀번호 (8+)" },
  users_full_name: { mn: "Бүтэн нэр (optional)", en: "Full name (optional)", kr: "이름 (선택)" },
  users_create: { mn: "Үүсгэх", en: "Create", kr: "생성" },
  users_role: { mn: "Role", en: "Role", kr: "역할" },
  users_2fa: { mn: "2FA", en: "2FA", kr: "2FA" },
  users_created: { mn: "Үүсгэсэн", en: "Created", kr: "생성됨" },
  users_actions: { mn: "Үйлдэл", en: "Actions", kr: "작업" },
  users_self: { mn: "(та)", en: "(you)", kr: "(나)" },

  // ── Playback ──
  playback_title: { mn: "Бичлэг тоглуулах", en: "Playback", kr: "재생" },
  playback_subtitle: { mn: "Бичлэгүүдийн жагсаалт", en: "Recording list", kr: "녹화 목록" },
  playback_back: { mn: "← Буцах", en: "← Back", kr: "← 뒤로" },
  playback_no_recording: { mn: "Бичлэг олдсонгүй", en: "Recording not found", kr: "녹화를 찾을 수 없습니다" },
  rec_info: { mn: "Бичлэгийн мэдээлэл", en: "Recording info", kr: "녹화 정보" },
  rec_started: { mn: "Эхэлсэн", en: "Started", kr: "시작" },
  rec_duration: { mn: "Үргэлжлэх", en: "Duration", kr: "길이" },
  rec_camera: { mn: "Камер", en: "Camera", kr: "카메라" },
  rec_encrypted: { mn: "Encrypted", en: "Encrypted", kr: "암호화" },
  rec_encrypted_yes: { mn: "Тийм (Storage RLS)", en: "Yes (Storage RLS)", kr: "예 (Storage RLS)" },
  rec_encrypted_no: { mn: "Үгүй", en: "No", kr: "아니오" },
  rec_original: { mn: "Original", en: "Original", kr: "원본" },
  rec_original_kept: { mn: "Хадгалагдсан · Reveal боломжтой", en: "Kept · Reveal possible", kr: "보존됨 · 공개 가능" },
  rec_original_missing: { mn: "Алга — reveal боломжгүй", en: "Missing — reveal not possible", kr: "없음 — 공개 불가" },
  detected_faces_count: { mn: "Илрүүлсэн нүүр", en: "Detected faces", kr: "감지된 얼굴" },
  detected_faces_empty: {
    mn: "Энэ бичлэгт нүүр илрүүлэгдээгүй байна.",
    en: "No faces detected in this recording.",
    kr: "이 녹화에서 얼굴이 감지되지 않았습니다.",
  },
  detected_faces_hint: {
    mn: "(Шинэ recording-ууд автоматаар bbox-той хадгалагдана)",
    en: "(New recordings store bboxes automatically)",
    kr: "(새 녹화는 자동으로 bbox를 저장합니다)",
  },
  admin_only_label: { mn: "Admin-only", en: "Admin-only", kr: "관리자 전용" },
  face_data_admin_only: {
    mn: "Нүүр илрүүлэлтийн жагсаалт, bbox координат, илэрсэн цаг гэх мэт мэдрэмтгий өгөгдөл нь зөвхөн Admin эрхтэй хэрэглэгчид харагдана.",
    en: "Face detection metadata (bbox coordinates, timestamps) is visible to Admins only.",
    kr: "얼굴 감지 메타데이터 (bbox 좌표, 시간)는 관리자에게만 표시됩니다.",
  },
  privacy_design_note: {
    mn: "Privacy-preserving design — Viewer role-д зөвхөн mask хийгдсэн бичлэгийг тоглуулна.",
    en: "Privacy-preserving design — Viewer role only sees the masked recording.",
    kr: "프라이버시 보호 설계 — Viewer는 마스킹된 녹화만 재생합니다.",
  },
  reveal_not_possible: {
    mn: "Энэ бичлэгт original хадгалагдаагүй учир Reveal боломжгүй.",
    en: "This recording has no original; reveal is not possible.",
    kr: "이 녹화는 원본이 없어 공개할 수 없습니다.",
  },

  // ── Settings ──
  settings_title: { mn: "Тохиргоо", en: "Settings", kr: "설정" },
  settings_subtitle: { mn: "Аюулгүй байдал ба хувийн тохиргоо", en: "Security & personal preferences", kr: "보안 및 개인 설정" },
  force_totp_title: { mn: "⚠ TOTP 2-Factor Authentication заавал тохируулна уу", en: "⚠ Please set up TOTP 2FA", kr: "⚠ TOTP 2단계 인증을 설정하세요" },
  force_totp_text: {
    mn: "Admin role-той бол TOTP идэвхжүүлэх хүртэл бусад хуудаст хандах боломжгүй. Доорх QR-ыг scan хийгээд 6-digit код оруулна уу.",
    en: "Admins cannot use other pages until TOTP is enabled. Scan the QR below and enter the 6-digit code.",
    kr: "TOTP를 활성화할 때까지 다른 페이지를 사용할 수 없습니다. 아래 QR을 스캔하고 6자리 코드를 입력하세요.",
  },
  my_data_title: { mn: "Миний өгөгдөл — GDPR / PIPA", en: "My data — GDPR / PIPA", kr: "내 데이터 — GDPR / PIPA" },
  my_data_text: {
    mn: "Систем дотор танаас цуглуулсан өгөгдлийг ZIP-аар татах эсвэл хүсэлт гаргаж бүртгэлээ устгах боломжтой.",
    en: "Download a ZIP of the data we hold about you, or request account deletion.",
    kr: "당사가 보관 중인 본인의 데이터를 ZIP으로 다운로드하거나 계정 삭제를 요청할 수 있습니다.",
  },
  my_data_download: { mn: "📦 Өгөгдлөө татах (ZIP)", en: "📦 Download my data (ZIP)", kr: "📦 데이터 다운로드 (ZIP)" },
  my_data_erase: { mn: "🗑️ Бүртгэлээ устгах", en: "🗑️ Erase account", kr: "🗑️ 계정 삭제" },

  // ── Common search columns / labels used across pages ──
  col_when: { mn: "Хэзээ", en: "When", kr: "시간" },
  col_status: { mn: "Status", en: "Status", kr: "상태" },
  col_camera: { mn: "Камер", en: "Camera", kr: "카메라" },
  col_suspect: { mn: "Сэжигтэн", en: "Suspect", kr: "용의자" },
  col_similarity: { mn: "Тааралцал", en: "Similarity", kr: "유사도" },
  col_actions: { mn: "Үйлдэл", en: "Actions", kr: "작업" },
  col_total: { mn: "Нийт", en: "Total", kr: "전체" },
  open_menu: { mn: "Цэс нээх", en: "Open menu", kr: "메뉴 열기" },
  close_menu: { mn: "Цэс хаах", en: "Close menu", kr: "메뉴 닫기" },

  // ── Backup page ──
  nav_backup: { mn: "Backup", en: "Backup", kr: "백업" },
  backup_title: { mn: "Нөөцлөх ба сэргээх", en: "Backup & Restore", kr: "백업 및 복원" },
  backup_subtitle: {
    mn: "DB rows + storage manifest ZIP-аар татах. Admin-only.",
    en: "Download DB rows + storage manifest as ZIP. Admin-only.",
    kr: "DB rows + 스토리지 매니페스트 ZIP 다운로드. 관리자 전용.",
  },
  backup_download: { mn: "Backup татах (ZIP)", en: "Download backup (ZIP)", kr: "백업 다운로드 (ZIP)" },
  backup_warning: {
    mn: "⚠ Browser-оос татах ZIP-д blob bytes орохгүй. Доорх бүрэн recovery ажиллагаа Storage файлуудыг тусдаа шифрлэсэн bundle-д хуулна.",
    en: "⚠ The browser ZIP does not contain blob bytes. The full recovery procedure below mirrors Storage files into a separately encrypted bundle.",
    kr: "⚠ 브라우저 ZIP에는 blob 바이트가 없습니다. 아래의 전체 복구 절차는 Storage 파일을 별도의 암호화된 번들로 복사합니다.",
  },
  backup_recovery_title: {
    mn: "Бүрэн disaster recovery",
    en: "Complete disaster recovery",
    kr: "전체 재해 복구",
  },
  backup_recovery_body: {
    mn: "DB өгөгдөл болон бүх Storage файл recovery bundle дотроо давхар шифрлэгдэнэ. Bundle, key escrow, passphrase гурвыг тусдаа байршилд хадгална.",
    en: "Database data and every Storage file are independently encrypted inside the recovery bundle. Store the bundle, key escrow and passphrase in three separate locations.",
    kr: "DB 데이터와 모든 Storage 파일은 복구 번들 안에서 별도로 암호화됩니다. 번들, 키 에스크로, 암호를 서로 다른 세 곳에 보관하세요.",
  },
  backup_recovery_export: {
    mn: "TOTP дахин баталгаажуулж, biometric embedding-тэй ZIP татна.",
    en: "Re-verify with TOTP and download a ZIP with biometric embeddings.",
    kr: "TOTP로 재인증한 후 생체 임베딩이 포함된 ZIP을 다운로드합니다.",
  },
  backup_recovery_separate: {
    mn: "Операторын recovery ажиллагаа DB ба Storage файлуудыг шифрлэж, тайлах түлхүүрүүдийг passphrase хамгаалалттай тусдаа escrow болгоно.",
    en: "The operator recovery procedure encrypts DB and Storage files and creates a separate passphrase-protected escrow for decrypt keys.",
    kr: "운영자 복구 절차는 DB와 Storage 파일을 암호화하고 복호화 키용 별도 암호 보호 에스크로를 생성합니다.",
  },
  backup_recovery_verify: {
    mn: "Сэргээх ажиллагаа эх source-оос өөр project шаардаж, бичихээс өмнө checksum ба decrypt-ийг, дараа нь row/object бүрийг шалган audit-д бүртгэнэ.",
    en: "Restore requires a project different from the source, checks checksums and decryption before writing, then verifies every row and object and records the drill in the audit log.",
    kr: "복원은 원본과 다른 프로젝트만 허용하며 쓰기 전 체크섬과 복호화를 확인한 뒤 모든 행과 객체를 검증하고 감사 로그에 기록합니다.",
  },

  // ── Live RTC ──
  nav_live_rtc: { mn: "Live (WebRTC)", en: "Live (WebRTC)", kr: "라이브 (WebRTC)" },
  live_rtc_title: { mn: "Live WebRTC", en: "Live WebRTC", kr: "라이브 WebRTC" },
  live_rtc_subtitle: {
    mn: "Camera → Publisher → Subscriber sub-100ms loopback. HLS-аас 30-50× бага latency.",
    en: "Camera → Publisher → Subscriber sub-100ms loopback. 30-50× lower latency than HLS.",
    kr: "카메라 → 게시자 → 구독자 sub-100ms 루프백. HLS보다 30-50배 낮은 지연 시간.",
  },
  live_rtc_status: { mn: "ICE state", en: "ICE state", kr: "ICE 상태" },
  live_rtc_latency: { mn: "RTT", en: "RTT", kr: "RTT" },
  live_rtc_jitter: { mn: "Jitter", en: "Jitter", kr: "지터" },
  live_rtc_fps: { mn: "FPS", en: "FPS", kr: "FPS" },
  live_rtc_bitrate: { mn: "Bitrate", en: "Bitrate", kr: "비트레이트" },
  live_rtc_packets_lost: { mn: "Алдсан пакет", en: "Packets lost", kr: "패킷 손실" },

  // ─── UI polish (dashboard / alerts / shared) ───
  alert_history_subtitle: {
    mn: "Бүх дохиолол, шинээс хуучин руу",
    en: "All alerts, newest first",
    kr: "모든 알림, 최신순",
  },
  alerts_high: { mn: "Өндөр зэрэг", en: "High severity", kr: "높은 심각도" },
  al_last_seen: { mn: "сүүлд", en: "last seen", kr: "마지막 감지" },
  alerts_24h: { mn: "Сүүлийн 24 цаг", en: "Last 24h", kr: "지난 24시간" },
  see_all: { mn: "Бүгдийг харах", en: "See all", kr: "모두 보기" },
  system_status: { mn: "Системийн төлөв", en: "System status", kr: "시스템 상태" },
  cameras_online: { mn: "Камер онлайн", en: "Cameras online", kr: "온라인 카메라" },
  operational: { mn: "Хэвийн", en: "Operational", kr: "정상" },
  ai_card_title: { mn: "AI шинжилгээ", en: "AI Insights", kr: "AI 분석" },
  ai_card_desc: {
    mn: "Аномаль илрүүлэлт болон дохиоллын тойм байгуулна.",
    en: "Run anomaly detection and natural-language summaries on your alert stream.",
    kr: "이상 탐지 및 알림 요약을 실행합니다.",
  },
  ai_card_cta: { mn: "AI нээх", en: "Open AI", kr: "AI 열기" },

  // ─── active-learning ───
  al_suggested_thresholds: {
    mn: "Санал болгож буй threshold-ууд",
    en: "Suggested thresholds",
    kr: "추천 임계값",
  },
  refresh: { mn: "Шинэчлэх", en: "Refresh", kr: "새로고침" },
  loading_dots: { mn: "Ачаалж байна…", en: "Loading…", kr: "불러오는 중…" },
  no_suspects_yet: { mn: "Сэжигтэн байхгүй", en: "No suspects", kr: "용의자 없음" },
  no_labels: { mn: "Шошго байхгүй", en: "No labels", kr: "라벨 없음" },
  total_lower: { mn: "нийт", en: "total", kr: "총" },
  al_threshold_hint: {
    mn: "Шошголсон сэрэмжлүүлэг дээр үндэслэн F1-оптимал threshold-ыг тооцоолно. Хангалттай data (10+) хуримтлуулсны дараа алдааны түвшин буурна.",
    en: "F1-optimal threshold is computed from labeled alerts. Error rate drops after 10+ labels.",
    kr: "F1 최적 임계값은 라벨이 지정된 알림에서 계산됩니다. 10개 이상 라벨 후 오류율이 감소합니다.",
  },
  al_pending: { mn: "Хүлээгдэж буй", en: "Pending", kr: "대기 중" },
  no_alerts_yet: { mn: "Сэрэмжлүүлэг байхгүй", en: "No alerts yet", kr: "알림 없음" },
  al_label_tp_tip: { mn: "Зөв match", en: "Correct match", kr: "정확한 매치" },
  al_label_fp_tip: { mn: "Буруу match", en: "Incorrect match", kr: "잘못된 매치" },
  al_label_clear_tip: { mn: "Шошго цуцлах", en: "Clear label", kr: "라벨 지우기" },
  al_unknown_count: { mn: "тодорхойгүй", en: "unknown", kr: "불명" },

  // ─── alert-rules ───
  ar_empty: {
    mn: "Хараахан дүрэм байхгүй. Дээрх формоор үүсгэнэ үү.",
    en: "No rules yet. Use the form above to create one.",
    kr: "아직 규칙이 없습니다. 위 양식으로 생성하세요.",
  },
  ar_new_rule_btn: { mn: "Шинэ дүрэм", en: "New rule", kr: "새 규칙" },
  ar_added_ok: { mn: "Дүрэм нэмлээ", en: "Rule added", kr: "규칙 추가됨" },
  ar_form_title: { mn: "Шинэ alert дүрэм", en: "New alert rule", kr: "새 알림 규칙" },
  ar_name_placeholder: {
    mn: "Дүрмийн нэр (жнь: 'Гол хаалга, ажлын цаг')",
    en: "Rule name (e.g. 'Main entrance, business hours')",
    kr: "규칙 이름 (예: '정문, 영업시간')",
  },
  ar_active: { mn: "Идэвхтэй", en: "Active", kr: "활성" },
  ar_suspect_label: {
    mn: "Сэжигтэн (хоосон = бүгд)",
    en: "Suspect (blank = all)",
    kr: "용의자 (비어두면 = 전체)",
  },
  ar_all_suspects: { mn: "— Бүх сэжигтэн —", en: "— All suspects —", kr: "— 모든 용의자 —" },
  ar_camera_label: {
    mn: "Камер (хоосон = бүгд)",
    en: "Camera (blank = all)",
    kr: "카메라 (비어두면 = 전체)",
  },
  ar_all_cameras: { mn: "— Бүх камер —", en: "— All cameras —", kr: "— 모든 카메라 —" },
  ar_min_sim: { mn: "Min similarity", en: "Min similarity", kr: "최소 유사도" },
  ar_dedup_win: {
    mn: "Dedup цонх (сек)",
    en: "Dedup window (sec)",
    kr: "중복 제거 창 (초)",
  },
  ar_burst_count: {
    mn: "Burst min (хэдэн ширхэг)",
    en: "Burst min (count)",
    kr: "버스트 최소 (개수)",
  },
  ar_burst_win: {
    mn: "Burst цонх (сек)",
    en: "Burst window (sec)",
    kr: "버스트 창 (초)",
  },
  ar_quiet_from: {
    mn: "Чимээгүй эхлэх (KST)",
    en: "Quiet start (KST)",
    kr: "정숙 시작 (KST)",
  },
  ar_quiet_to: {
    mn: "Чимээгүй дуусах (KST)",
    en: "Quiet end (KST)",
    kr: "정숙 종료 (KST)",
  },
  create_btn: { mn: "Үүсгэх", en: "Create", kr: "생성" },
  cancel_btn: { mn: "Цуцлах", en: "Cancel", kr: "취소" },
  col_name: { mn: "Нэр", en: "Name", kr: "이름" },
  col_scope: { mn: "Хамрах хүрээ", en: "Scope", kr: "범위" },
  col_quiet: { mn: "Чимээгүй", en: "Quiet", kr: "정숙" },
  col_action: { mn: "Үйлдэл", en: "Action", kr: "작업" },
  scope_suspect: { mn: "Сэжигтэн", en: "Suspect", kr: "용의자" },
  scope_camera: { mn: "Камер", en: "Camera", kr: "카메라" },
  any_lower: { mn: "бүгд", en: "any", kr: "전체" },
  off_lower: { mn: "идэвхгүй", en: "off", kr: "비활성" },
  delete_btn: { mn: "Устгах", en: "Delete", kr: "삭제" },
  delete_confirm: {
    mn: "Энэ дүрмийг устгах уу?",
    en: "Delete this rule?",
    kr: "이 규칙을 삭제하시겠습니까?",
  },

  // ─── alerts-live ───
  al_live_chart_title: {
    mn: "Сүүлийн 60 минут — 5 минут тутам",
    en: "Last 60 minutes — every 5 min",
    kr: "지난 60분 — 5분 간격",
  },
  no_activity: { mn: "Идэвхгүй", en: "No activity", kr: "활동 없음" },
  al_live_empty: {
    mn: "Alert байхгүй. Шинэ alert үүсэхэд автоматаар нэмэгдэнэ.",
    en: "No alerts. New alerts will appear automatically.",
    kr: "알림 없음. 새 알림이 자동으로 표시됩니다.",
  },

  // ─── live (camera) ───
  live_mode_device: {
    mn: "Тухайн төхөөрөмж",
    en: "This device",
    kr: "이 기기",
  },
  live_mode_phone: { mn: "Гар утас", en: "Phone", kr: "휴대폰" },
  live_mode_file: {
    mn: "Файл upload",
    en: "File upload",
    kr: "파일 업로드",
  },
  file_upload_title: {
    mn: "MP4 / WebM upload",
    en: "MP4 / WebM upload",
    kr: "MP4 / WebM 업로드",
  },
  file_upload_desc: {
    mn: "100 MB хүртэлх өмнө бичсэн видеог сонгож upload хийнэ. 3 MB хэсгүүд хүсэлтийн хэмжээний лимитийг тойрох боловч файлын нийт лимитийг нэмэхгүй. Server ML processing автоматаар эхэлнэ — Cubist mosaic blur + ArcFace embedding + AES-256-GCM encryption.",
    en: "Select a previously recorded video up to 100 MB. The 3 MB chunks avoid per-request size limits but do not increase the total file limit. Server ML processing starts automatically — Cubist mosaic blur + ArcFace embedding + AES-256-GCM encryption.",
    kr: "100 MB 이하의 녹화 영상을 선택하세요. 3 MB 청크는 요청별 크기 제한을 피하지만 전체 파일 제한을 늘리지는 않습니다. 서버 ML 처리가 자동으로 시작됩니다 — 큐비스트 모자이크 블러 + ArcFace 임베딩 + AES-256-GCM 암호화.",
  },
  file_upload_pick: {
    mn: "Файл сонгох (MP4 / WebM / MOV)",
    en: "Pick a file (MP4 / WebM / MOV)",
    kr: "파일 선택 (MP4 / WebM / MOV)",
  },
  file_upload_btn: {
    mn: "Байршуулах + ML боловсруулалт",
    en: "Upload + ML process",
    kr: "업로드 + ML 처리",
  },
  live_perm_error: {
    mn: "Камер хандах эрх олгогдсонгүй",
    en: "Camera permission denied",
    kr: "카메라 권한이 거부됨",
  },
  live_press_start: {
    mn: '"Эхлүүлэх" товчийг дар',
    en: 'Press "Start"',
    kr: '"시작" 버튼을 누르세요',
  },
  live_select_cam: { mn: "Камер сонгох", en: "Select camera", kr: "카메라 선택" },
  live_no_devices: { mn: "— Илрээгүй —", en: "— None found —", kr: "— 없음 —" },
  live_camera_off_btn: {
    mn: "Камер унтраах",
    en: "Stop camera",
    kr: "카메라 끄기",
  },
  live_start_btn: { mn: "Эхлүүлэх", en: "Start", kr: "시작" },
  live_rec_start_btn: {
    mn: "Бичлэг эхлүүлэх",
    en: "Start recording",
    kr: "녹화 시작",
  },
  live_rec_stop_btn: {
    mn: "Бичлэг зогсоох",
    en: "Stop recording",
    kr: "녹화 정지",
  },
  live_processing: {
    mn: "Боловсруулж байна…",
    en: "Processing…",
    kr: "처리 중…",
  },
  live_keep_page: {
    mn: "Хуудсыг хаахгүй.",
    en: "Keep this page open.",
    kr: "페이지를 닫지 마세요.",
  },
  live_view_playback: {
    mn: "Playback хуудаст харах →",
    en: "View on Playback page →",
    kr: "재생 페이지에서 보기 →",
  },
  faces_count_label: { mn: "нүүр", en: "faces", kr: "얼굴" },
  live_processing_hint: {
    mn: "Face detection (InsightFace), mosaic anonymization, AES-256 encrypt — бичлэгийн уртаас хамаарч ~30-90 секунд хүлээгээрэй.",
    en: "Face detection (InsightFace), mosaic anonymization, AES-256 encrypt — wait ~30-90 seconds depending on length.",
    kr: "얼굴 감지 (InsightFace), 모자이크 익명화, AES-256 암호화 — 길이에 따라 ~30-90초 대기.",
  },
  live_recording_hint: {
    mn: "Бичлэг 100 MB хүртэл. Face detection, mosaic, encrypted original бүгд автомат — multi-ID reveal боломжтой.",
    en: "Recordings up to 100 MB. Face detection, mosaic, encrypted original all automatic — multi-ID reveal supported.",
    kr: "녹화는 100 MB 이하입니다. 얼굴 감지, 모자이크, 암호화된 원본 모두 자동 — 다중 ID 공개 지원.",
  },
  live_cctv_press_start: {
    mn: 'Камер сонгож "Эхлүүлэх" дар',
    en: 'Select a camera and press "Start"',
    kr: '카메라를 선택하고 "시작"을 누르세요',
  },
  live_cctv_hint: {
    mn: "(RTSP → HLS — Python ML service шаардана)",
    en: "(RTSP → HLS — Python ML service required)",
    kr: "(RTSP → HLS — Python ML 서비스 필요)",
  },
  live_registered_cctv: {
    mn: "Бүртгэлтэй CCTV",
    en: "Registered CCTV",
    kr: "등록된 CCTV",
  },
  manage_btn: { mn: "Удирдах →", en: "Manage →", kr: "관리 →" },
  live_no_cameras_msg: {
    mn: "Камер бүртгэгдээгүй.",
    en: "No cameras registered.",
    kr: "등록된 카메라가 없습니다.",
  },
  live_manage_cameras_link: {
    mn: '"Камер удирдах"',
    en: '"Manage cameras"',
    kr: '"카메라 관리"',
  },
  live_add_from_page: {
    mn: "хуудаснаас нэмнэ үү.",
    en: "page to add one.",
    kr: "페이지에서 추가하세요.",
  },
  live_phone_press_connect: {
    mn: 'URL оруулаад "Холбогдох" дар',
    en: 'Enter URL and press "Connect"',
    kr: 'URL을 입력하고 "연결"을 누르세요',
  },
  live_stream_type: {
    mn: "Stream төрөл",
    en: "Stream type",
    kr: "스트림 유형",
  },
  live_phone_url: {
    mn: "Утасны Stream URL",
    en: "Phone stream URL",
    kr: "휴대폰 스트림 URL",
  },
  live_disconnect_btn: { mn: "Тасрах", en: "Disconnect", kr: "연결 해제" },
  live_connect_btn: { mn: "Холбогдох", en: "Connect", kr: "연결" },
  live_phone_hint_title: {
    mn: "💡 Утасны IP Webcam яаж тохируулах вэ?",
    en: "💡 How to set up phone IP Webcam?",
    kr: "💡 휴대폰 IP 웹캠을 어떻게 설정하나요?",
  },
  live_camera_not_opened: {
    mn: "Камер нээгдсэнгүй",
    en: "Camera could not open",
    kr: "카메라를 열 수 없습니다",
  },
  live_ml_unreachable: {
    mn: "Python ML service хариулсангүй. ml-service folder-аас `uvicorn main:app --port 8000` ажиллуулна уу.",
    en: "Python ML service unreachable. Run `uvicorn main:app --port 8000` from the ml-service folder.",
    kr: "Python ML 서비스에 연결할 수 없습니다. ml-service 폴더에서 `uvicorn main:app --port 8000`를 실행하세요.",
  },

  // ─── users page + TOTP step-up prompt ───
  users_new_btn: { mn: "Шинэ хэрэглэгч", en: "New user", kr: "새 사용자" },
  users_created_ok: {
    mn: "Амжилттай үүсгэлээ",
    en: "User created",
    kr: "사용자 생성됨",
  },
  users_new_form_title: {
    mn: "Шинэ хэрэглэгч үүсгэх",
    en: "Create new user",
    kr: "새 사용자 만들기",
  },
  users_pwd_placeholder: {
    mn: "Нууц үг (8+ тэмдэгт)",
    en: "Password (8+ chars)",
    kr: "비밀번호 (8+ 글자)",
  },
  users_fullname_placeholder: {
    mn: "Бүтэн нэр (заавал биш)",
    en: "Full name (optional)",
    kr: "전체 이름 (선택)",
  },
  users_col_email: { mn: "Имэйл", en: "Email", kr: "이메일" },
  users_col_name: { mn: "Нэр", en: "Name", kr: "이름" },
  users_col_created: { mn: "Үүсгэсэн", en: "Created", kr: "생성됨" },
  users_self_label: { mn: "та", en: "you", kr: "본인" },
  users_pwd_reset_tip: {
    mn: "Нууц үг шинэчлэх",
    en: "Reset password",
    kr: "비밀번호 재설정",
  },
  users_new_pwd_placeholder: {
    mn: "Шинэ нууц үг (8+ тэмдэгт)",
    en: "New password (8+ chars)",
    kr: "새 비밀번호 (8+ 글자)",
  },
  users_pwd_too_short: {
    mn: "8+ тэмдэгт хэрэгтэй",
    en: "8+ characters required",
    kr: "8자 이상 필요",
  },
  users_pwd_updated: {
    mn: "Нууц үг шинэчилсэн",
    en: "Password updated",
    kr: "비밀번호 업데이트됨",
  },
  users_delete_confirm: {
    mn: "{email} — хэрэглэгчийг бүрмөсөн устгах уу? Энэ нь буцаашгүй.",
    en: "Delete {email} permanently? This cannot be undone.",
    kr: "{email}을(를) 영구적으로 삭제하시겠습니까? 되돌릴 수 없습니다.",
  },
  save_btn: { mn: "Хадгалах", en: "Save", kr: "저장" },

  // ─── TOTP step-up dialog (admin user CRUD) ───
  totp_prompt_title: {
    mn: "2FA баталгаажуулалт",
    en: "2FA verification",
    kr: "2FA 확인",
  },
  totp_prompt_desc: {
    mn: "Хэрэглэгчийн мэдээлэл өөрчлөх нь мэдрэмтгий үйлдэл — нэг удаагийн TOTP кодоо оруулна уу.",
    en: "Modifying users is a sensitive action — enter your one-time TOTP code.",
    kr: "사용자 변경은 민감한 작업입니다 — 일회용 TOTP 코드를 입력하세요.",
  },
  totp_prompt_label: {
    mn: "Authenticator app кодыг оруулна уу",
    en: "Enter the code from your authenticator app",
    kr: "Authenticator 앱의 코드를 입력하세요",
  },
  totp_prompt_verify: {
    mn: "Баталгаажуулах",
    en: "Verify",
    kr: "확인",
  },
  totp_prompt_invalid: {
    mn: "Код буруу эсвэл хугацаа дууссан",
    en: "Code is invalid or expired",
    kr: "코드가 잘못되었거나 만료되었습니다",
  },
  totp_prompt_not_enabled: {
    mn: "Энэ үйлдлийг хийхийн тулд эхлээд 2FA-г идэвхжүүлэх ёстой. Тохиргооны хуудаснаас идэвхжүүлнэ үү.",
    en: "You must enable 2FA before performing this action. Enable it in Settings.",
    kr: "이 작업을 수행하려면 먼저 2FA를 활성화해야 합니다. 설정에서 활성화하세요.",
  },
  totp_prompt_session_expired: {
    mn: "Нэвтрэлтийн хугацаа дууссан. Дахин нэвтэрч орно уу.",
    en: "Your session has expired. Please sign in again.",
    kr: "세션이 만료되었습니다. 다시 로그인하세요.",
  },
  totp_prompt_network_err: {
    mn: "Сүлжээний алдаа — дахин оролд",
    en: "Network error — please retry",
    kr: "네트워크 오류 — 다시 시도하세요",
  },
  totp_prompt_ttl_hint: {
    mn: "Амжилттай баталгаажуулсны дараа дараагийн 15 минутын турш дахин асуухгүй.",
    en: "After successful verification, you won't be asked again for the next 15 minutes.",
    kr: "성공적으로 확인되면 다음 15분 동안 다시 묻지 않습니다.",
  },

  // ─── /compare page (privacy mask algorithm comparison) ───
  compare_title: {
    mn: "Алгоритмын харьцуулалт",
    en: "Algorithm Comparison",
    kr: "알고리즘 비교",
  },
  compare_subtitle: {
    mn: "Privacy mask алгоритмууд — Cubist Mosaic, Gaussian Blur, Pixelate",
    en: "Privacy mask algorithms — Cubist Mosaic, Gaussian Blur, Pixelate",
    kr: "프라이버시 마스킹 알고리즘 — Cubist Mosaic, Gaussian Blur, Pixelate",
  },
  compare_drop_here: {
    mn: "Зураг чирж тавих эсвэл сонгох",
    en: "Drop an image here or click to choose",
    kr: "이미지를 드롭하거나 클릭하여 선택",
  },
  compare_drop_hint: {
    mn: "JPG, PNG, WebP — нүүртэй зураг хамгийн сайн",
    en: "JPG, PNG, WebP — works best with face photos",
    kr: "JPG, PNG, WebP — 얼굴 사진이 가장 좋습니다",
  },
  compare_run_btn: {
    mn: "3 алгоритмыг ажиллуулах",
    en: "Run all 3 algorithms",
    kr: "3개 알고리즘 실행",
  },
  compare_clear: { mn: "Цэвэрлэх", en: "Clear", kr: "지우기" },
  compare_original: { mn: "Эх зураг", en: "Original", kr: "원본" },
  compare_no_mask: {
    mn: "Mask хийгээгүй — танигдах боломжтой",
    en: "Not masked — identifiable",
    kr: "마스크 없음 — 식별 가능",
  },
  compare_no_result: { mn: "Үр дүн алга", en: "No result", kr: "결과 없음" },
  compare_winner: { mn: "Хамгийн сайн", en: "Best", kr: "최고" },
  compare_ssim: { mn: "SSIM", en: "SSIM", kr: "SSIM" },
  compare_obscure: {
    mn: "Далдалсан хувь",
    en: "Obscured",
    kr: "은닉률",
  },
  compare_faces_found: { mn: "Нүүр", en: "Faces", kr: "얼굴" },
  compare_ml_err: {
    mn: "ML service хариулсангүй",
    en: "ML service did not respond",
    kr: "ML 서비스가 응답하지 않습니다",
  },
  compare_empty_title: {
    mn: "Зураг сонгоод эхэл",
    en: "Choose an image to begin",
    kr: "시작하려면 이미지를 선택하세요",
  },
  compare_empty_desc: {
    mn: "Сонгосон зургийн нүүрнүүдийг 3 өөр алгоритмаар нуугаад харьцуулсан үр дүнг үзүүлнэ.",
    en: "Faces in the chosen image will be masked with three different algorithms and compared side-by-side.",
    kr: "선택한 이미지의 얼굴이 3가지 다른 알고리즘으로 마스킹되어 나란히 비교됩니다.",
  },
  compare_methodology_title: {
    mn: "Аргачлал",
    en: "Methodology",
    kr: "방법론",
  },
  compare_methodology_body: {
    mn: "SSIM (Structural Similarity Index) бага байх тусам нүүр илүү танигдахааргүй болсон гэсэн үг. Бид нэмж нь хувийн нууцлал хадгалах боловч хүний нүдэнд таатай харагдах үүднээс Voronoi Cubist Mosaic-ыг анхдагч алгоритм болгон сонгосон. Бүх mask-уудын эх бичлэг AES-256-GCM-ээр шифрлэгдэж, тусгай эрхтэй reveal flow дамжуулан л буцаагдана.",
    en: "Lower SSIM (Structural Similarity Index) = harder to recognize. We default to the Voronoi-based Cubist Mosaic because it preserves privacy while staying visually pleasant. Every masked frame is stored alongside an AES-256-GCM encrypted original, only recoverable via the authorized reveal flow.",
    kr: "SSIM(구조적 유사도 지수)가 낮을수록 얼굴을 더 알아보기 어렵습니다. 우리는 프라이버시를 보호하면서 시각적으로도 만족스러운 Voronoi 기반 Cubist Mosaic을 기본으로 사용합니다. 마스킹된 모든 프레임은 AES-256-GCM 암호화된 원본과 함께 저장되며, 권한이 부여된 reveal 흐름을 통해서만 복구할 수 있습니다.",
  },

  // ─── /demo guided walkthrough ───
  demo_title: { mn: "Capstone Demo", en: "Capstone Demo", kr: "Capstone 데모" },
  demo_subtitle: {
    mn: "Защитын танилцуулга — 6 алхамаар MONGOLZ Security-г харах",
    en: "Defense walkthrough — explore MONGOLZ Security in 6 sections",
    kr: "방어 워크스루 — 6개 섹션으로 MONGOLZ Security 탐색",
  },
  demo_section_problem: { mn: "Асуудал", en: "Problem", kr: "문제" },
  demo_section_arch: { mn: "Архитектур", en: "Architecture", kr: "아키텍처" },
  demo_section_numbers: { mn: "Тоо", en: "Numbers", kr: "수치" },
  demo_section_demos: { mn: "Шууд демо", en: "Live demos", kr: "라이브 데모" },
  demo_section_security: { mn: "Аюулгүй байдал", en: "Security stack", kr: "보안 스택" },
  demo_problem_title: {
    mn: "Хувийн нууц vs Аюулгүй байдал",
    en: "Privacy vs Security",
    kr: "프라이버시와 보안",
  },
  demo_problem_body: {
    mn: "Уламжлалт CCTV систем хэн нэгний нүүрийг бүгдийг харах боломжтой. MONGOLZ Security нь үе шаттай эрх (admin / auditor / viewer) + автомат privacy mask + аудит лог-той зарчмаар ажилладаг.",
    en: "Conventional CCTV gives any operator access to every face. MONGOLZ Security uses tiered roles (admin / auditor / viewer), automatic privacy masking on every frame, and a tamper-evident audit log.",
    kr: "기존 CCTV는 모든 운영자가 모든 얼굴에 접근할 수 있습니다. MONGOLZ Security는 계층 역할(admin / auditor / viewer), 모든 프레임의 자동 프라이버시 마스킹, 변조 방지 감사 로그를 사용합니다.",
  },
  demo_problem_tile_a_title: {
    mn: "Уламжлалт CCTV",
    en: "Conventional CCTV",
    kr: "기존 CCTV",
  },
  demo_problem_tile_a_body: {
    mn: "Бүх нүүр бүхэн нь хадгалагдаж, аливаа оператор шууд харах эрхтэй. Privacy regulation-уудтай зөрчилддөг.",
    en: "Every face is stored unmasked, any operator can view directly. Conflicts with privacy regulations.",
    kr: "모든 얼굴이 마스크 없이 저장되며 운영자가 직접 볼 수 있습니다. 프라이버시 규정과 충돌합니다.",
  },
  demo_problem_tile_b_title: {
    mn: "MONGOLZ Security",
    en: "MONGOLZ Security",
    kr: "MONGOLZ Security",
  },
  demo_problem_tile_b_body: {
    mn: "Бичлэг хийгдмэгц нүүр бүр Cubist Mosaic-аар автоматаар нуугдаж, эх хувь нь AES-256-GCM-ээр шифрлэгдэн архивлагдана. 4-eyes approval-той reveal flow л буцаах боломжтой.",
    en: "Every face is masked with Cubist Mosaic on capture; the original is encrypted with AES-256-GCM. Only the 4-eyes approval reveal flow can unwrap it.",
    kr: "캡처 시 모든 얼굴이 Cubist Mosaic으로 마스킹되며, 원본은 AES-256-GCM으로 암호화됩니다. 4-eyes 승인 reveal 흐름만 원본을 복원할 수 있습니다.",
  },
  demo_arch_title: {
    mn: "4 давхаргат архитектур",
    en: "4-tier architecture",
    kr: "4계층 아키텍처",
  },
  demo_arch_body: {
    mn: "ML сервис, өгөгдлийн сан, веб давхарга бүгд Сингапурт ажилладаг тул бичлэгийг хадгалсан бүс дотор нь тайлж боловсруулдаг.",
    en: "The ML service, database and web tier all run in Singapore, so recordings are decrypted and processed in the region where they are stored.",
    kr: "ML 서비스, 데이터베이스, 웹 계층이 모두 싱가포르에서 실행되어 녹화는 저장된 지역 안에서 복호화·처리됩니다.",
  },
  demo_arch_n_camera: { mn: "Камер", en: "Camera", kr: "카메라" },
  demo_numbers_title: {
    mn: "Production-д бодит тоо",
    en: "Live production numbers",
    kr: "실시간 운영 수치",
  },
  demo_numbers_body: {
    mn: "Энэ хүснэгт нь жинхэнэ Supabase database-аас real-time татаж байгаа.",
    en: "These figures are pulled live from the production Supabase database.",
    kr: "이 수치는 운영 Supabase 데이터베이스에서 실시간으로 가져옵니다.",
  },
  demo_demos_title: {
    mn: "Шууд туршаад үзээрэй",
    en: "Try it live",
    kr: "라이브로 시도해보세요",
  },
  demo_demos_body: {
    mn: "Defense panel-д шууд click хийгээд жинхэнэ систем дээр демо хийх боломжтой.",
    en: "Click any card to demo the live system directly from the panel.",
    kr: "카드를 클릭하면 패널에서 라이브 시스템을 바로 시연할 수 있습니다.",
  },
  demo_demos_open: { mn: "Нээх", en: "Open", kr: "열기" },
  demo_demos_live_body: {
    mn: "Browser webcam-аас бичлэг хийгээд automatic face mosaic, encrypted storage, reveal flow-г бүгдийг харна.",
    en: "Record from your webcam to see automatic face mosaic, encrypted storage, and the reveal flow end-to-end.",
    kr: "웹캠에서 녹화하여 자동 얼굴 모자이크, 암호화 저장, reveal 흐름을 끝까지 확인하세요.",
  },
  demo_demos_compare_body: {
    mn: "3 algorithm-ийг ижил зураг дээр зэрэг ажиллуулж SSIM-аар харьцуулна.",
    en: "Run all 3 masking algorithms on the same image side-by-side with SSIM scoring.",
    kr: "같은 이미지에 3가지 마스킹 알고리즘을 나란히 실행하고 SSIM 점수를 비교합니다.",
  },
  demo_demos_ai_body: {
    mn: "Claude Sonnet-аар alert pattern-ийг анализ хийгээд аномалийг автомат олно.",
    en: "Claude Sonnet analyzes alert patterns and surfaces anomalies in plain English.",
    kr: "Claude Sonnet이 알림 패턴을 분석하고 이상 징후를 자연어로 제공합니다.",
  },
  demo_sec_title: {
    mn: "15 давхаргат хамгаалалт",
    en: "15-layer defense in depth",
    kr: "15계층 심층 방어",
  },
  demo_sec_body: {
    mn: "Аливаа нэг давхарга зөрчигдсөн ч хүний нэр устгагдахгүй, бүх үйлдэл аудитад үлдэнэ.",
    en: "Any single layer breach is contained: identities stay masked, every action is auditable.",
    kr: "단일 계층이 침해되더라도 신원이 노출되지 않고 모든 작업이 감사됩니다.",
  },
  demo_sec_totp: {
    mn: "TOTP 2FA admin үйлдэлд шаардлагатай",
    en: "TOTP 2FA required for admin actions",
    kr: "관리자 작업에 TOTP 2FA 필수",
  },
  demo_sec_rls: {
    mn: "PostgreSQL RLS — бүх хүснэгтэд",
    en: "PostgreSQL RLS on every table",
    kr: "모든 테이블에 PostgreSQL RLS",
  },
  demo_sec_aes: {
    mn: "AES-256-GCM-ээр шифрлэгдсэн бичлэг",
    en: "AES-256-GCM encrypted recordings",
    kr: "AES-256-GCM 암호화된 녹화",
  },
  demo_sec_audit: {
    mn: "Hash-chain аудит лог",
    en: "Hash-chain audit log",
    kr: "해시 체인 감사 로그",
  },
  demo_sec_4eyes: {
    mn: "4-eyes approval reveal-д",
    en: "4-eyes approval on reveal",
    kr: "reveal 시 4-eyes 승인",
  },
  demo_sec_roles: {
    mn: "Admin / Auditor / Viewer эрх",
    en: "Admin / Auditor / Viewer roles",
    kr: "Admin / Auditor / Viewer 역할",
  },
  demo_cta_title: {
    mn: "Хамгийн их харагдах demo",
    en: "Most impactful demo",
    kr: "가장 인상적인 데모",
  },
  demo_cta_body: {
    mn: "Хэрэв 1 минутын дотор үзүүлэх ёстой бол /compare хуудсан дээр жинхэнэ нүүртэй зураг upload хийгээд 3 алгоритм-ийг ажиллуулна — visual + SSIM хоёулаа үзүүлэгдэнэ.",
    en: "If you have only 1 minute, run /compare with a real face photo — visual + SSIM metrics land together for maximum impact.",
    kr: "1분만 있다면 /compare에서 실제 얼굴 사진으로 실행하세요 — 시각적 결과와 SSIM 지표가 함께 표시되어 최대 효과를 냅니다.",
  },

  // ─── sidebar nav additions ───
  nav_demo: { mn: "Демо", en: "Demo", kr: "데모" },
  nav_compare: { mn: "Харьцуулалт", en: "Compare", kr: "비교" },
  nav_ml_lab: { mn: "ML лаб", en: "ML Lab", kr: "ML 실험실" },

  // ─── ML Lab ───
  ml_lab_title: { mn: "ML лаб", en: "ML Lab", kr: "ML 실험실" },
  ml_lab_subtitle: {
    mn: "Anti-spoof + multi-frame embedding fusion",
    en: "Anti-spoof + multi-frame embedding fusion",
    kr: "Anti-spoof + 다중 프레임 임베딩 융합",
  },
  ml_lab_tab_antispoof: { mn: "Anti-spoof", en: "Anti-spoof", kr: "Anti-spoof" },
  ml_lab_tab_fusion: { mn: "Embedding fusion", en: "Embedding fusion", kr: "임베딩 융합" },
  ml_lab_drop: { mn: "Нүүртэй зураг тавь", en: "Drop a face image", kr: "얼굴 이미지를 넣으세요" },
  ml_lab_drop_hint: {
    mn: "Бид InsightFace-аар нүүрийн bbox crop хийгээд liveness-ыг тооцоолно.",
    en: "We crop the bbox via InsightFace and score liveness.",
    kr: "InsightFace로 bbox를 자르고 라이브니스를 점수화합니다.",
  },
  ml_lab_run_antispoof: { mn: "Anti-spoof ажиллуулах", en: "Run anti-spoof", kr: "Anti-spoof 실행" },
  ml_lab_no_result: {
    mn: "Үр дүн алга",
    en: "No result yet",
    kr: "결과 없음",
  },
  ml_lab_no_result_desc: {
    mn: "Зураг сонгоод 'Anti-spoof ажиллуулах' дар.",
    en: "Pick an image and click 'Run anti-spoof'.",
    kr: "이미지를 선택하고 'Run anti-spoof'를 클릭하세요.",
  },
  ml_lab_verdict_live: { mn: "Амьд нүүр (live)", en: "Live face", kr: "실제 얼굴" },
  ml_lab_verdict_spoof: { mn: "Хуурамч (spoof)", en: "Spoof detected", kr: "스푸핑 감지됨" },
  ml_lab_spoof_score: { mn: "Spoof score", en: "Spoof score", kr: "스푸핑 점수" },
  ml_lab_laplacian: { mn: "Laplacian variance", en: "Laplacian variance", kr: "라플라시안 분산" },
  ml_lab_laplacian_hint: {
    mn: "Текстур нарийвчлал — хэвлэмэл зураг бага variance-тай.",
    en: "Texture detail — printed photos have low variance.",
    kr: "텍스처 세부 — 인쇄된 사진은 분산이 낮습니다.",
  },
  ml_lab_color: { mn: "HSV color variance", en: "HSV color variance", kr: "HSV 색상 분산" },
  ml_lab_color_hint: {
    mn: "Дэлгэцийн moiré + color cast илрүүлдэг.",
    en: "Detects screen moiré + color cast.",
    kr: "화면 모아레와 색 캐스트를 감지합니다.",
  },
  ml_lab_frequency: { mn: "FFT high-frequency", en: "FFT high-frequency", kr: "FFT 고주파" },
  ml_lab_frequency_hint: {
    mn: "Хэвлэмэл цаас high-spatial-freq-г жигдрүүлдэг.",
    en: "Photo paper smooths high spatial frequencies.",
    kr: "인쇄지가 고공간 주파수를 부드럽게 합니다.",
  },
  ml_lab_fusion_sim_title: { mn: "Frame fusion simulator", en: "Frame fusion simulator", kr: "프레임 융합 시뮬레이터" },
  ml_lab_fusion_sim_desc: {
    mn: "Синтетик ArcFace embedding-ийг noise-той үүсгээд multi-frame fusion-ийг туршина.",
    en: "Generates synthetic ArcFace embeddings with noise to test multi-frame fusion.",
    kr: "노이즈가 있는 합성 ArcFace 임베딩을 생성하여 다중 프레임 융합을 테스트합니다.",
  },
  ml_lab_frame_count: { mn: "Frame count", en: "Frame count", kr: "프레임 수" },
  ml_lab_noise: { mn: "Noise", en: "Noise", kr: "노이즈" },
  ml_lab_noise_hint: {
    mn: "0 = perfect frames, 0.5 = blurry / motion / occluded.",
    en: "0 = perfect frames, 0.5 = blurry / motion / occluded.",
    kr: "0 = 완벽한 프레임, 0.5 = 흐림 / 움직임 / 가림.",
  },
  ml_lab_strategy: { mn: "Fusion strategy", en: "Fusion strategy", kr: "융합 전략" },
  ml_lab_run_fusion: { mn: "Fusion ажиллуулах", en: "Run fusion", kr: "융합 실행" },
  ml_lab_fusion_no_result: {
    mn: "Үр дүн алга — 'Fusion ажиллуулах' дар.",
    en: "No result yet — click 'Run fusion'.",
    kr: "결과 없음 — 'Run fusion'을 클릭하세요.",
  },
  ml_lab_similarity_to_first: {
    mn: "Эхний frame-тэй similarity",
    en: "Similarity to first frame",
    kr: "첫 프레임과의 유사도",
  },
  ml_lab_similarity_hint: {
    mn: "1.0-д ойртох тусам fusion нь noise-ыг арилгасан гэсэн үг.",
    en: "Closer to 1.0 = fusion has cleaned up the noise.",
    kr: "1.0에 가까울수록 융합이 노이즈를 제거함.",
  },
  ml_lab_frames_used: { mn: "Frame ашигласан", en: "Frames used", kr: "사용된 프레임" },
  ml_lab_embedding_dim: { mn: "Embedding dim", en: "Embedding dim", kr: "임베딩 차원" },
  ml_lab_resimulate: { mn: "Дахин simulate", en: "Re-simulate", kr: "재시뮬레이션" },

  // ─── /analytics enhancements ───
  analytics_subtitle: {
    mn: "Сүүлийн 7 хоногийн KPI + урт хугацааны тренд",
    en: "Last 7 days KPIs + long-range trends",
    kr: "지난 7일 KPI + 장기 추세",
  },
  analytics_kpi_faces_7d: {
    mn: "7 хоногт илэрсэн нүүр",
    en: "Faces (7d)",
    kr: "얼굴 (7일)",
  },
  analytics_kpi_alerts_7d: {
    mn: "7 хоногийн alert",
    en: "Alerts (7d)",
    kr: "알림 (7일)",
  },
  analytics_kpi_recordings_7d: {
    mn: "7 хоногийн бичлэг",
    en: "Recordings (7d)",
    kr: "녹화 (7일)",
  },
  analytics_kpi_high_severity: {
    mn: "Өндөр зэрэг",
    en: "High severity",
    kr: "높은 심각도",
  },
  alerts_high_med: { mn: "дунд", en: "med", kr: "중간" },
  alerts_high_low: { mn: "бага", en: "low", kr: "낮음" },
  analytics_empty_desc: {
    mn: "Мэдээлэл цуглуулсны дараа график автомат гарч ирнэ.",
    en: "Charts will appear once data is collected.",
    kr: "데이터가 수집되면 차트가 표시됩니다.",
  },

  // ─── auto-tune (active learning Apply button) ───
  autotune_apply: { mn: "Apply", en: "Apply", kr: "적용" },
  autotune_busy: { mn: "Хадгалж байна", en: "Saving", kr: "저장 중" },
  autotune_applied: { mn: "Хадгалсан", en: "Saved", kr: "저장됨" },
  autotune_error: { mn: "Алдаа", en: "Error", kr: "오류" },

  // ─── dashboard system status row labels ───
  status_db_connected: { mn: "Холбогдсон", en: "Connected", kr: "연결됨" },

  // ─── ai-chat empty state ───
  ai_empty_chat_hint: {
    mn: "Доор асуулт бичээд эхэл",
    en: "Type a question below to start.",
    kr: "아래에 질문을 입력하여 시작하세요.",
  },
  ai_empty_run_hint: {
    mn: "Доорх товчийг дарж эхэл",
    en: "Click the button below to generate.",
    kr: "아래 버튼을 클릭하여 생성하세요.",
  },

  // ─── /compare additional ───
  compare_ssim_hint: { mn: "бага=сайн", en: "lower=better", kr: "낮을수록 좋음" },

  // ─── command palette (⌘K) ───
  cmdk_title: { mn: "Команд хайх", en: "Command palette", kr: "명령 팔레트" },
  cmdk_placeholder: {
    mn: "Хайх… (нэр, замаар)",
    en: "Search routes…",
    kr: "경로 검색…",
  },
  cmdk_empty: {
    mn: "Илрэц олдсонгүй",
    en: "No matches",
    kr: "일치 없음",
  },
  cmdk_navigate: { mn: "сонгох", en: "navigate", kr: "탐색" },
  cmdk_open: { mn: "нээх", en: "open", kr: "열기" },
  cmdk_toggle: { mn: "нээх / хаах", en: "toggle", kr: "토글" },

  // ─── public landing (home) ───
  home_pill: {
    mn: "2026-01-CD-03-07",
    en: "2026-01-CD-03-07",
    kr: "2026-01-CD-03-07",
  },
  home_footer_tagline: {
    mn: "Олон түвшний хандалтын эрхэд суурилсан дүрс масклах, сэргээх функц бүхий ухаалаг сүлжээний камер болон нэгдсэн хяналтын серверийн хөгжүүлэлт",
    en: "Development of an Intelligent Network Camera and Integrated Surveillance Server Supporting Multi-Level Access-Based Masking and Restoration",
    kr: "다중 권한 마스킹 및 복원이 가능한 지능형 네트워크 카메라 및 통합관제 서버 개발",
  },
  live_status_loading: {
    mn: "Шалгаж байна…",
    en: "Probing…",
    kr: "확인 중…",
  },
  live_status_failed: {
    mn: "Health check бүтэлгүйтэв",
    en: "Health check failed",
    kr: "상태 확인 실패",
  },
  live_match_label: {
    mn: "Өндөр итгэлтэй таалцал",
    en: "High-confidence match",
    kr: "고신뢰도 일치",
  },
  live_match_dismiss_hint: {
    mn: "Дарж хаах",
    en: "Click to dismiss",
    kr: "클릭하여 닫기",
  },
  pb_reveal_history_title: {
    mn: "Reveal түүх",
    en: "Reveal history",
    kr: "공개 기록",
  },
  pb_reveal_range_btn: {
    mn: "Хүрээгээр reveal",
    en: "Reveal range",
    kr: "범위 공개",
  },
  pb_reveal_range_hint: {
    mn: "Зөвхөн нүүр илэрсэн хугацааны хүрээнд reveal хийх",
    en: "Reveal only the time window where faces are detected",
    kr: "얼굴이 감지된 시간 범위에서만 공개",
  },
  home_hero_title: {
    mn: "Олон түвшний хандалтын эрхэд суурилсан дүрс масклах, сэргээх функц бүхий ухаалаг сүлжээний камер болон нэгдсэн хяналтын серверийн хөгжүүлэлт",
    en: "Development of an Intelligent Network Camera and Integrated Surveillance Server Supporting Multi-Level Access-Based Masking and Restoration",
    kr: "다중 권한 마스킹 및 복원이 가능한 지능형 네트워크 카메라 및 통합관제 서버 개발",
  },
  home_hero_body: {
    mn: "MONGOLZ Security нь нүүр илрүүлэлтийг автомат privacy mask-аар хүргэж, эх бичлэгийг AES-256-аар шифрлэн зөвхөн зөвшөөрөгдсөн reveal flow-ор буцаах боломжтой систем юм.",
    en: "MONGOLZ Security pairs real-time face detection with automatic privacy masking, AES-256 encrypted originals, and a 4-eyes reveal flow.",
    kr: "MONGOLZ Security는 실시간 얼굴 감지, 자동 프라이버시 마스킹, AES-256으로 암호화된 원본, 4-eyes reveal 흐름을 결합합니다.",
  },
  home_cta_login: {
    mn: "Нэвтрэх",
    en: "Sign in",
    kr: "로그인",
  },
  home_cta_dashboard: {
    mn: "Системд орох",
    en: "Open dashboard",
    kr: "대시보드 열기",
  },
  home_cta_learn: {
    mn: "Дэлгэрэнгүй",
    en: "Learn more",
    kr: "더 알아보기",
  },
  home_demos_body: {
    mn: "Нэвтэрсний дараа эдгээр feature-уудыг шууд туршаад үзэх боломжтой.",
    en: "Sign in to try these features directly on live data.",
    kr: "로그인하여 라이브 데이터에서 이 기능을 직접 시도해보세요.",
  },
  home_final_cta_title: {
    mn: "Бэлэн үү?",
    en: "Ready to explore?",
    kr: "탐색할 준비가 되셨나요?",
  },
  home_final_cta_body: {
    mn: "Эрхтэй хэрэглэгчээр нэвтэрч системийг шууд харж үзээрэй. Demo акк дээр TOTP-ийг идэвхжүүлсний дараа л бүх feature нээгдэнэ.",
    en: "Sign in with an authorized account to explore the live system. Most features unlock only after enabling TOTP on the demo account.",
    kr: "승인된 계정으로 로그인하여 라이브 시스템을 탐색하세요. 대부분의 기능은 데모 계정에 TOTP를 활성화한 후에만 잠금 해제됩니다.",
  },

  // ── Cross-camera Re-ID ──
  nav_reid: { mn: "Re-ID мөшгилт", en: "Re-ID Trail", kr: "재식별 추적" },
  reid_title: { mn: "Камер хоорондын Re-ID", en: "Cross-camera Re-ID", kr: "교차 카메라 재식별" },
  reid_subtitle: {
    mn: "Нэг хүн хэдэн камераар явсныг embedding similarity-ээр сэргээх.",
    en: "Reconstruct one person's movement across cameras via embedding similarity.",
    kr: "임베딩 유사도를 통해 한 사람의 카메라 간 이동을 재구성합니다.",
  },
  reid_pick_source: { mn: "Эх царайгаа сонгох", en: "Pick a source face", kr: "기준 얼굴 선택" },
  reid_threshold: { mn: "Босго", en: "Threshold", kr: "임계값" },
  reid_window: { mn: "Хугацааны цонх", en: "Time window", kr: "시간 윈도우" },
  reid_first: { mn: "Эхэлсэн", en: "First seen", kr: "처음 발견" },
  reid_last: { mn: "Сүүлд", en: "Last seen", kr: "마지막 발견" },
  reid_total: { mn: "Нийт олдвор", en: "Total hits", kr: "전체 일치" },
  reid_cameras: { mn: "Камер", en: "Cameras", kr: "카메라" },
  reid_timeline: { mn: "Цаг хугацааны зураглал", en: "Timeline", kr: "타임라인" },
  reid_intro: {
    mn: "Зүүн талаас царай сонгоход бусад камер дээрх таарал гарч ирнэ.",
    en: "Pick a face on the left to see matches from other cameras.",
    kr: "왼쪽에서 얼굴을 선택하면 다른 카메라의 일치 결과가 표시됩니다.",
  },
  reid_source: { mn: "Эх царай", en: "Source face", kr: "기준 얼굴" },
  reid_clear: { mn: "Цэвэрлэх", en: "Clear", kr: "지우기" },

  // ── Privacy zones ──
  nav_zones: { mn: "Privacy zones", en: "Privacy Zones", kr: "프라이버시 영역" },
  zones_title: { mn: "Privacy zone-ууд", en: "Privacy Zones", kr: "프라이버시 영역" },
  zones_subtitle: {
    mn: "Камер бүрт reveal хийгдэхгүй полигон сонгох (WC хаалга, ATM keypad гэх мэт).",
    en: "Per-camera no-reveal zones (restroom door, ATM keypad, etc).",
    kr: "카메라별 공개 금지 영역 (화장실 출입구, ATM 키패드 등).",
  },
  zones_camera: { mn: "Камер", en: "Camera", kr: "카메라" },
  zones_draw_hint: { mn: "Frame дотор drag хийж тэгш өнцөгт зурна.", en: "Drag inside the frame to draw a rectangle.", kr: "프레임 내부를 드래그하여 사각형을 그립니다." },
  zones_new: { mn: "Шинэ zone", en: "New zone", kr: "새 영역" },
  zones_name_placeholder: { mn: "Зоны нэр (жш: WC1)", en: "Zone name (e.g. Restroom)", kr: "영역 이름 (예: 화장실)" },
  zones_reason_placeholder: { mn: "Шалтгаан (заавал биш)", en: "Reason (optional)", kr: "사유 (선택)" },
  zones_never_reveal: { mn: "Reveal-д хэзээ ч хүрэхгүй", en: "Never reveal faces in this zone", kr: "이 영역의 얼굴은 절대 공개 안 됨" },
  zones_vip_mask: { mn: "VIP mask хүчирхэгжүүлэх", en: "Enforce VIP (strong) mask", kr: "VIP(강한) 마스크 적용" },
  zones_save: { mn: "Хадгалах", en: "Save", kr: "저장" },
  zones_existing: { mn: "Идэвхтэй zone", en: "Existing zones", kr: "기존 영역" },
  zones_none: { mn: "Энэ камер дээр zone байхгүй.", en: "No zones for this camera.", kr: "이 카메라에 영역 없음." },
  zones_no_cameras: { mn: "Эхлээд камер нэмнэ үү.", en: "Add a camera first.", kr: "먼저 카메라를 추가하세요." },
  zones_disable: { mn: "Зогсоох", en: "Disable", kr: "비활성화" },
  zones_enable: { mn: "Идэвхжүүлэх", en: "Enable", kr: "활성화" },
  zones_too_small: { mn: "Талбай хэт жижиг (≥2%).", en: "Area too small (≥2%).", kr: "영역이 너무 작음 (≥2%)." },

  // ── Faces page navigation hints ──
  faces_open_playback: {
    mn: "Уг царайн харагдсан бичлэг рүү очих",
    en: "Open the recording where this face appeared",
    kr: "이 얼굴이 나타난 녹화로 이동",
  },
  faces_no_recording: {
    mn: "Бичлэгтэй холбогдоогүй царай (живо detection)",
    en: "Standalone face (no recording linked)",
    kr: "녹화와 연결되지 않은 얼굴 (실시간 감지)",
  },

  // ── Step-up gate ──
  reauth_gate_title: {
    mn: "Дахин баталгаажуулалт шаардлагатай",
    en: "Re-authentication required",
    kr: "재인증이 필요합니다",
  },
  reauth_gate_subtitle: {
    mn: "Энэ хэсэг нь хувийн нууцлалд нөлөөтэй учир TOTP-аар дахин баталгаажуулна уу. 15 минут хүчинтэй.",
    en: "This view is privacy-sensitive — re-verify with your TOTP code. Valid for 15 minutes.",
    kr: "이 페이지는 프라이버시에 민감하므로 TOTP로 다시 인증하세요. 15분 동안 유효합니다.",
  },

  // ── Suspect detail page ──
  susp_total_alerts: { mn: "Нийт alert", en: "Total alerts", kr: "전체 알림" },
  susp_cameras: { mn: "Камер", en: "Cameras", kr: "카메라" },
  susp_first_seen: { mn: "Анх илрүүлсэн", en: "First seen", kr: "처음 발견" },
  susp_last_seen: { mn: "Сүүлд илрүүлсэн", en: "Last seen", kr: "마지막 발견" },
  susp_latest_match: { mn: "Сүүлийн таарал", en: "Latest match", kr: "최신 일치" },
  susp_open_playback: { mn: "Бичлэг нээх", en: "Open recording", kr: "녹화 열기" },
  susp_trail: { mn: "Камер бүрх давтамж", en: "Per-camera frequency", kr: "카메라별 빈도" },
  susp_no_alerts: { mn: "Энэ суспэктэнд таарал байхгүй.", en: "No matches for this suspect yet.", kr: "이 용의자에 대한 일치 없음." },
  susp_when: { mn: "Хэзээ", en: "When", kr: "시점" },
  susp_camera: { mn: "Камер", en: "Camera", kr: "카메라" },
  susp_score: { mn: "Score", en: "Score", kr: "점수" },
  susp_label: { mn: "Label", en: "Label", kr: "라벨" },
  susp_action: { mn: "Үйлдэл", en: "Action", kr: "작업" },
  susp_view: { mn: "Үзэх", en: "View", kr: "보기" },

  // ── Camera health ──
  cam_status_healthy: { mn: "Аюулгүй", en: "Healthy", kr: "정상" },
  cam_status_stale: { mn: "Удааширсан", en: "Stale", kr: "지연됨" },
  cam_status_offline: { mn: "Унтарсан", en: "Offline", kr: "오프라인" },
  cam_status_unknown: { mn: "Тодорхойгүй", en: "Unknown", kr: "알 수 없음" },
  cam_last_seen: { mn: "Сүүлд илрүүлсэн", en: "Last seen", kr: "마지막 감지" },

  // ── Wall (kiosk) view ──
  wall_title: { mn: "Live хана", en: "Live Wall", kr: "라이브 월" },
  wall_cameras: { mn: "камер", en: "cameras", kr: "카메라" },
  wall_back: { mn: "Дэшбоард", en: "Dashboard", kr: "대시보드" },
  wall_enter_fs: { mn: "Бүтэн дэлгэц", en: "Enter full screen", kr: "전체 화면" },
  wall_exit_fs: { mn: "Бүтэн дэлгэцээс гарах", en: "Exit full screen", kr: "전체 화면 종료" },
  wall_no_cameras: { mn: "Идэвхтэй камер байхгүй.", en: "No active cameras.", kr: "활성 카메라가 없습니다." },
  wall_last: { mn: "Сүүлд", en: "Last", kr: "마지막" },
  nav_wall: { mn: "Live хана", en: "Live Wall", kr: "라이브 월" },

  // ── Dashboard live activity feed ──
  dash_live_activity: { mn: "Бодит цаг үйл явдал", en: "Live activity", kr: "실시간 활동" },
  dash_live_empty: { mn: "Дараагийн үйл явдлыг хүлээж байна…", en: "Waiting for the next event…", kr: "다음 이벤트를 기다리는 중…" },

  // ── Anomaly detection ──
  nav_anomaly: { mn: "Anomaly", en: "Anomaly", kr: "이상 감지" },
  anomaly_title: { mn: "Anomaly detection", en: "Anomaly Detection", kr: "이상 감지" },
  anomaly_subtitle: {
    mn: "Per-camera hourly face count-ийн z-score baseline. |z| ≥ 2 нь спайк/dropoff.",
    en: "Per-camera hourly face count z-score vs baseline. |z| ≥ 2 = spike/dropoff.",
    kr: "카메라별 시간당 얼굴 카운트 z-score. |z| ≥ 2 = 스파이크/감소.",
  },
  anomaly_camera: { mn: "Камер", en: "Camera", kr: "카메라" },
  anomaly_window: { mn: "Сүүлийн", en: "Recent", kr: "최근" },
  anomaly_baseline: { mn: "Baseline", en: "Baseline", kr: "기준선" },
  anomaly_z: { mn: "z-score", en: "z-score", kr: "z-점수" },
  anomaly_score_legend: { mn: "Тогтвортой / Сэжигтэй / Анхааруулга", en: "Stable / Watch / Alert", kr: "안정 / 주의 / 경보" },
  anomaly_none: { mn: "Аномали илрээгүй.", en: "No anomalies detected.", kr: "이상이 감지되지 않았습니다." },

  // ── Heatmap analytics ──
  nav_heatmap: { mn: "Heatmap", en: "Heatmap", kr: "히트맵" },
  heatmap_title: { mn: "Царайн heatmap", en: "Face Heatmap", kr: "얼굴 히트맵" },
  heatmap_subtitle: {
    mn: "Камер бүрт нүүр илрүүлсэн frame-ийн bbox-ыг spatial density болгож харуулах.",
    en: "Spatial density of detected face bboxes per camera frame.",
    kr: "카메라 프레임당 감지된 얼굴 bbox의 공간 밀도.",
  },
  heatmap_camera: { mn: "Камер", en: "Camera", kr: "카메라" },
  heatmap_window: { mn: "Хугацаа", en: "Window", kr: "기간" },
  heatmap_samples: { mn: "Дээж", en: "Samples", kr: "샘플" },
  heatmap_select_camera: { mn: "Камер сонгоно уу", en: "Select a camera", kr: "카메라를 선택하세요" },
  heatmap_no_data: { mn: "Энэ хугацаанд bbox-той царай байхгүй.", en: "No face bboxes recorded in this window.", kr: "이 기간에 기록된 얼굴 bbox가 없습니다." },

  // ── Web Push ──
  push_title: { mn: "Push мэдэгдэл", en: "Push Notifications", kr: "푸시 알림" },
  push_desc: {
    mn: "Browser-ийн push subscription. Alert гарвал бичлэгийн оронд шууд browser-руу мэдэгдэнэ.",
    en: "Browser push subscriptions. Alerts reach your browser directly without polling.",
    kr: "브라우저 푸시 구독. 알림이 폴링 없이 브라우저로 직접 전달됩니다.",
  },
  push_enable: { mn: "Push идэвхжүүлэх", en: "Enable push", kr: "푸시 활성화" },
  push_disable: { mn: "Push зогсоох", en: "Disable push", kr: "푸시 비활성화" },
  push_test: { mn: "Туршилт мэдэгдэл", en: "Send test", kr: "테스트 전송" },
  push_status_enabled: { mn: "Идэвхтэй", en: "Active", kr: "활성" },
  push_status_disabled: { mn: "Идэвхгүй", en: "Inactive", kr: "비활성" },
  push_blocked: { mn: "Browser-ийн зөвшөөрөл хаагдсан.", en: "Browser permission blocked.", kr: "브라우저 권한이 차단되었습니다." },
  push_unsupported: { mn: "Энэ browser push дэмжихгүй.", en: "This browser does not support push.", kr: "이 브라우저는 푸시를 지원하지 않습니다." },

  // ── Performance budget ──
  nav_perf: { mn: "Гүйцэтгэл", en: "Web Vitals", kr: "웹 바이탈" },
  perf_title: { mn: "Performance budget", en: "Performance Budget", kr: "성능 예산" },
  perf_subtitle: {
    mn: "Core Web Vitals — бодит хэрэглэгчдээс цуглуулсан LCP/INP/CLS p75.",
    en: "Core Web Vitals — real-user p75 for LCP/INP/CLS.",
    kr: "Core Web Vitals — 실사용자 p75 LCP/INP/CLS.",
  },
  perf_samples: { mn: "Дээж", en: "Samples", kr: "샘플" },
  perf_p75: { mn: "p75", en: "p75", kr: "p75" },
  perf_p95: { mn: "p95", en: "p95", kr: "p95" },
  perf_budget: { mn: "Зорилго", en: "Budget", kr: "예산" },
  perf_metric: { mn: "Метрик", en: "Metric", kr: "지표" },
  perf_page: { mn: "Хуудас", en: "Page", kr: "페이지" },
  perf_empty: {
    mn: "Одоогоор Web Vitals дээж цугларсангүй. Тоглуулагч хуудас руу зочлоход cэxэн дээж эхэлнэ.",
    en: "No Web Vitals samples yet. They start arriving once admin pages get visited.",
    kr: "아직 Web Vitals 샘플이 없습니다. 관리자 페이지를 방문하면 수집이 시작됩니다.",
  },

  // ── Sidebar group labels ──
  nav_group_workspace: { mn: "Үндсэн цэс", en: "Workspace", kr: "작업 공간" },
  nav_group_monitoring: { mn: "Хяналт", en: "Monitoring", kr: "모니터링" },
  nav_group_investigation: { mn: "Шинжилгээ", en: "Investigation", kr: "조사" },
  nav_group_admin: { mn: "Удирдлага", en: "Administration", kr: "관리" },
  nav_group_ml: { mn: "Лаборатори", en: "Lab & tools", kr: "실험실 및 도구" },
  nav_group_resources: { mn: "Тусламж ба нууцлал", en: "Resources", kr: "자료 및 개인정보" },
  nav_primary: { mn: "Өдөр тутмын ажил", en: "Daily workspace", kr: "주요 작업" },
  nav_expand_sidebar: { mn: "Хажуугийн цэс дэлгэх", en: "Expand sidebar", kr: "사이드바 펼치기" },
  nav_collapse_sidebar: { mn: "Хажуугийн цэс хураах", en: "Collapse sidebar", kr: "사이드바 접기" },
  nav_workspace_caption: { mn: "Аюулгүй байдлын хяналт", en: "Security workspace", kr: "보안 작업 공간" },
  nav_navigation: { mn: "Үндсэн навигац", en: "Main navigation", kr: "주요 탐색" },

  // ── Face crops (ADR 0009 seal state) ──
  face_sealed_badge: {
    mn: "Битүүмжилсэн crop — AES-256-GCM, hash-chain түлхүүр",
    en: "Sealed crop — AES-256-GCM, hash-chain key",
    kr: "봉인된 얼굴 이미지 — AES-256-GCM, 해시체인 키",
  },
  face_locked_badge: {
    mn: "Таны reveal түвшнээс дээш — түгжээтэй",
    en: "Above your reveal level — locked",
    kr: "권한 수준 초과 — 잠김",
  },

  // ── Human review queue (/review) ──
  review_title: { mn: "Хүний хяналт", en: "Human Review", kr: "수동 검토" },
  review_unreviewed: { mn: "хянагдаагүй", en: "unreviewed", kr: "미검토" },
  review_reviewed: { mn: "хянагдсан", en: "reviewed", kr: "검토됨" },
  review_empty: { mn: "Хянах царай алга", en: "No faces to review", kr: "검토할 얼굴이 없습니다" },
  review_confirm: { mn: "Царайг батлах", en: "Confirm face", kr: "얼굴 확인" },
  review_reject: { mn: "Татгалзах (буруу илрүүлэлт)", en: "Reject (false positive)", kr: "거부 (오탐)" },

  // ── Login error codes (app/login/page.tsx maps ?error=<code> → copy) ──
  login_err_generic: { mn: "Нэвтрэх амжилтгүй. Дахин оролдоно уу.", en: "Sign-in failed. Please try again.", kr: "로그인에 실패했습니다. 다시 시도하세요." },
  login_err_too_many: { mn: "Хэт олон оролдлого. 15 минутын дараа дахин оролдоно уу.", en: "Too many attempts. Try again in 15 minutes.", kr: "시도 횟수가 너무 많습니다. 15분 후 다시 시도하세요." },
  login_err_code_format: { mn: "6 оронтой код эсвэл сэргээх код (XXXXX-XXXXX) оруулна уу.", en: "Enter a 6-digit code or a recovery code (XXXXX-XXXXX).", kr: "6자리 코드 또는 복구 코드(XXXXX-XXXXX)를 입력하세요." },
  login_err_code_invalid: { mn: "Код буруу байна.", en: "Invalid code.", kr: "잘못된 코드입니다." },
  login_err_code_used: { mn: "Энэ кодыг аль хэдийн ашигласан байна. Дараагийн кодыг хүлээнэ үү.", en: "That code was already used. Wait for the next one.", kr: "이미 사용된 코드입니다. 다음 코드를 기다리세요." },
  login_err_code_expired: { mn: "Баталгаажуулах хугацаа дууссан. Дахин нэвтэрнэ үү.", en: "The verification window expired. Sign in again.", kr: "인증 시간이 만료되었습니다. 다시 로그인하세요." },
  login_err_signin_failed: { mn: "Нэвтрэлтийг дуусгаж чадсангүй. Дахин оролдоно уу.", en: "Could not complete sign-in. Please try again.", kr: "로그인을 완료할 수 없습니다. 다시 시도하세요." },
  login_err_no_profile: { mn: "Энэ бүртгэлд профайл алга. Админтай холбогдоно уу.", en: "No profile for this account. Contact an administrator.", kr: "이 계정의 프로필이 없습니다. 관리자에게 문의하세요." },
  login_err_session_pin: { mn: "Аюулгүй байдлын үүднээс сессийг хаасан (өөр төхөөрөмж/сүлжээ). Дахин нэвтэрнэ үү.", en: "Your session was closed for security (different device or network). Sign in again.", kr: "보안상 세션이 종료되었습니다(다른 기기/네트워크). 다시 로그인하세요." },
  login_err_session_rebind: { mn: "Аюулгүй байдлын үүднээс дахин нэвтэрнэ үү.", en: "For security, please sign in again.", kr: "보안을 위해 다시 로그인해 주세요." },
  login_err_callback: { mn: "Нэвтрэх холбоос хүчингүй эсвэл хугацаа нь дууссан.", en: "The sign-in link is invalid or expired.", kr: "로그인 링크가 유효하지 않거나 만료되었습니다." },
  login_err_server_config: { mn: "Серверийн тохиргооны алдаа: нэвтрэлтийн гарын үсгийн нууц түлхүүр тохируулагдаагүй байна. Системийн админд мэдэгдэнэ үү.", en: "Server configuration error: the sign-in signing secret is not set. Please notify the system administrator.", kr: "서버 구성 오류: 로그인 서명 키가 설정되지 않았습니다. 시스템 관리자에게 알려 주세요." },
  login_err_boundary_desc: { mn: "Нэвтрэх хуудсанд алдаа гарлаа. Алдааг автоматаар бүртгэлээ — дахин оролдоно уу.", en: "The sign-in page hit an error. It has been reported automatically — please try again.", kr: "로그인 페이지에서 오류가 발생했습니다. 자동으로 보고되었습니다 — 다시 시도해 주세요." },
  login_err_back: { mn: "Нэвтрэх хуудас руу буцах", en: "Back to sign-in", kr: "로그인으로 돌아가기" },
  totp_prompt_server_config: { mn: "Серверийн тохиргооны алдаа: гарын үсгийн нууц түлхүүр алга. Системийн админд мэдэгдэнэ үү.", en: "Server configuration error: the signing secret is missing. Notify the system administrator.", kr: "서버 구성 오류: 서명 키가 없습니다. 시스템 관리자에게 알려 주세요." },
  grid_viewer_readonly: { mn: "Зөвхөн үзэх горим — камер асаах, зогсоох нь админы үйлдэл. Ажиллаж буй стримүүд автоматаар холбогдоно.", en: "View-only mode — starting and stopping cameras is an admin action. Running streams attach automatically.", kr: "보기 전용 모드 — 카메라 시작/정지는 관리자만 할 수 있습니다. 실행 중인 스트림은 자동으로 연결됩니다." },
  grid_no_streams_viewer: { mn: "Одоогоор ажиллаж буй стрим алга — админ камер асаасны дараа энд харагдана.", en: "No streams are running right now — they appear here once an admin starts a camera.", kr: "현재 실행 중인 스트림이 없습니다 — 관리자가 카메라를 시작하면 여기에 표시됩니다." },
  grid_waiting_stream: { mn: "Стрим хүлээж байна", en: "Waiting for stream", kr: "스트림 대기 중" },
  health_config: { mn: "Тохиргоо (нууц түлхүүрүүд)", en: "Configuration (secrets)", kr: "구성(비밀 키)" },
  health_config_ok: { mn: "Production-д шаардлагатай бүх нууц түлхүүр тохируулагдсан", en: "All production secrets are set", kr: "모든 프로덕션 비밀 키가 설정되어 있습니다" },
  health_config_missing: { mn: "Дутуу нууц түлхүүр", en: "Missing secrets", kr: "누락된 비밀 키" },
  health_config_dev: { mn: "Хөгжүүлэлтийн орчин — эдгээр түлхүүр зөвхөн production-д заавал шаардлагатай.", en: "Development runtime — these are only required in production.", kr: "개발 환경 — 프로덕션에서만 필수입니다." },
  grid_no_cameras_viewer: { mn: "Танд харагдах идэвхтэй камер алга. Админтай холбогдоно уу.", en: "No cameras are available to you. Ask an administrator to enable one.", kr: "사용할 수 있는 카메라가 없습니다. 관리자에게 문의하세요." },
  grid_ticket_failed: { mn: "Стримийн эрх авч чадсангүй — видео харагдахгүй. Серверийн тохиргоог шалгана уу (STREAM_TICKET_SECRET).", en: "Could not obtain a stream ticket — video will not play. Check the server configuration (STREAM_TICKET_SECRET).", kr: "스트림 티켓을 발급받지 못해 영상이 재생되지 않습니다. 서버 구성을 확인하세요(STREAM_TICKET_SECRET)." },
  login_totp_hint: {
    mn: "Authenticator app-аас 6 оронтой кодоо, эсвэл сэргээх кодоо (XXXXX-XXXXX) оруулна уу.",
    en: "Enter the 6-digit code from your authenticator app, or a recovery code (XXXXX-XXXXX).",
    kr: "인증 앱의 6자리 코드 또는 복구 코드(XXXXX-XXXXX)를 입력하세요.",
  },
  login_totp_note: {
    mn: "Код 2 минут хүчинтэй. Сэргээх код нэг л удаа ашиглагдана.",
    en: "The window lasts 2 minutes. Recovery codes are single-use.",
    kr: "인증 시간은 2분입니다. 복구 코드는 1회만 사용할 수 있습니다.",
  },
  step_up_required: { mn: "Энэ үйлдэлд шинэ TOTP баталгаажуулалт шаардлагатай.", en: "This action needs a fresh TOTP verification.", kr: "이 작업에는 새로운 TOTP 인증이 필요합니다." },

  status_ml_down: { mn: "Холбогдохгүй байна", en: "Unreachable", kr: "연결 불가" },
  status_db_down: { mn: "Холбогдохгүй байна", en: "Unreachable", kr: "연결 불가" },
  err_admin_only: { mn: "Энэ хуудас зөвхөн админд зориулагдсан.", en: "That page is admin-only.", kr: "해당 페이지는 관리자 전용입니다." },
  err_forbidden: { mn: "Танд энэ хуудсанд хандах эрх байхгүй.", en: "You do not have access to that page.", kr: "해당 페이지에 접근할 권한이 없습니다." },
  ui_error_title: { mn: "Алдаа гарлаа", en: "Something went wrong", kr: "문제가 발생했습니다" },
  ui_error_desc: { mn: "Энэ хуудсыг ачаалахад алдаа гарлаа. Алдааг автоматаар бүртгэлээ.", en: "This page failed to load. The error has been reported automatically.", kr: "페이지를 불러오지 못했습니다. 오류가 자동으로 보고되었습니다." },
  ui_retry: { mn: "Дахин оролдох", en: "Try again", kr: "다시 시도" },
  ui_not_found_title: { mn: "Хуудас олдсонгүй", en: "Page not found", kr: "페이지를 찾을 수 없습니다" },
  ui_not_found_desc: { mn: "Хайсан хуудас байхгүй эсвэл устгагдсан байна.", en: "The page you are looking for does not exist or was removed.", kr: "찾으시는 페이지가 없거나 삭제되었습니다." },
  ui_back_dashboard: { mn: "Хяналтын самбар руу", en: "Back to dashboard", kr: "대시보드로" },
  ui_loading: { mn: "Уншиж байна…", en: "Loading…", kr: "불러오는 중…" },
  approvals_already_decided: { mn: "Энэ хүсэлтийг өөр админ аль хэдийн шийдсэн байна.", en: "This request was already decided by another admin.", kr: "이 요청은 이미 다른 관리자가 처리했습니다." },
  approvals_self: { mn: "Өөрийн хүсэлтийг өөрөө зөвшөөрөх боломжгүй. Бусад admin шийднэ.", en: "You cannot approve your own request. Another admin must decide.", kr: "본인 요청은 본인이 승인할 수 없습니다. 다른 관리자가 결정합니다." },
  approvals_ml_failed: { mn: "Батлагдсан ч ML service-ийг эхлүүлж чадсангүй", en: "Approved, but the ML service could not be started", kr: "승인되었지만 ML 서비스를 시작하지 못했습니다" },
  suspect_add_missing: { mn: "Нэр болон зураг заавал", en: "Name and photo are required", kr: "이름과 사진은 필수입니다" },
  suspect_add_ml_failed: { mn: "ML service-с embedding авсангүй", en: "Could not get an embedding from the ML service", kr: "ML 서비스에서 임베딩을 가져오지 못했습니다" },
  suspect_add_failed: { mn: "Сэжигтэн нэмэхэд алдаа гарлаа", en: "Could not add the suspect", kr: "용의자를 추가하지 못했습니다" },
  suspect_added: { mn: "Сэжигтэн нэмэгдлээ", en: "Suspect added", kr: "용의자가 추가되었습니다" },

  // ── Playback: reveal action bar / multi-select (playback-player.tsx) ──
  pb_select_mode_active: { mn: "Сонгох горим идэвхтэй —", en: "Select mode active —", kr: "선택 모드 활성 —" },
  pb_select_mode_hint: { mn: "Видеон дээрх нүүр болон доорх жагсаалтаас reveal хийх хүмүүсийг сонгоно уу. Сонгосон", en: "Pick the people to reveal from the video or the list below. Selected", kr: "영상 또는 아래 목록에서 공개할 사람을 선택하세요. 선택됨" },
  pb_people: { mn: "хүн.", en: "person(s).", kr: "명." },
  pb_idle_hint: { mn: "Видеоны blurred нүүр дээр шууд click хийн нэг хүний reveal, эсвэл \"Сонгох горим\"-аас олон нүүр сонгоно уу.", en: "Click a blurred face in the video to reveal one person, or use \"Select mode\" to pick several.", kr: "영상의 블러 처리된 얼굴을 클릭해 한 명을 공개하거나, \"선택 모드\"로 여러 명을 선택하세요." },
  pb_no_faces: { mn: "Нүүр илрээгүй", en: "No faces detected", kr: "감지된 얼굴 없음" },
  pb_select_many_title: { mn: "Олон нүүр сонгож reveal", en: "Select several faces to reveal", kr: "여러 얼굴을 선택해 공개" },
  pb_select_mode_btn: { mn: "Сонгох горим", en: "Select mode", kr: "선택 모드" },
  pb_reveal_btn: { mn: "Reveal хийх", en: "Reveal", kr: "공개" },
  pb_cancel_btn: { mn: "Болих", en: "Cancel", kr: "취소" },
  pb_all_faces_title: { mn: "Бүх илрүүлсэн нүүр", en: "All detected faces", kr: "감지된 모든 얼굴" },
  pb_click_to_select: { mn: "click хийн сонго", en: "click to select", kr: "클릭하여 선택" },
  pb_clear_selection: { mn: "Сонголт цэвэрлэх", en: "Clear selection", kr: "선택 해제" },
  pb_selected: { mn: "Сонгогдсон", en: "Selected", kr: "선택됨" },

  // ── App shell (header / tab bar / palette) ──
  nav_mobile_navigation: { mn: "Гар утасны үндсэн цэс", en: "Mobile navigation", kr: "모바일 탐색" },
  nav_breadcrumb: { mn: "Хуудасны байршил", en: "Breadcrumb", kr: "현재 위치" },
  nav_more: { mn: "Цэс", en: "More", kr: "더보기" },
  nav_review: { mn: "Шалгах дараалал", en: "Review queue", kr: "검토 대기열" },
  nav_jobs: { mn: "Ажлын дараалал", en: "Jobs", kr: "작업 큐" },
  nav_grid: { mn: "Камерын grid", en: "Camera grid", kr: "카메라 그리드" },
  nav_clusters: { mn: "Царайн бүлэглэл", en: "Face clusters", kr: "얼굴 클러스터" },
  nav_health: { mn: "Системийн төлөв", en: "System health", kr: "시스템 상태" },
  nav_privacy: { mn: "Хувийн мэдээлэл (GDPR)", en: "Privacy (GDPR)", kr: "개인정보 (GDPR)" },
  nav_eval: { mn: "ML үнэлгээ", en: "ML evaluation", kr: "ML 평가" },
  nav_edge_detect: { mn: "Browser ONNX демо", en: "Edge detect (ONNX)", kr: "엣지 감지 (ONNX)" },
  nav_edge_agents: { mn: "Edge төхөөрөмжүүд", en: "Edge devices", kr: "엣지 장치" },
  nav_thresholds: { mn: "Threshold тохируулга", en: "Thresholds", kr: "임계값 조정" },
  nav_zk_reveal: { mn: "ZK reveal (PoC)", en: "ZK reveal (PoC)", kr: "ZK 공개 (PoC)" },
  header_search: { mn: "Хайх…", en: "Search…", kr: "검색…" },
  header_search_hint: { mn: "Хуудас, үйлдэл хайх (⌘K)", en: "Search pages and actions (⌘K)", kr: "페이지·작업 검색 (⌘K)" },
  status_all_ok: { mn: "Бүх систем хэвийн", en: "All systems operational", kr: "모든 시스템 정상" },
  status_degraded: { mn: "Зарим үйлчилгээ доголдолтой", en: "Some services degraded", kr: "일부 서비스 장애" },
  status_checking: { mn: "Шалгаж байна…", en: "Checking…", kr: "확인 중…" },
  menu_account: { mn: "Бүртгэл", en: "Account", kr: "계정" },
  menu_language: { mn: "Хэл", en: "Language", kr: "언어" },
  theme_light: { mn: "Цайвар горим", en: "Light mode", kr: "라이트 모드" },
  theme_dark: { mn: "Бараан горим", en: "Dark mode", kr: "다크 모드" },
  cmdk_section_actions: { mn: "Үйлдлүүд", en: "Actions", kr: "작업" },
  skip_to_content: { mn: "Гол хэсэг рүү шилжих", en: "Skip to main content", kr: "본문으로 건너뛰기" },
  staging_not_production: { mn: "ENVIRONMENT — production биш", en: "ENVIRONMENT — not production", kr: "ENVIRONMENT — 프로덕션 아님" },
  rt_match_label: { mn: "Тааралцал", en: "Match", kr: "일치" },
  rt_see_all: { mn: "Alert нээх →", en: "Open alert →", kr: "알림 열기 →" },
  rt_dismiss: { mn: "Хаах", en: "Close", kr: "닫기" },
  tab_dashboard: { mn: "Самбар", en: "Home", kr: "홈" },
  tab_live: { mn: "Live", en: "Live", kr: "라이브" },
  tab_playback: { mn: "Бичлэг", en: "Playback", kr: "재생" },
  tab_alerts: { mn: "Алерт", en: "Alerts", kr: "알림" },
  tab_analytics: { mn: "Аналитик", en: "Analytics", kr: "분석" },
  tab_audit: { mn: "Аудит", en: "Audit", kr: "감사" },
  menu_preferences: { mn: "Тохиргоо", en: "Preferences", kr: "환경설정" },

  // ── Landing hero mockup + stats strip ──
  home_mock_recent: { mn: "Сүүлийн alert", en: "Recent alerts", kr: "최근 알림" },
  home_mock_live: { mn: "Шууд", en: "Live", kr: "실시간" },
  home_mock_sealed: { mn: "Битүүмжилсэн · AES-256-GCM", en: "Sealed · AES-256-GCM", kr: "봉인됨 · AES-256-GCM" },
  home_mock_pending: { mn: "4-eyes зөвшөөрөл хүлээж байна", en: "Awaiting 4-eyes approval", kr: "4-eyes 승인 대기 중" },
  home_mock_approved: { mn: "Reveal зөвшөөрөгдлөө · 2-р admin", en: "Reveal approved · 2nd admin", kr: "공개 승인됨 · 2번째 관리자" },
  home_mock_cameras: { mn: "Камер", en: "Cameras", kr: "카메라" },
  home_stat_embed: { mn: "ArcFace embedding", en: "ArcFace embedding", kr: "ArcFace 임베딩" },
  home_stat_enc: { mn: "Бичлэгийн шифрлэлт", en: "Recording encryption", kr: "녹화 암호화" },
  home_stat_roles: { mn: "Эрхийн түвшин + 4-eyes", en: "Roles + 4-eyes reveal", kr: "역할 + 4-eyes 공개" },
  home_trust_row: { mn: "Нууцлал нэгдүгээрт · Аудитад бэлэн · Нээлттэй архитектур", en: "Privacy-first · Audit-ready · Open architecture", kr: "프라이버시 우선 · 감사 대응 · 개방형 아키텍처" },

  // ── Dashboard panels ──
  dash_quick_actions: { mn: "Түргэн үйлдэл", en: "Quick actions", kr: "빠른 작업" },
  dash_trend_7d: { mn: "Сүүлийн 7 хоногийн alert", en: "Alerts · last 7 days", kr: "최근 7일 알림" },
  dash_vs_prev: { mn: "өмнөх 7 хоногтой харьцуулахад", en: "vs previous 7 days", kr: "이전 7일 대비" },
  dash_cameras: { mn: "Камерууд", en: "Cameras", kr: "카메라" },
  dash_no_cameras: { mn: "Камер бүртгэгдээгүй байна", en: "No cameras registered yet", kr: "등록된 카메라가 없습니다" },
  dash_cam_enabled: { mn: "Идэвхтэй", en: "Enabled", kr: "활성" },
  dash_cam_disabled: { mn: "Идэвхгүй", en: "Disabled", kr: "비활성" },
  dash_recent_recordings: { mn: "Сүүлийн бичлэгүүд", en: "Recent recordings", kr: "최근 녹화" },
  dash_no_recordings: { mn: "Бичлэг алга байна", en: "No recordings yet", kr: "녹화가 없습니다" },
  dash_manage: { mn: "Удирдах", en: "Manage", kr: "관리" },
  qa_start_live: { mn: "Live бичлэг эхлүүлэх", en: "Start live", kr: "라이브 시작" },
  qa_search_face: { mn: "Царай хайх", en: "Search a face", kr: "얼굴 검색" },
  qa_add_suspect: { mn: "Сэжигтэн нэмэх", en: "Add suspect", kr: "용의자 추가" },
  qa_review: { mn: "Шалгах дараалал", en: "Review queue", kr: "검토 대기열" },
  qa_playback: { mn: "Бичлэг үзэх", en: "Open playback", kr: "재생 열기" },
  qa_analytics: { mn: "Аналитик харах", en: "View analytics", kr: "분석 보기" },

  // ── Toast feedback ──
  toast_saved: { mn: "Хадгалагдлаа", en: "Saved", kr: "저장되었습니다" },
  toast_camera_saved: { mn: "Камер хадгалагдлаа", en: "Camera saved", kr: "카메라가 저장되었습니다" },
  toast_camera_added: { mn: "Камер нэмэгдлээ", en: "Camera added", kr: "카메라가 추가되었습니다" },
  toast_deleted: { mn: "Устгагдлаа", en: "Deleted", kr: "삭제되었습니다" },
  toast_failed: { mn: "Үйлдэл амжилтгүй", en: "Action failed", kr: "작업 실패" },
  toast_label_failed: { mn: "Тэмдэглэгээ хадгалагдсангүй", en: "Label was not saved", kr: "라벨이 저장되지 않았습니다" },
  toast_label_saved: { mn: "Тэмдэглэгээ хадгалагдлаа", en: "Label saved", kr: "라벨이 저장되었습니다" },
  toast_step_up_required: { mn: "Дахин баталгаажуулалт шаардлагатай", en: "Re-authentication required", kr: "재인증이 필요합니다" },

  // ── Multi-camera grid (NVR-style live view) + live wall ──
  grid_title: { mn: "Камерын хяналт", en: "Camera monitor", kr: "카메라 모니터" },
  grid_active_cameras: { mn: "идэвхтэй камер", en: "active cameras", kr: "활성 카메라" },
  grid_streaming: { mn: "дамжуулж байна", en: "streaming", kr: "스트리밍 중" },
  grid_start_all: { mn: "Бүгдийг асаах", en: "Start all", kr: "모두 시작" },
  grid_stop_all: { mn: "Бүгдийг зогсоох", en: "Stop all", kr: "모두 정지" },
  grid_layout: { mn: "Байрлал", en: "Layout", kr: "레이아웃" },
  grid_auto: { mn: "Авто", en: "Auto", kr: "자동" },
  grid_page: { mn: "Хуудас", en: "Page", kr: "페이지" },
  grid_prev: { mn: "Өмнөх", en: "Previous", kr: "이전" },
  grid_next: { mn: "Дараах", en: "Next", kr: "다음" },
  grid_no_cameras: { mn: "Идэвхтэй камер алга. Эхлээд Камер удирдах хэсэгт камер нэмнэ үү.", en: "No enabled cameras. Add one under Cameras first.", kr: "활성 카메라가 없습니다. 먼저 카메라를 추가하세요." },
  grid_live: { mn: "LIVE", en: "LIVE", kr: "LIVE" },
  grid_idle: { mn: "Зогссон", en: "Idle", kr: "대기" },
  grid_starting: { mn: "Асааж байна…", en: "Starting…", kr: "시작 중…" },
  grid_stopping: { mn: "Зогсоож байна…", en: "Stopping…", kr: "정지 중…" },
  grid_stream_failed: { mn: "Стрим ачаалагдсангүй", en: "Stream failed to load", kr: "스트림을 불러오지 못했습니다" },
  grid_retry: { mn: "Дахин оролдох", en: "Retry", kr: "다시 시도" },
  grid_restarted: { mn: "Дахин эхэлсэн", en: "Restarted", kr: "재시작됨" },
  camera_reconnecting: { mn: "Дахин холбогдож байна", en: "Reconnecting", kr: "재연결 중" },
  camera_next_try_at: { mn: "дараагийн оролдлого", en: "next try at", kr: "다음 시도" },
  camera_retry_soon: { mn: "удахгүй дахин оролдоно", en: "retrying shortly", kr: "곧 다시 시도합니다" },
  camera_last_reason: { mn: "Сүүлийн шалтгаан", en: "Last reason", kr: "마지막 원인" },
  grid_play: { mn: "Асаах", en: "Start", kr: "시작" },
  grid_stop: { mn: "Зогсоох", en: "Stop", kr: "정지" },
  grid_focus: { mn: "Томруулах", en: "Focus", kr: "확대" },
  grid_back_grid: { mn: "Grid рүү буцах", en: "Back to grid", kr: "그리드로 돌아가기" },
  grid_open_wall: { mn: "Live хана", en: "Live wall", kr: "라이브 월" },
  grid_recording_note: { mn: "Камер асаахад ML service бичлэг хийж, царай илрүүлж эхэлнэ.", en: "Starting a camera also starts recording and face detection on the ML service.", kr: "카메라를 시작하면 ML 서비스에서 녹화와 얼굴 감지도 시작됩니다." },
  grid_ml_down: { mn: "ML service холбогдохгүй байна — live стрим боломжгүй.", en: "ML service unreachable — live streams are unavailable.", kr: "ML 서비스에 연결할 수 없어 라이브 스트림을 사용할 수 없습니다." },
  grid_start_failed: { mn: "Камер асаагдсангүй", en: "Camera failed to start", kr: "카메라를 시작하지 못했습니다" },
  grid_started: { mn: "Камер асаалаа", en: "Camera started", kr: "카메라가 시작되었습니다" },
  grid_stopped: { mn: "Камер зогслоо", en: "Camera stopped", kr: "카메라가 정지되었습니다" },
  wall_mode_live: { mn: "Live видео", en: "Live video", kr: "라이브 영상" },
  wall_mode_status: { mn: "Төлөв", en: "Status", kr: "상태" },
  wall_not_streaming: { mn: "Дамжуулаагүй", en: "Not streaming", kr: "스트리밍 안 함" },

  // ── i18n sweep (playback / settings / live / webhooks) ──
  // playback
  pb_no_reveal: { mn: "reveal боломжгүй", en: "no reveal", kr: "공개 불가" },
  pb_approved_by: { mn: "зөвшөөрсөн:", en: "approved by", kr: "승인자:" },
  pb_rejected_by: { mn: "татгалзсан:", en: "rejected by", kr: "거부자:" },
  pb_rejected: { mn: "Татгалзсан", en: "Rejected", kr: "거부됨" },
  pb_threshold: { mn: "босго", en: "threshold", kr: "임계값" },
  pb_face_timeline: { mn: "Нүүрний timeline", en: "Face timeline", kr: "얼굴 타임라인" },
  pb_seek_timeline: { mn: "Timeline дээр гүйлгэх", en: "Seek timeline", kr: "타임라인 탐색" },
  pb_jump_to_face: { mn: "Нүүр рүү очих", en: "Jump to face", kr: "얼굴로 이동" },
  pb_face: { mn: "Нүүр", en: "Face", kr: "얼굴" },
  pb_reveal_this_face: { mn: "Энэ хүний нүүрийг reveal хийх", en: "Reveal this face", kr: "이 얼굴 공개" },
  pb_preparing: { mn: "Бичлэг бэлтгэж байна…", en: "Preparing recording…", kr: "녹화를 준비하는 중…" },
  pb_play_failed: { mn: "Бичлэг тоглуулах боломжгүй", en: "Cannot play recording", kr: "녹화를 재생할 수 없습니다" },
  pb_play_failed_desc: { mn: "Сервер бичлэгийг бэлтгэж чадсангүй. Дахин оролдоно уу.", en: "The server could not prepare the recording. Please retry.", kr: "서버가 녹화를 준비하지 못했습니다. 다시 시도하세요." },
  pb_select: { mn: "Сонгох", en: "Select", kr: "선택" },
  pb_deselect: { mn: "Сонголтоос хасах", en: "Deselect", kr: "선택 해제" },
  pb_click_face_hint: { mn: "Нүүр дээр click → reveal", en: "Click a face → reveal", kr: "얼굴 클릭 → 공개" },
  pb_modal_title: { mn: "Reveal хийх — нууцлалын журамтай", en: "Reveal — privacy-controlled action", kr: "공개 — 개인정보 보호 절차" },
  pb_reauth_failed: { mn: "Нэвтрэлт амжилтгүй", en: "Authentication failed", kr: "인증 실패" },
  pb_reveal_start_failed: { mn: "Reveal эхлүүлж чадсангүй", en: "Could not start the reveal", kr: "공개를 시작할 수 없습니다" },
  pb_method_upload: { mn: "Зураг upload", en: "Upload photo", kr: "사진 업로드" },
  pb_method_upload_desc: { mn: "Хайх хүний зургийг оруулна", en: "Provide a photo of the person", kr: "찾을 사람의 사진을 올립니다" },
  pb_method_suspect_desc: { mn: "Бүртгэлтэй хүнээс сонгох", en: "Pick a registered person", kr: "등록된 사람 중 선택" },
  pb_method_detected: { mn: "Илрүүлсэн", en: "Detected", kr: "감지됨" },
  pb_method_detected_desc: { mn: "Олон сонгож болно", en: "Multiple allowed", kr: "여러 명 선택 가능" },
  pb_upload_label: { mn: "Хайх хүний зураг", en: "Photo of the person", kr: "찾을 사람의 사진" },
  pb_no_suspects: { mn: "Сэжигтэн бүртгэгдээгүй. /suspects хуудаснаас нэмнэ үү.", en: "No suspects registered. Add one on /suspects.", kr: "등록된 용의자가 없습니다. /suspects 페이지에서 추가하세요." },
  pb_pick_many_hint: { mn: "Олон ID сонгож зэрэг reveal хийнэ үү", en: "Select several IDs to reveal them together", kr: "여러 ID를 선택해 한 번에 공개하세요" },
  pb_threshold_hint: { mn: "Бага = илүү олон тааралт (false positive магадлал ↑) · Их = чанд тааралт", en: "Lower = more matches (higher false-positive risk) · Higher = stricter", kr: "낮음 = 더 많은 일치 (오탐 가능성 ↑) · 높음 = 엄격한 일치" },
  pb_window_start: { mn: "Эхлэх", en: "Start", kr: "시작" },
  pb_window_end: { mn: "Дуусах", en: "End", kr: "종료" },
  pb_window_note: { mn: "Энэ хүрээнээс гадуурх frame-ууд бүхэлдээ блюртэй үлдэнэ — \"principle of least privilege\".", en: "Frames outside this window stay fully blurred — principle of least privilege.", kr: "이 범위 밖의 프레임은 모두 블러 상태로 유지됩니다 — 최소 권한 원칙." },
  pb_window_selected: { mn: "Сонгосон хүрээ:", en: "Selected window:", kr: "선택한 범위:" },
  pb_window_off_note: {
    mn: "Идэвхгүй үед бичлэг бүхэлдээ хамрагдана; нууцлалын горимд бичигдсэн эсвэл камерын нууцлалын хуваарьт хамрагдсан хэсэг маскласан хэвээр үлдэнэ.",
    en: "When off, the whole recording is in scope; stretches captured in privacy mode or covered by the camera's privacy schedule stay masked.",
    kr: "비활성 시 녹화 전체가 대상이며, 프라이버시 모드로 촬영되었거나 카메라의 프라이버시 일정에 포함된 구간은 마스킹된 상태로 남습니다.",
  },
  pb_continue: { mn: "Үргэлжлүүлэх", en: "Continue", kr: "계속" },
  pb_selected_from_video: { mn: "Видеоноос сонгосон", en: "Selected from the video:", kr: "영상에서 선택됨:" },
  pb_faces_will_reveal: { mn: "нүүр дээр reveal хийгдэнэ", en: "face(s) will be revealed", kr: "명의 얼굴이 공개됩니다" },
  pb_reauth_note: { mn: "Reveal хийх нь нууцлалын журамтай үйлдэл. Үргэлжлүүлэхийн тулд нууц үгээ дахин оруулна уу. Дараагийн 15 минутад дахин асуухгүй.", en: "Revealing is a privacy-sensitive action. Re-enter your password to continue. You won't be asked again for 15 minutes.", kr: "공개는 개인정보 보호가 필요한 작업입니다. 계속하려면 비밀번호를 다시 입력하세요. 15분 동안 다시 묻지 않습니다." },
  pb_awaiting_approval: { mn: "2 дахь админы баталгаажуулалт хүлээж байна", en: "Awaiting second-admin approval", kr: "두 번째 관리자의 승인 대기 중" },
  pb_four_eyes_note: { mn: "4-eyes зарчим: нүүр илчлэхээс өмнө өөр нэг админ /reveal-approvals хуудаснаас энэ хүсэлтийг батлах ёстой. Батлагдсаны дараа ML автоматаар ажиллана.", en: "4-eyes principle: another admin must approve this request on /reveal-approvals before any face is revealed. ML runs automatically once approved.", kr: "4-eyes 원칙: 얼굴을 공개하기 전에 다른 관리자가 /reveal-approvals 페이지에서 이 요청을 승인해야 합니다. 승인되면 ML이 자동으로 실행됩니다." },
  pb_processing: { mn: "Reveal боловсруулж байна…", en: "Processing reveal…", kr: "공개 처리 중…" },
  pb_processing_hint: { mn: "Frame бүрд нүүр detect → embedding → блюр харьцуулалт хийнэ", en: "Per frame: detect faces → embed → compare against the blur", kr: "프레임마다 얼굴 감지 → 임베딩 → 블러 비교" },
  pb_reveal_success: { mn: "Reveal амжилттай!", en: "Reveal complete!", kr: "공개 완료!" },
  pb_reveal_success_desc: { mn: "Зөвхөн сонгосон хүний нүүр илэрхий, бусад нь blur-тэй хэвээр", en: "Only the selected person is visible; everyone else stays blurred", kr: "선택한 사람만 보이고 나머지는 블러 상태로 유지됩니다" },
  pb_reveal_failed: { mn: "Reveal амжилтгүй", en: "Reveal failed", kr: "공개 실패" },
  pb_step_pick: { mn: "1. Хүн сонгох", en: "1. Pick person", kr: "1. 대상 선택" },
  pb_step_auth: { mn: "2. Баталгаажуулалт", en: "2. Auth", kr: "2. 인증" },
  pb_step_process: { mn: "3. Боловсруулах", en: "3. Process", kr: "3. 처리" },
  pb_step_done: { mn: "4. Дуусах", en: "4. Done", kr: "4. 완료" },
  pb_masked_label: { mn: "Mask хийсэн (эх бичлэг)", en: "Masked (original)", kr: "마스킹됨 (원본)" },
  pb_revealed_label: { mn: "Илчилсэн", en: "Revealed", kr: "공개됨" },
  pb_authority_director_hint: { mn: "Director — бүх нүүрийг reveal хийх эрхтэй (chain level 0)", en: "Director — may reveal every face (chain level 0)", kr: "Director — 모든 얼굴을 공개할 수 있음 (chain level 0)" },
  pb_authority_level: { mn: "Reveal эрх", en: "Reveal authority", kr: "공개 권한" },
  pb_authority_min_chain: { mn: "unseal хийх нүүрний chain_index доод хязгаар:", en: "minimum chain_index to unseal:", kr: "unseal 가능한 최소 chain_index:" },
  pb_level: { mn: "Түвшин", en: "Level", kr: "레벨" },
  // settings
  set_totp_title: { mn: "TOTP хоёр шатлалт баталгаажуулалт", en: "TOTP two-factor authentication", kr: "TOTP 2단계 인증" },
  set_totp_desc: { mn: "Google Authenticator / Authy / 1Password зэрэг app-аар нэмэлт хамгаалалт", en: "Add a second factor with Google Authenticator, Authy, 1Password, etc.", kr: "Google Authenticator / Authy / 1Password 등의 앱으로 보안을 강화합니다" },
  set_totp_setup_failed: { mn: "TOTP тохируулах алдаа", en: "Setup failed", kr: "설정 실패" },
  set_totp_verify_failed: { mn: "Код шалгах алдаа", en: "Verification failed", kr: "확인 실패" },
  set_totp_disable_failed: { mn: "Унтраах алдаа", en: "Could not disable TOTP", kr: "TOTP 비활성화 실패" },
  set_totp_enabled_msg: { mn: "✓ TOTP 2FA идэвхжлээ!", en: "✓ TOTP 2FA enabled!", kr: "✓ TOTP 2FA가 활성화되었습니다!" },
  set_totp_relogin: { mn: "Хоёр дахь хүчин зүйл идэвхжсэн тул одоогийн сесс хаагдлаа — сэргээх кодоо хадгалаад дахин нэвтэрнэ үү.", en: "Your current session ended when the second factor was enabled — save the recovery codes, then sign in again.", kr: "2단계 인증을 켜면서 현재 세션이 종료되었습니다 — 복구 코드를 저장한 뒤 다시 로그인하세요." },
  set_totp_disabled_msg: { mn: "TOTP унтраагдлаа", en: "TOTP disabled", kr: "TOTP가 비활성화되었습니다" },
  set_disable: { mn: "Унтраах", en: "Disable", kr: "비활성화" },
  set_totp_step1: { mn: "1. Google Authenticator эсвэл Authy-г нээнэ", en: "1. Open Google Authenticator or Authy", kr: "1. Google Authenticator 또는 Authy를 엽니다" },
  set_totp_step2: { mn: "2. + дарж \"Scan QR code\"-г сонгоно", en: "2. Tap + → \"Scan QR code\"", kr: "2. + 를 누르고 \"Scan QR code\"를 선택합니다" },
  set_totp_step3: { mn: "3. Доорх QR-ыг уншуулаад гарч ирсэн 6 оронтой кодыг оруулна", en: "3. Scan the QR below and enter the 6-digit code shown", kr: "3. 아래 QR을 스캔하고 표시된 6자리 코드를 입력합니다" },
  set_totp_manual_secret: { mn: "QR ажиллахгүй бол энэ secret-ийг гараар оруулна уу", en: "If the QR doesn't work, enter this secret manually", kr: "QR이 작동하지 않으면 이 시크릿을 직접 입력하세요" },
  set_totp_code_placeholder: { mn: "6 оронтой код", en: "6-digit code", kr: "6자리 코드" },
  set_totp_code_label: { mn: "TOTP 6 оронтой код", en: "TOTP 6-digit code", kr: "TOTP 6자리 코드" },
  set_totp_disable_warning: { mn: "⚠️ TOTP-г унтраавал таны бүртгэл зөвхөн нууц үгээр хамгаалагдана.", en: "⚠️ Disabling TOTP leaves your account protected by the password only.", kr: "⚠️ TOTP를 비활성화하면 계정이 비밀번호로만 보호됩니다." },
  set_password_confirm_placeholder: { mn: "Нууц үг (баталгаажуулахад)", en: "Password (to confirm)", kr: "비밀번호 (확인용)" },
  set_pk_desc: { mn: "Phishing-эсэргүүцэх, hardware-backed нэвтрэлт — iCloud Keychain, Windows Hello, Android, YubiKey. PIN / biometric шаардлагатай тул passkey нь өөрөө хоёр дахь фактор болно; нэмэх, устгахад шинэ TOTP баталгаажуулалт шаардлагатай.", en: "Phishing-resistant, hardware-backed sign-in — iCloud Keychain, Windows Hello, Android, YubiKey. PIN / biometrics are required, so a passkey is a second factor on its own; adding or removing one needs a fresh TOTP check.", kr: "피싱에 강한 하드웨어 기반 로그인 — iCloud Keychain, Windows Hello, Android, YubiKey. PIN / 생체 인증이 필요하므로 패스키 자체가 2단계 인증이 됩니다. 추가·삭제 시 새로운 TOTP 인증이 필요합니다." },
  set_pk_add: { mn: "Passkey нэмэх", en: "Add passkey", kr: "패스키 추가" },
  set_pk_none: { mn: "Passkey бүртгэгдээгүй", en: "No passkeys registered", kr: "등록된 패스키가 없습니다" },
  set_pk_unnamed: { mn: "Нэргүй passkey", en: "Unnamed passkey", kr: "이름 없는 패스키" },
  set_pk_unsupported_title: { mn: "Энэ browser passkey дэмждэггүй", en: "This browser doesn't support passkeys", kr: "이 브라우저는 패스키를 지원하지 않습니다" },
  set_pk_unsupported_desc: { mn: "WebAuthn API байхгүй — Safari 15+, Chrome 108+, Firefox 122+ эсвэл Edge ашиглана уу.", en: "WebAuthn API missing — use Safari 15+, Chrome 108+, Firefox 122+ or Edge.", kr: "WebAuthn API가 없습니다 — Safari 15+, Chrome 108+, Firefox 122+ 또는 Edge를 사용하세요." },
  set_pk_load_failed: { mn: "Passkey жагсаалт ачаалагдсангүй", en: "Failed to load passkeys", kr: "패스키를 불러오지 못했습니다" },
  set_pk_cannot_start: { mn: "Бүртгэл эхлүүлж чадсангүй", en: "Could not start enrolment", kr: "등록을 시작할 수 없습니다" },
  set_pk_user_cancelled: { mn: "Хэрэглэгч цуцаллаа", en: "Cancelled by user", kr: "사용자가 취소했습니다" },
  set_pk_verify_failed: { mn: "Баталгаажуулалт амжилтгүй", en: "Verification failed", kr: "검증 실패" },
  set_pk_enrolled: { mn: "Passkey бүртгэгдлээ", en: "Passkey registered", kr: "패스키가 등록되었습니다" },
  set_pk_enroll_failed: { mn: "Passkey бүртгэл амжилтгүй", en: "Enrolment failed", kr: "패스키 등록 실패" },
  set_pk_deleted: { mn: "Passkey устгагдлаа", en: "Passkey deleted", kr: "패스키가 삭제되었습니다" },
  set_pk_delete_failed: { mn: "Устгаж чадсангүй", en: "Delete failed", kr: "삭제 실패" },
  set_push_no_vapid: { mn: "Push түлхүүр (VAPID) тохируулаагүй", en: "Push key (VAPID) not configured", kr: "푸시 키(VAPID)가 설정되지 않았습니다" },
  set_push_invalid_sub: { mn: "Subscription буруу байна", en: "Invalid subscription", kr: "잘못된 구독입니다" },
  set_push_subscribe_failed: { mn: "Subscribe амжилтгүй", en: "Subscribe failed", kr: "구독 실패" },
  set_push_test_failed: { mn: "Туршилт амжилтгүй", en: "Test failed", kr: "테스트 실패" },
  set_push_delete_failed: { mn: "Устгаж чадсангүй", en: "Delete failed", kr: "삭제 실패" },
  set_push_none_deliverable: { mn: "Хүргэх боломжтой subscription алга.", en: "No deliverable subscriptions yet.", kr: "전달 가능한 구독이 아직 없습니다." },
  set_push_test_sent: { mn: "Туршилт илгээлээ", en: "Test sent", kr: "테스트 전송됨" },
  set_push_none: { mn: "Subscription алга", en: "No subscriptions", kr: "구독 없음" },
  set_erase_failed: { mn: "Устгаж чадсангүй", en: "Erase failed", kr: "삭제 실패" },
  set_erase_irreversible: { mn: "⚠ Энэ үйлдэл буцаашгүй.", en: "⚠ This action cannot be undone.", kr: "⚠ 이 작업은 되돌릴 수 없습니다." },
  set_erase_li_profile: { mn: "Профайл устгагдана", en: "Your profile is deleted", kr: "프로필이 삭제됩니다" },
  set_erase_li_auth: { mn: "Нэвтрэх бүртгэл устгагдана (дахин нэвтрэх боломжгүй)", en: "Your login is deleted (you can no longer sign in)", kr: "로그인 계정이 삭제됩니다 (더 이상 로그인 불가)" },
  set_erase_li_audit: { mn: "Audit log хадгалагдана — гэхдээ user_id NULL болж anonymise хийгдэнэ", en: "Audit log entries are kept but anonymised (user_id set to NULL)", kr: "감사 로그는 보존되지만 익명화됩니다 (user_id → NULL)" },
  set_erase_li_labels: { mn: "Таны өгсөн шошго болон reveal job-ууд хадгалагдаж, холбоос нь NULL болно", en: "Your labels and reveal jobs are kept with the reference set to NULL", kr: "라벨과 공개 작업은 보존되며 참조는 NULL로 설정됩니다" },
  set_erase_li_perms: { mn: "Камерын бүх эрх цуцлагдана", en: "All camera permissions are revoked", kr: "모든 카메라 권한이 취소됩니다" },
  set_erase_li_last_admin: { mn: "Хэрэв та сүүлчийн admin бол өөр admin томилох хүртэл устгах боломжгүй.", en: "If you are the last admin, deletion is blocked until another admin is appointed.", kr: "마지막 관리자인 경우 다른 관리자를 지정할 때까지 삭제할 수 없습니다." },
  set_erase_email_label: { mn: "Имэйл (баталгаа)", en: "Email (for confirmation)", kr: "이메일 (확인용)" },
  set_erase_confirm_label: { mn: "Үнэхээр устгахыг хүсэж байгаагаа баталгаажуулна уу", en: "Confirm that you really want to erase your account", kr: "정말 삭제할 것인지 확인하세요" },
  set_erase_confirm_placeholder: { mn: "DELETE MY ACCOUNT гэж бичнэ үү", en: "Type DELETE MY ACCOUNT", kr: "DELETE MY ACCOUNT 를 입력하세요" },
  // live
  live_recorder_unsupported: { mn: "MediaRecorder дэмжигдээгүй", en: "MediaRecorder not supported", kr: "MediaRecorder를 지원하지 않습니다" },
  live_upload_unconfirmed: { mn: "Сервер бичлэгийг хүлээн авснаа баталгаажуулсангүй. Дахин илгээнэ үү.", en: "The server did not confirm receipt. Retry the upload.", kr: "서버 수신 확인이 없습니다. 업로드를 다시 시도하세요." },
  live_upload_retained: { mn: "Илгээгдээгүй бичлэг энэ хуудсанд хадгалагдсан. Дахин илгээж дуустал хуудсаа нээлттэй байлгана уу.", en: "Unsent footage is kept on this page. Keep it open until the retry finishes.", kr: "전송하지 못한 영상이 이 페이지에 보관되어 있습니다. 재시도가 끝날 때까지 열어 두세요." },
  live_retry_upload: { mn: "Бичлэгийг дахин илгээх", en: "Retry recording upload", kr: "녹화 업로드 재시도" },
  cam_stop_pending: { mn: "Зогсоох хүсэлт хадгалагдсан. Камер зогссоныг хараахан баталгаажуулаагүй.", en: "Stop requested. Capture has not yet been confirmed stopped.", kr: "중지 요청이 저장되었습니다. 촬영 중지는 아직 확인되지 않았습니다." },
  cam_ml_unreachable: { mn: "Камерын сервис холбогдохгүй байна. Бодит төлөвийг шалгах боломжгүй.", en: "Camera service is unreachable. Actual capture status is unavailable.", kr: "카메라 서비스에 연결할 수 없어 실제 촬영 상태를 확인할 수 없습니다." },
  cam_update_failed: { mn: "Камерын төлөвийг хадгалж чадсангүй. Дахин оролдоно уу.", en: "Could not save camera state. Please retry.", kr: "카메라 상태를 저장하지 못했습니다. 다시 시도하세요." },
  live_chunk_upload_failed: { mn: "Chunk upload алдаа", en: "Chunk upload failed", kr: "청크 업로드 실패" },
  live_chunk_failed: { mn: "амжилтгүй", en: "failed", kr: "실패" },
  live_chunk_too_big: { mn: "Chunk хэт том — Vercel 4MB лимит", en: "Chunk too large — Vercel 4MB limit", kr: "청크가 너무 큽니다 — Vercel 4MB 제한" },
  live_processing_started: { mn: "Боловсруулалт ажиллаж байна.", en: "Processing has started.", kr: "처리가 시작되었습니다." },
  live_ml_timeout: { mn: "ML боловсруулалт хэт удсан (Vercel function timeout)", en: "ML processing took too long (Vercel function timeout)", kr: "ML 처리 시간이 너무 깁니다 (Vercel 함수 시간 초과)" },
  live_ml_timeout_long: { mn: "ML боловсруулалт хэт удсан (Vercel function timeout). Chunk-ийн хэмжээг багасгах эсвэл Pro tier руу шилжих хэрэгтэй.", en: "ML processing took too long (Vercel function timeout). Reduce the chunk size or move to the Pro tier.", kr: "ML 처리 시간이 너무 깁니다 (Vercel 함수 시간 초과). 청크 크기를 줄이거나 Pro 요금제로 전환하세요." },
  live_server_error: { mn: "Серверийн алдаа", en: "Server error", kr: "서버 오류" },
  live_opt_mjpeg: { mn: "MJPEG (IP Webcam app-ийн үндсэн)", en: "MJPEG (IP Webcam app default)", kr: "MJPEG (IP Webcam 앱 기본값)" },
  live_opt_mp4: { mn: "MP4 / WebM stream", en: "MP4 / WebM stream", kr: "MP4 / WebM 스트림" },
  live_hint_android: { mn: "\"IP Webcam\" app (Pavel Khlebovich) суулгаад \"Start server\" дарна → http://phone-ip:8080/video", en: "Install the \"IP Webcam\" app (Pavel Khlebovich), tap \"Start server\" → http://phone-ip:8080/video", kr: "\"IP Webcam\" 앱(Pavel Khlebovich)을 설치하고 \"Start server\"를 누르세요 → http://phone-ip:8080/video" },
  live_hint_iphone: { mn: "\"EpocCam\" эсвэл \"iVCam\" app", en: "\"EpocCam\" or \"iVCam\" app", kr: "\"EpocCam\" 또는 \"iVCam\" 앱" },
  live_hint_same_wifi: { mn: "Утас болон компьютер нэг WiFi-д байх ёстой", en: "Phone and computer must be on the same Wi-Fi", kr: "휴대폰과 컴퓨터가 같은 Wi-Fi에 있어야 합니다" },
  live_hint_exact_url: { mn: "App-аас гарч буй URL-ийг яг тэр хэлбэрээр оруулна", en: "Enter the URL exactly as the app shows it", kr: "앱에 표시된 URL을 그대로 입력하세요" },
  live_file_label: { mn: "Файл", en: "File", kr: "파일" },
  live_size_label: { mn: "Хэмжээ", en: "Size", kr: "크기" },
  live_uploading_chunk: { mn: "Chunk илгээж байна", en: "Uploading chunk", kr: "청크 업로드 중" },
  live_uploading: { mn: "Илгээж байна…", en: "Uploading…", kr: "업로드 중…" },
  live_upload_done: { mn: "Upload амжилттай.", en: "Upload complete.", kr: "업로드 완료." },
  live_upload_done_hint: { mn: "Server ML боловсруулалт эхэлсэн — /playback дотор ~30–60 секундын дараа харагдана.", en: "Server ML processing has started — it appears under /playback in ~30–60 s.", kr: "서버 ML 처리가 시작되었습니다 — 약 30–60초 후 /playback 에 표시됩니다." },
  live_upload_failed: { mn: "Upload алдаа", en: "Upload failed", kr: "업로드 실패" },
  live_file_too_big: { mn: "Файл 100 MB upload лимитээс хэтэрсэн байна. Урт бичлэгт бүртгэлтэй IP камер ашиглана уу.", en: "This file exceeds the 100 MB upload limit. Use a registered IP camera for longer recordings.", kr: "파일이 100 MB 업로드 제한을 초과합니다. 더 긴 녹화는 등록된 IP 카메라를 사용하세요." },
  live_tips_label: { mn: "Зөвлөмж:", en: "Tips:", kr: "팁:" },
  live_tips_text: { mn: "Файл upload 100 MB-аар хязгаарлагдана. Илүү урт бичлэгийг бүртгэлтэй RTSP / IP камераар шууд аваарай. Богино test файл бэлтгэх жишээ:", en: "File uploads are limited to 100 MB. Capture longer recordings directly from a registered RTSP / IP camera. To prepare a short test file:", kr: "파일 업로드는 100 MB로 제한됩니다. 더 긴 녹화는 등록된 RTSP / IP 카메라에서 직접 캡처하세요. 짧은 테스트 파일을 만들려면:" },
  // webhooks
  wh_empty: { mn: "Webhook бүртгэгдээгүй", en: "No webhooks yet", kr: "등록된 웹훅이 없습니다" },
  wh_empty_desc: { mn: "Slack, Discord эсвэл HMAC гарын үсэгтэй generic destination нэмээрэй.", en: "Add a Slack, Discord or HMAC-signed generic destination.", kr: "Slack, Discord 또는 HMAC 서명 일반 대상을 추가하세요." },
  wh_new: { mn: "Шинэ webhook", en: "New webhook", kr: "새 웹훅" },
  wh_created: { mn: "Webhook үүслээ", en: "Webhook created", kr: "웹훅이 생성되었습니다" },
  wh_secret_note: { mn: "Generic webhook-ийн HMAC signing secret. Дахин харагдахгүй — одоо хадгална уу.", en: "HMAC signing secret for the generic webhook. It won't be shown again — save it now.", kr: "일반 웹훅의 HMAC 서명 시크릿입니다. 다시 표시되지 않으니 지금 저장하세요." },
  wh_copy: { mn: "Хуулах", en: "Copy", kr: "복사" },
  wh_name_placeholder: { mn: "Нэр (жш: 'Security alerts → Slack')", en: "Name (e.g. 'Security alerts → Slack')", kr: "이름 (예: 'Security alerts → Slack')" },
  wh_kind_generic: { mn: "Generic (HMAC гарын үсэгтэй)", en: "Generic (HMAC signed)", kr: "일반 (HMAC 서명)" },
  wh_url_placeholder: { mn: "https://hooks.slack.com/… эсвэл https://discord.com/api/webhooks/…", en: "https://hooks.slack.com/… or https://discord.com/api/webhooks/…", kr: "https://hooks.slack.com/… 또는 https://discord.com/api/webhooks/…" },
  wh_events_label: { mn: "Илгээх event-ууд", en: "Events to send", kr: "전송할 이벤트" },
  wh_ev_alert_created: { mn: "Шинэ alert үүсэх", en: "New alert created", kr: "새 알림 생성" },
  wh_ev_reveal_completed: { mn: "Reveal job дуусах", en: "Reveal job completed", kr: "공개 작업 완료" },
  wh_ev_system_health: { mn: "System health алдаа", en: "System health failure", kr: "시스템 상태 오류" },
  wh_ev_audit_critical: { mn: "Чухал аудит үйлдэл", en: "Critical audit action", kr: "중요 감사 작업" },
  wh_col_events: { mn: "Event-ууд", en: "Events", kr: "이벤트" },
  wh_col_last: { mn: "Сүүлд", en: "Last fired", kr: "마지막 전송" },
  wh_never: { mn: "хэзээ ч", en: "never", kr: "없음" },
  wh_fail: { mn: "алдаа", en: "failed", kr: "실패" },
  wh_test: { mn: "Тест илгээх", en: "Send test", kr: "테스트 전송" },
  wh_delete_confirm: { mn: "Энэ webhook-ийг устгах уу?", en: "Delete this webhook?", kr: "이 웹훅을 삭제하시겠습니까?" },
  wh_err_invalid: { mn: "Буруу өгөгдөл", en: "Invalid input", kr: "잘못된 입력" },
  wh_err_url_invalid: { mn: "URL буруу байна", en: "Invalid URL", kr: "잘못된 URL" },
  wh_err_url_https: { mn: "URL нь HTTPS байх ёстой", en: "URL must use HTTPS", kr: "URL은 HTTPS여야 합니다" },
  wh_err_url_private: { mn: "URL нь дотоод / private host руу заасан байна (SSRF хамгаалалт)", en: "URL points to a private / internal host (blocked for SSRF)", kr: "URL이 사설 / 내부 호스트를 가리킵니다 (SSRF 차단)" },
  wh_err_create: { mn: "Webhook үүсгэж чадсангүй", en: "Could not create webhook", kr: "웹훅을 생성할 수 없습니다" },
  // ── notifications: reveal requests, ML uptime ──
  wh_ev_reveal_requested: { mn: "Reveal хүсэлт ирэх (4-eyes зөвшөөрөл хүлээж буй)", en: "Reveal request awaiting 4-eyes approval", kr: "공개 요청 접수 (4-eyes 승인 대기)" },
  // ── cameras: demo type + dialog + grid focus ──
  camd_title_add: { mn: "Камер нэмэх", en: "Add camera", kr: "카메라 추가" },
  camd_title_edit: { mn: "Камер засах", en: "Edit camera", kr: "카메라 수정" },
  camd_desc_add: { mn: "Шинэ камер нэмэхийн өмнө URL-ийг шалгаж болно.", en: "You can test the URL before adding the camera.", kr: "카메라를 추가하기 전에 URL을 테스트할 수 있습니다." },
  camd_desc_edit: { mn: "Нэр, URL, төрөл солих. Хадгалахад нууц үгээ дахин асууж магадгүй.", en: "Change the name, URL or type. Saving may ask you to re-authenticate.", kr: "이름, URL, 유형을 변경합니다. 저장 시 재인증을 요구할 수 있습니다." },
  camd_name_placeholder: { mn: "жишээ: Үүдний камер", en: "e.g. Front door camera", kr: "예: 정문 카메라" },
  camd_url: { mn: "URL", en: "URL", kr: "URL" },
  camd_type_rtsp: { mn: "RTSP", en: "RTSP", kr: "RTSP" },
  camd_type_http: { mn: "HTTP / MJPEG", en: "HTTP / MJPEG", kr: "HTTP / MJPEG" },
  camd_type_usb: { mn: "USB (ML host-ын локал)", en: "USB (local to the ML host)", kr: "USB (ML 호스트 로컬)" },
  camd_type_webcam: { mn: "Webcam (browser)", en: "Webcam (browser)", kr: "웹캠 (브라우저)" },
  camd_type_demo: { mn: "Demo (суулгасан жишээ)", en: "Demo (built-in sample)", kr: "데모 (내장 샘플)" },
  camd_ph_rtsp: { mn: "rtsp://user:pass@192.168.1.10:554/cam/realmonitor", en: "rtsp://user:pass@192.168.1.10:554/cam/realmonitor", kr: "rtsp://user:pass@192.168.1.10:554/cam/realmonitor" },
  camd_ph_http: { mn: "http://192.168.1.10/cgi-bin/snapshot.cgi", en: "http://192.168.1.10/cgi-bin/snapshot.cgi", kr: "http://192.168.1.10/cgi-bin/snapshot.cgi" },
  camd_ph_usb: { mn: "/dev/video0 эсвэл 0", en: "/dev/video0 or 0", kr: "/dev/video0 또는 0" },
  camd_ph_webcam: { mn: "browser", en: "browser", kr: "browser" },
  camd_ph_demo: { mn: "demo://lobby", en: "demo://lobby", kr: "demo://lobby" },
  camd_hint_rtsp: { mn: "RTSP — Dahua/Hikvision гэх мэт IP CCTV. user:pass URL дотор.", en: "RTSP — IP CCTV such as Dahua/Hikvision. Put user:pass in the URL.", kr: "RTSP — Dahua/Hikvision 등 IP CCTV. user:pass 를 URL에 포함하세요." },
  camd_hint_http: { mn: "MJPEG / snapshot URL — Hikvision ISAPI, IP Webcam app г.м.", en: "MJPEG / snapshot URL — Hikvision ISAPI, IP Webcam app, etc.", kr: "MJPEG / 스냅샷 URL — Hikvision ISAPI, IP Webcam 앱 등." },
  camd_hint_usb: { mn: "ML host-ын локал USB камер. Энэ төрлийг ML-аас шалгахгүй.", en: "USB camera attached to the ML host. This type cannot be tested from ML.", kr: "ML 호스트에 연결된 USB 카메라. 이 유형은 ML에서 테스트할 수 없습니다." },
  camd_hint_webcam: { mn: "Browser getUserMedia. Энэ төрөл нь /live page-аас л ажиллана.", en: "Browser getUserMedia. This type only works from the /live page.", kr: "브라우저 getUserMedia. 이 유형은 /live 페이지에서만 동작합니다." },
  camd_hint_demo: { mn: "ML service-д суулгасан синтетик давтагдах бичлэг (нүүртэй). Нэр: demo://lobby, demo://gate, demo://parking — физик камер шаардлагагүй.", en: "Synthetic looping clip with faces, built into the ML service. Names: demo://lobby, demo://gate, demo://parking — no physical camera needed.", kr: "ML 서비스에 내장된 얼굴이 포함된 합성 반복 영상. 이름: demo://lobby, demo://gate, demo://parking — 실제 카메라가 필요 없습니다." },
  camd_test_title: { mn: "Холболт шалгах", en: "Test connection", kr: "연결 테스트" },
  camd_test_btn: { mn: "Шалгах", en: "Test", kr: "테스트" },
  camd_test_idle_local: { mn: "Энэ төрлийг ML-аас шалгах боломжгүй (browser/локал төхөөрөмж).", en: "This type cannot be tested from ML (browser / local device).", kr: "이 유형은 ML에서 테스트할 수 없습니다 (브라우저 / 로컬 장치)." },
  camd_test_idle_net: { mn: "URL хүрэх эсэх + frame унших боломжтой эсэхийг ML 8 сек-ийн дотор шалгана.", en: "ML checks within 8 s that the URL is reachable and a frame can be read.", kr: "ML이 8초 이내에 URL 접근 가능 여부와 프레임 읽기 가능 여부를 확인합니다." },
  camd_test_idle_demo: { mn: "Суулгасан жишээг ML шууд шалгана — нэр нь lobby / gate / parking-ийн аль нэг байх ёстой.", en: "ML checks the built-in sample instantly — the name must be lobby, gate or parking.", kr: "ML이 내장 샘플을 즉시 확인합니다 — 이름은 lobby / gate / parking 중 하나여야 합니다." },
  camd_test_running: { mn: "Холбогдож байна… (≤8s)", en: "Connecting… (≤8 s)", kr: "연결 중… (≤8초)" },
  camd_test_ok: { mn: "Амжилттай", en: "Success", kr: "성공" },
  camd_test_fail: { mn: "Амжилтгүй", en: "Failed", kr: "실패" },
  camd_err_unknown: { mn: "Тодорхойгүй алдаа", en: "Unknown error", kr: "알 수 없는 오류" },
  cam_badge_demo: { mn: "DEMO", en: "DEMO", kr: "DEMO" },
  cam_badge_demo_title: { mn: "Суулгасан жишээ эх сурвалж — физик камер биш", en: "Built-in sample source — not a physical camera", kr: "내장 샘플 소스 — 실제 카메라가 아닙니다" },
  cam_live_open_grid: { mn: "Одоо стрийм хийж байна — grid дээр нээх", en: "Streaming now — open in the grid", kr: "지금 스트리밍 중 — 그리드에서 열기" },
  // ── alert workflow: states ──
  al_state: { mn: "Төлөв", en: "State", kr: "상태" },
  al_state_new: { mn: "Шинэ", en: "New", kr: "신규" },
  al_state_acknowledged: { mn: "Хүлээн авсан", en: "Acknowledged", kr: "확인됨" },
  al_state_closed: { mn: "Хаагдсан", en: "Closed", kr: "종료됨" },
  al_ack: { mn: "Хүлээн авах", en: "Acknowledge", kr: "확인" },
  al_close: { mn: "Хаах", en: "Close", kr: "종료" },
  al_reopen: { mn: "Дахин нээх", en: "Reopen", kr: "다시 열기" },
  al_note: { mn: "Тэмдэглэл", en: "Note", kr: "메모" },
  al_note_placeholder: { mn: "Хэрхэн шийдвэрлэсэн, шалтгаан… (заавал биш, 500 тэмдэгт хүртэл)", en: "How it was resolved, reason… (optional, up to 500 characters)", kr: "처리 내용, 사유… (선택, 최대 500자)" },
  al_close_title: { mn: "Alert хаах", en: "Close alert", kr: "알림 종료" },
  al_close_confirm: { mn: "Хаах", en: "Close alert", kr: "종료하기" },
  al_tab_all: { mn: "Бүгд", en: "All", kr: "전체" },
  al_state_saved: { mn: "Төлөв хадгалагдлаа", en: "State updated", kr: "상태가 저장되었습니다" },
  al_state_failed: { mn: "Төлөв солиход алдаа гарлаа", en: "Could not update state", kr: "상태를 변경할 수 없습니다" },
  rt_ack: { mn: "Хүлээн авах", en: "Acknowledge", kr: "확인" },
  al_new_count: { mn: "шинэ", en: "new", kr: "신규" },
  // ── review fixes (camera errors, ack feedback, TOTP hint) ──
  camd_err_required: { mn: "Нэр болон URL заавал", en: "Name and URL are required", kr: "이름과 URL은 필수입니다" },
  camd_err_type: { mn: "Камерын төрөл буруу", en: "Invalid camera type", kr: "카메라 유형이 잘못되었습니다" },
  camd_err_url: { mn: "URL төрөлдөө тохирохгүй (rtsp:// · http(s):// · demo://<нэр> эсвэл төхөөрөмжийн дугаар)", en: "URL does not match the type (rtsp:// · http(s):// · demo://<name> or a device index)", kr: "URL이 유형과 맞지 않습니다 (rtsp:// · http(s):// · demo://<이름> 또는 장치 번호)" },
  rt_ack_failed: { mn: "Хүлээн авах амжилтгүй", en: "Acknowledge failed", kr: "확인 처리 실패" },
  toast_totp_required: { mn: "TOTP идэвхжүүлээгүй байна — Тохиргоо хэсэгт идэвхжүүлнэ үү", en: "TOTP is not enabled — enable it under Settings", kr: "TOTP가 활성화되지 않았습니다 — 설정에서 활성화하세요" },
  // ── Backup: what the artifact can and cannot restore ──
  backup_zip_contents: { mn: "ZIP-д юу байгаа вэ", en: "What is in the ZIP", kr: "ZIP에 들어 있는 것" },
  backup_zip_tables: {
    mn: "хүснэгт бүрийн мөрүүд JSON-оор (хуудаслаж, хүснэгт тус бүр 50,000 мөр хүртэл)",
    en: "row dumps per table as JSON (paged, up to 50,000 rows each)",
    kr: "테이블별 행 덤프 JSON (페이지 처리, 테이블당 최대 5만 행)",
  },
  backup_zip_buckets: {
    mn: "Storage объектын жагсаалт — DB-ээс гаргасан зам ба bucket тус бүрийн нийт тоо (blob bytes ороогүй)",
    en: "storage object lists — paths derived from the database plus a total per bucket (no blob bytes)",
    kr: "스토리지 객체 목록 — DB에서 도출한 경로와 버킷별 총계 (blob 바이트 없음)",
  },
  backup_zip_manifest: {
    mn: "багана бүрийн жагсаалт, мөрийн тоо, сэргээх хязгаарууд (машин уншихад зориулсан)",
    en: "column lists, row counts and restore limits (machine-readable)",
    kr: "컬럼 목록, 행 수, 복원 한계 (기계 판독용)",
  },
  backup_zip_readme: {
    mn: "хүн уншихад зориулсан тайлбар + сэргээх алхмууд",
    en: "human-readable summary + restore steps",
    kr: "사람이 읽는 요약 + 복원 절차",
  },
  backup_include_biometrics: {
    mn: "Биометрик embedding-ийг оруулах (suspects.embedding, faces.embedding)",
    en: "Include biometric embeddings (suspects.embedding, faces.embedding)",
    kr: "생체 임베딩 포함 (suspects.embedding, faces.embedding)",
  },
  backup_include_biometrics_help: {
    mn: "512 хэмжээст ArcFace вектор нь хүнийг таних биометрик хувийн мэдээлэл. Зөвхөн энэ сонголттой архиваас `suspects` болон `faces` хүснэгтийг сэргээж чадна. Татахад TOTP дахин баталгаажуулалт шаардана, audit_log-д BACKUP_DOWNLOAD_BIOMETRIC гэж тусад нь бүртгэгдэнэ. Файлыг шифрлэсэн хадгалалтад л байлга.",
    en: "A 512-dim ArcFace vector identifies the person it was computed from — biometric personal data. Only an export with this box ticked can restore `suspects` and `faces`. It requires fresh TOTP step-up and is audited separately as BACKUP_DOWNLOAD_BIOMETRIC. Keep the file in encrypted storage only.",
    kr: "512차원 ArcFace 벡터는 해당 인물을 식별하는 생체 개인정보입니다. 이 항목을 선택한 내보내기만 `suspects` 와 `faces` 를 복원할 수 있습니다. 최신 TOTP 재인증이 필요하며 BACKUP_DOWNLOAD_BIOMETRIC 으로 별도 감사 기록됩니다. 파일은 암호화된 저장소에만 보관하세요.",
  },
  backup_limits_title: {
    mn: "Энэ архиваас юуг сэргээх боломжгүй вэ",
    en: "What this artifact cannot restore",
    kr: "이 아카이브로 복원할 수 없는 것",
  },
  backup_limits_biometric: {
    mn: "Дээрх сонголтгүйгээр `suspects`, `faces` хүснэгтийг сэргээх боломжгүй: suspects.embedding, faces.embedding нь NOT NULL боловч экспортод ордоггүй. Нүүр таних чадвар сэргэхгүй.",
    en: "Without the box above, `suspects` and `faces` cannot be restored: suspects.embedding and faces.embedding are NOT NULL but are not exported. Face matching does not come back.",
    kr: "위 옵션 없이는 `suspects` 와 `faces` 를 복원할 수 없습니다. suspects.embedding 과 faces.embedding 은 NOT NULL 이지만 내보내지 않습니다. 얼굴 매칭 기능은 복구되지 않습니다.",
  },
  backup_limits_auth: {
    mn: "Supabase auth.users (нууц үг, сесс, identity) экспортод ОРДОГГҮЙ. profiles.id нь түүн рүү FK-тай тул эхлээд хэрэглэгчдийг дахин үүсгэх/урих (эсвэл auth схемийг PITR-ээр сэргээх) хэрэгтэй. TOTP түлхүүр, recovery код, passkey мөн ордоггүй — операторууд 2FA-гаа дахин бүртгүүлнэ.",
    en: "Supabase auth.users (passwords, sessions, identities) is NOT exported. profiles.id is a FK onto it, so recreate or re-invite the accounts first (or restore the auth schema from PITR). TOTP seeds, recovery codes and passkeys are excluded too — operators re-enrol 2FA.",
    kr: "Supabase auth.users(비밀번호, 세션, ID)는 내보내지 않습니다. profiles.id 가 이를 참조하므로 계정을 먼저 다시 만들거나 초대해야 합니다(또는 PITR 로 auth 스키마 복원). TOTP 시크릿, 복구 코드, 패스키도 제외됩니다 — 운영자는 2FA 를 다시 등록합니다.",
  },
  backup_limits_secrets: {
    mn: "webhooks.url ба HMAC secret, push_subscriptions-ийн endpoint/p256dh/auth нь итгэмжлэл тул хэзээ ч экспортлогддоггүй — тэр хоёр хүснэгт зөвхөн лавлагаа. Камерын url нь CAMERA_URL_KEY-ээр шифрлэгдсэн хэвээр экспортлогддог: тэр түлхүүргүй бол унших боломжгүй.",
    en: "webhooks.url + the HMAC secret and push_subscriptions endpoint/p256dh/auth are credentials and are never exported — those two tables are reference-only. cameras.url ships as the CAMERA_URL_KEY ciphertext: without that key it stays unreadable.",
    kr: "webhooks.url 과 HMAC 시크릿, push_subscriptions 의 endpoint/p256dh/auth 는 자격증명이므로 내보내지 않습니다 — 두 테이블은 참조용입니다. cameras.url 은 CAMERA_URL_KEY 로 암호화된 상태로 포함되며, 그 키 없이는 읽을 수 없습니다.",
  },
  backup_limits_storage: {
    mn: "Storage-ийн blob bytes ZIP-д ороогүй. Manifest нь DB-ээс (recordings.storage_path/original_path, faces.image_path + .enc, suspects.image_path, alerts.screenshot_path, reveal_jobs.output_path) гаргасан бүрэн жагсаалт ба bucket тус бүрийн нийт тоог агуулна — сэргээлт бүрэн эсэхийг түүгээр шалгана.",
    en: "Storage blob bytes are not in the ZIP. The manifest lists every path the database references (recordings.storage_path/original_path, faces.image_path + .enc, suspects.image_path, alerts.screenshot_path, reveal_jobs.output_path) plus a total per bucket — check a restore for completeness against those totals.",
    kr: "스토리지 blob 바이트는 ZIP 에 없습니다. 매니페스트에는 DB 가 참조하는 모든 경로(recordings.storage_path/original_path, faces.image_path + .enc, suspects.image_path, alerts.screenshot_path, reveal_jobs.output_path)와 버킷별 총계가 들어 있어 복원 완전성을 확인할 수 있습니다.",
  },
  backup_audited_as: {
    mn: "Үйлдэл audit_log-д бүртгэгдэнэ:",
    en: "Audited in audit_log as:",
    kr: "audit_log 에 다음으로 기록됩니다:",
  },
  // ── live stream refusals (/api/ml/stream returns a `code`; the tile shows why) ──
  grid_stream_forbidden: { mn: "Энэ камерыг шууд үзэх эрх олгогдоогүй", en: "You do not have live access to this camera", kr: "이 카메라의 실시간 영상 접근 권한이 없습니다" },
  grid_stream_disabled: { mn: "Камер идэвхгүй байна", en: "Camera is disabled", kr: "카메라가 비활성화되어 있습니다" },

  // ── /users refusals (server actions return these strings verbatim) ──
  users_err_invalid_input: { mn: "Оруулсан утга буруу байна", en: "Invalid input", kr: "입력값이 올바르지 않습니다" },
  users_err_password_short: { mn: "Нууц үг дор хаяж 8 тэмдэгт байх ёстой", en: "The password must be at least 8 characters", kr: "비밀번호는 8자 이상이어야 합니다" },
  users_err_role_self: { mn: "Өөрийн role-оо өөрчлөх боломжгүй", en: "You cannot change your own role", kr: "본인의 역할은 변경할 수 없습니다" },
  users_err_delete_self: { mn: "Өөрийгөө устгах боломжгүй", en: "You cannot delete yourself", kr: "본인 계정은 삭제할 수 없습니다" },
  users_err_last_admin: { mn: "Сүүлчийн admin-ыг устгах боломжгүй", en: "Cannot delete the last admin", kr: "마지막 관리자는 삭제할 수 없습니다" },
  users_err_admin_super_only: { mn: "Админ эрхтэй хэрэглэгчийг зөвхөн super admin үүсгэж, дэвшүүлж чадна", en: "Only the super admin can create or promote an admin account", kr: "관리자 계정은 슈퍼 관리자만 생성하거나 승격할 수 있습니다" },
  users_err_reset_admin_no_totp: { mn: "2FA идэвхжүүлээгүй админы нууц үгийг зөвхөн super admin сольж чадна", en: "Only the super admin can reset the password of an admin who has not enabled 2FA", kr: "2단계 인증을 설정하지 않은 관리자의 비밀번호는 슈퍼 관리자만 재설정할 수 있습니다" },
  step_up_saved: { mn: "Хадгалагдлаа", en: "Saved", kr: "저장되었습니다" },
  users_err_super_admin_role: { mn: "Super admin-ы role түгжээтэй — Supabase Studio-оос өөрчилнө", en: "The super admin role is locked — change it in Supabase Studio", kr: "슈퍼 관리자 역할은 잠겨 있습니다 — Supabase Studio에서 변경하세요" },
  users_err_super_admin_delete: { mn: "Super admin-ыг устгах боломжгүй — Supabase Studio ашиглана уу", en: "The super admin cannot be deleted — use Supabase Studio", kr: "슈퍼 관리자는 삭제할 수 없습니다 — Supabase Studio를 사용하세요" },
  users_err_super_admin_password: { mn: "Super admin-ы нууц үгийг өөр админ сэргээх боломжгүй", en: "Another admin cannot reset the super admin's password", kr: "다른 관리자는 슈퍼 관리자의 비밀번호를 재설정할 수 없습니다" },

  // ── reveal authority (ADR 0009): lower number = broader authority ──
  users_err_level_range: { mn: "Эрхийн түвшин 0–99 хооронд байх ёстой", en: "The authority level must be between 0 and 99", kr: "권한 수준은 0~99 사이여야 합니다" },
  users_err_level_self: { mn: "Өөрийн эрхийн түвшнийг өөрөө өөрчлөх боломжгүй — өөр админ гүйцэтгэнэ", en: "You cannot change your own authority level — another admin must do it", kr: "본인의 권한 수준은 직접 변경할 수 없습니다 — 다른 관리자가 수행해야 합니다" },
  users_err_level_ceiling: { mn: "Та өөрийнхөө эрхээс өргөн эрх олгож чадахгүй (хамгийн бага нь L{level})", en: "You cannot grant authority broader than your own (lowest you may assign: L{level})", kr: "본인보다 넓은 권한은 부여할 수 없습니다 (지정 가능한 최소 수준: L{level})" },
  users_err_level_target_higher: { mn: "Танаас өргөн эрхтэй операторын түвшнийг өөрчлөх боломжгүй", en: "You cannot change the level of an operator whose authority is broader than yours", kr: "본인보다 넓은 권한을 가진 운영자의 수준은 변경할 수 없습니다" },
  users_err_super_admin_level: { mn: "Super admin director (L0) хэвээр байх ёстой", en: "The super admin must remain director (level 0)", kr: "슈퍼 관리자는 디렉터(0단계)로 유지되어야 합니다" },
  users_err_authority_unavailable: { mn: "Таны эрхийн түвшнийг тодорхойлж чадсангүй. Хэсэг хүлээгээд дахин оролдоно уу", en: "Could not determine your authority level — try again in a moment", kr: "권한 수준을 확인할 수 없습니다 — 잠시 후 다시 시도하세요" },
  users_err_target_missing: { mn: "Хэрэглэгч олдсонгүй", en: "User not found", kr: "사용자를 찾을 수 없습니다" },

  // ── GDPR self-erase refusals (/api/gdpr/delete) ──
  gdpr_err_super_admin: {
    mn: "Super admin бүртгэлээ өөрөө устгах боломжгүй. Энэ данс өгөгдлийн сангийн түвшинд түгжигдсэн — зөвхөн өгөгдлийн сангийн эзэмшигч Supabase Studio-оос (эсвэл шууд SQL сессээр) устгана.",
    en: "The super admin account cannot erase itself. It is locked at the database level — only a database owner can remove it from Supabase Studio (or a direct SQL session).",
    kr: "슈퍼 관리자 계정은 스스로 삭제할 수 없습니다. 이 계정은 데이터베이스 수준에서 잠겨 있으며, 데이터베이스 소유자만 Supabase Studio(또는 직접 SQL 세션)에서 삭제할 수 있습니다.",
  },
  gdpr_err_last_admin: {
    mn: "Сүүлчийн admin бүртгэлийг устгах боломжгүй. Эхлээд өөр хэрэглэгчийг admin болгоно уу.",
    en: "Cannot delete the last admin. Promote another user first.",
    kr: "마지막 관리자 계정은 삭제할 수 없습니다. 먼저 다른 사용자를 관리자로 지정하세요.",
  },

  // ── throttling (lib/rate-limit.ts returns these in `error`; the retry
  //    window is appended by the caller, so no placeholder is needed) ──
  rl_too_many_attempts: {
    mn: "Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.",
    en: "Too many attempts. Please wait and try again.",
    kr: "시도가 너무 많습니다. 잠시 후 다시 시도하세요.",
  },
  rl_unavailable: {
    mn: "Хамгаалалтын тоолуур ажиллахгүй байгаа тул оролдлогыг зогсоолоо. Хэсэг хугацааны дараа дахин оролдоно уу.",
    en: "The protection counter is unavailable, so the attempt was refused. Please try again shortly.",
    kr: "보호 카운터를 사용할 수 없어 시도를 거부했습니다. 잠시 후 다시 시도하세요.",
  },
  rl_totp_code_invalid: {
    mn: "Код буруу. Дахин оролдоно уу.",
    en: "Invalid code. Please try again.",
    kr: "잘못된 코드입니다. 다시 시도하세요.",
  },
  rl_totp_code_used: {
    mn: "Код өмнө нь хэрэглэгдсэн байна.",
    en: "That code has already been used.",
    kr: "이미 사용된 코드입니다.",
  },

  // ─── active-learning: review threshold vs alert-rule floor ───
  // The suggestion is a REVIEW threshold; saving it sets the rule floor
  // (which rule governs a match), never whether an alert is created.
  al_review_thresholds: {
    mn: "Санал болгож буй хяналтын босго",
    en: "Suggested review thresholds",
    kr: "추천 검토 임계값",
  },
  al_current_floor: { mn: "Одоогийн дүрмийн босго", en: "Current rule floor", kr: "현재 규칙 하한" },
  al_no_rule: { mn: "Дүрэмгүй", en: "No rule", kr: "규칙 없음" },
  al_set_rule_floor: {
    mn: "Дүрмийн босго болгох",
    en: "Set as rule floor",
    kr: "규칙 하한으로 설정",
  },
  al_detection_gate: { mn: "ML илрүүлэх босго", en: "ML detection gate", kr: "ML 탐지 기준" },
  al_global_floor: { mn: "Ерөнхий дүрмийн босго", en: "Global rule floor", kr: "전역 규칙 하한" },
  al_floor_band_warning: {
    mn: "Энэ босгоос доош боловч ML илрүүлэх босго (0.45)-аас дээш таарц сэрэмжлүүлэг үүсгэсээр байна — зөвхөн энэ дүрмийн давхардал арилгах цонх болон чимээгүй цагт хамаарахаа болино.",
    en: "Matches below this floor but above the ML detection gate (0.45) still raise alerts — they simply stop being governed by this rule's dedup window and quiet hours.",
    kr: "이 하한보다 낮지만 ML 탐지 기준(0.45)보다 높은 매치는 여전히 알림을 생성합니다. 다만 이 규칙의 중복 제거 창과 방해 금지 시간이 더 이상 적용되지 않습니다.",
  },
  al_floor_explainer: {
    mn: "Санал болгосон утга нь шошголсон сэрэмжлүүлгээс тооцсон F1-оптимал ХЯНАЛТЫН босго. Хадгалахад тухайн сэжигтний сэрэмжлүүлэх дүрмийн босго болно: дүрэм зөвхөн тэр түвшнээс дээш таарцад үйлчилнэ. Энэ нь шүүлтүүр БИШ — сэрэмжлүүлэг үүсэх эсэхийг ML үйлчилгээний илрүүлэх босго шийднэ.",
    en: "The suggestion is the F1-optimal REVIEW threshold computed from your labels. Saving it sets this suspect's alert-rule floor: the rule then governs only matches at or above that similarity. It is not a filter — whether an alert is created at all is decided by the ML service's detection gate.",
    kr: "추천값은 라벨에서 계산한 F1 최적 검토 임계값입니다. 저장하면 해당 용의자의 알림 규칙 하한이 되며, 규칙은 그 이상 유사도의 매치에만 적용됩니다. 필터가 아닙니다 — 알림 생성 여부는 ML 서비스의 탐지 기준이 결정합니다.",
  },

  // ─── live: camera start refusals (server action returns a code) ───
  live_camera_disabled: {
    mn: "Энэ камер идэвхгүй байна. /cameras хуудсанд идэвхжүүлээд дахин оролдоно уу.",
    en: "This camera is disabled. Enable it on /cameras and try again.",
    kr: "이 카메라는 비활성 상태입니다. /cameras에서 활성화한 뒤 다시 시도하세요.",
  },
  live_camera_not_found: {
    mn: "Камер олдсонгүй — устгагдсан эсвэл эрх байхгүй байна.",
    en: "Camera not found — it was removed, or you cannot see it.",
    kr: "카메라를 찾을 수 없습니다 — 삭제되었거나 접근 권한이 없습니다.",
  },
  live_camera_url_unavailable: {
    mn: "Камерын хаяг уншигдахгүй байна (түлхүүр солигдсон эсвэл нууцлагдаагүй хаяг). /cameras дээр дахин хадгална уу.",
    en: "The camera address could not be read (rotated key, or an unsealed URL). Re-save it on /cameras.",
    kr: "카메라 주소를 읽을 수 없습니다(키 교체 또는 암호화되지 않은 URL). /cameras에서 다시 저장하세요.",
  },
  live_start_failed: {
    mn: "Камер эхлүүлж чадсангүй.",
    en: "Could not start the camera.",
    kr: "카메라를 시작하지 못했습니다.",
  },
  // Error-boundary copy for the case where NO error reporting is configured.
  // The "…reported automatically" variants above may only be shown when
  // lib/error-reporting.ts#errorReportingEnabled() is true.
  ui_error_desc_unreported: {
    mn: "Энэ хуудсыг ачаалахад алдаа гарлаа. Алдааны мэдээлэл автоматаар илгээгдээгүй.",
    en: "This page failed to load. The error was not reported automatically.",
    kr: "페이지를 불러오지 못했습니다. 오류는 자동으로 보고되지 않았습니다.",
  },
  login_err_boundary_desc_unreported: {
    mn: "Нэвтрэх хуудсанд алдаа гарлаа — дахин оролдоно уу. Алдааны мэдээлэл автоматаар илгээгдээгүй.",
    en: "The sign-in page hit an error — please try again. It was not reported automatically.",
    kr: "로그인 페이지에서 오류가 발생했습니다 — 다시 시도해 주세요. 오류는 자동으로 보고되지 않았습니다.",
  },
  // /health — is anything actually listening for crashes?
  health_reporting: { mn: "Алдааны тайлагнал (Sentry)", en: "Error reporting (Sentry)", kr: "오류 보고 (Sentry)" },
  health_reporting_on: {
    mn: "Хөтөч болон серверийн алдаа Sentry рүү илгээгдэж байна.",
    en: "Browser and server errors are being sent to Sentry.",
    kr: "브라우저 및 서버 오류가 Sentry로 전송되고 있습니다.",
  },
  health_reporting_off: {
    mn: "DSN тохируулаагүй тул алдаа хаашаа ч илгээгдэхгүй. Алдааны дэлгэц ч үүнийг амлахгүй.",
    en: "No DSN configured, so errors go nowhere — and the crash screens no longer promise otherwise.",
    kr: "DSN이 설정되지 않아 오류가 전송되지 않습니다 — 오류 화면도 더 이상 보고를 약속하지 않습니다.",
  },
  health_reporting_browser: { mn: "Хөтөч", en: "Browser", kr: "브라우저" },
  health_reporting_server: { mn: "Сервер", en: "Server", kr: "서버" },


  // ─── analytics: which window a tile is measured over ───
  analytics_window_7d: { mn: "Сүүлийн 7 хоног", en: "Last 7 days", kr: "최근 7일" },
  analytics_window_30d: { mn: "Сүүлийн 30 хоног", en: "Last 30 days", kr: "최근 30일" },

  // ─── honest metrics: a dash plus the reason, never a fabricated zero ───
  // (dashboard + alerts summary tiles; owned copy lives here so all three
  // locales stay in one table)
  metric_no_access: {
    mn: "Танд энэ тоог харах эрх алга",
    en: "You do not have access to this figure",
    kr: "이 수치를 볼 권한이 없습니다",
  },
  metric_mfa_required: {
    mn: "Хоёр хүчин зүйлийн баталгаажуулалт идэвхжүүлбэл харагдана",
    en: "Enable two-factor authentication to see this",
    kr: "2단계 인증을 활성화하면 표시됩니다",
  },
  metric_unavailable: {
    mn: "Тоо олдсонгүй",
    en: "Figure unavailable",
    kr: "수치를 불러올 수 없습니다",
  },
  metric_scoped_permissions: {
    mn: "Зөвхөн танд эрх олгосон камеруудаар тооцов",
    en: "Counted over the cameras you have been granted",
    kr: "권한이 부여된 카메라만 집계했습니다",
  },
  metric_denied_title: {
    mn: "Энэ хэсгийг харах эрх байхгүй",
    en: "You cannot see this section",
    kr: "이 섹션을 볼 수 없습니다",
  },
  metric_denied_desc: {
    mn: "Хоосон эсвэл тэг гэж харуулахын оронд ингэж мэдэгдэж байна. Эрх нэмэхийг админаас хүснэ үү.",
    en: "Rather than show an empty or zero value, we say so. Ask an administrator for access.",
    kr: "빈 값이나 0으로 표시하는 대신 이렇게 안내합니다. 관리자에게 권한을 요청하세요.",
  },
  metric_mfa_desc: { mn: "Гарч дахин нэвтэрч, баталгаажуулагч апп-ынхаа кодыг оруулна уу. Энэ нь эрхийн асуудал биш.", en: "Sign out and sign in again with your authenticator app. This is not a permissions problem.", kr: "로그아웃한 뒤 인증 앱으로 다시 로그인하세요. 권한 문제가 아닙니다." },
  metric_error_title: {
    mn: "Зарим тоо ачаалагдсангүй",
    en: "Some figures did not load",
    kr: "일부 수치를 불러오지 못했습니다",
  },
  metric_error_desc: {
    mn: "Түр зуурын алдаа. Дахин ачаалахад ихэвчлэн засарна.",
    en: "A temporary failure. Reloading usually fixes it.",
    kr: "일시적인 오류입니다. 새로고침하면 대부분 해결됩니다.",
  },
  metric_retry: { mn: "Дахин оролдох", en: "Try again", kr: "다시 시도" },
  metric_kst_note: {
    mn: "«Өнөөдөр» = Солонгосын цаг (KST)",
    en: "\u201cToday\u201d is measured in Korea Standard Time (KST)",
    kr: "\u2018오늘\u2019은 한국 표준시(KST) 기준입니다",
  },
  metric_capped_rows: {
    mn: "Зөвхөн хамгийн сүүлийн мөрүүдийг харуулав",
    en: "Showing the newest rows only",
    kr: "최신 행만 표시합니다",
  },

  // ─── audit 17: pages that used to render hardcoded copy ───

  // /cameras — enable/disable tooltip on the power button.
  cam_toggle_tip: { mn: "Идэвхжүүлэх / унтраах", en: "Enable or disable", kr: "사용 / 사용 안 함 전환" },
  // /live — file-upload diagnostics panel.
  live_file_chunks: { mn: "Хэсэг", en: "Chunks", kr: "청크" },

  // Accessible name on the public language switcher (rendered outside the
  // app shell, so it resolves through t(key, lang) rather than the hook).
  lang_switch_to: { mn: "Хэл солих:", en: "Switch to", kr: "언어 변경:" },

  // /search — the form body was hardcoded Mongolian while the header translated.
  search_matches_suffix: { mn: "тааралт олдлоо", en: "matches found", kr: "건 일치" },
  search_failed: { mn: "Хайлт амжилтгүй боллоо", en: "Search failed", kr: "검색에 실패했습니다" },

  // /jobs — reveal job queue.
  jobs_title: { mn: "Ажлын дараалал", en: "Job queue", kr: "작업 큐" },
  jobs_stat_waiting: { mn: "зөвшөөрөл хүлээж буй", en: "awaiting approval", kr: "승인 대기" },
  jobs_stat_active: { mn: "идэвхтэй", en: "active", kr: "진행 중" },
  jobs_stat_finished: { mn: "дууссан", en: "finished", kr: "완료" },
  jobs_empty: { mn: "Одоогоор ил болгох ажил байхгүй", en: "No reveal jobs yet", kr: "아직 공개 작업이 없습니다" },
  jobs_waiting_title: { mn: "Хоёр дахь админы зөвшөөрөл хүлээж байна", en: "Awaiting four-eyes approval", kr: "4-eyes 승인 대기 중" },
  jobs_active_title: { mn: "Идэвхтэй ажлууд", en: "Active jobs", kr: "진행 중인 작업" },
  jobs_col_id: { mn: "Ажлын дугаар", en: "Job ID", kr: "작업 ID" },
  jobs_col_method: { mn: "Арга", en: "Method", kr: "방식" },
  jobs_col_requested_by: { mn: "Хүсэлт гаргасан", en: "Requested by", kr: "요청자" },
  jobs_col_created: { mn: "Үүсгэсэн", en: "Created", kr: "생성 시각" },

  // /health — service probe dashboard.
  health_subtitle: { mn: "Үйлчилгээний төлөв ба холболт", en: "Service status and connectivity", kr: "서비스 상태 및 연결" },
  health_all_ok: { mn: "Бүх систем хэвийн", en: "All systems operational", kr: "모든 시스템 정상" },
  health_checking: { mn: "Шалгаж байна…", en: "Checking…", kr: "확인 중…" },
  health_issues: { mn: "Асуудал илэрлээ", en: "Issues detected", kr: "문제가 감지되었습니다" },
  health_refresh: { mn: "Дахин шалгах", en: "Refresh", kr: "다시 확인" },
  health_svc_ml: { mn: "ML үйлчилгээ", en: "ML service", kr: "ML 서비스" },
  health_svc_db: { mn: "Supabase өгөгдлийн сан", en: "Supabase database", kr: "Supabase 데이터베이스" },
  health_svc_auth: { mn: "Supabase нэвтрэлт", en: "Supabase auth", kr: "Supabase 인증" },
  health_svc_storage: { mn: "Supabase хадгалалт", en: "Supabase storage", kr: "Supabase 스토리지" },
  health_detail_ok: { mn: "Хэвийн", en: "Healthy", kr: "정상" },
  health_detail_unreachable: { mn: "Холбогдох боломжгүй", en: "Unreachable", kr: "연결할 수 없음" },
  health_detail_error: { mn: "Алдаатай", en: "Error", kr: "오류" },

  // /setup — first-run checklist.
  setup_title: { mn: "Тохируулгын заавар", en: "Setup guide", kr: "설치 가이드" },
  setup_completed: { mn: "алхам дууссан", en: "steps completed", kr: "단계 완료" },
  setup_s1_title: { mn: "1. Камер нэмэх", en: "1. Add a camera", kr: "1. 카메라 추가" },
  setup_s1_desc: { mn: "RTSP / IP / вэбкамерын эх сурвалж бүртгэнэ", en: "Register an RTSP / IP / webcam source", kr: "RTSP / IP / 웹캠 소스를 등록합니다" },
  setup_s2_title: { mn: "2. Бичлэг хийх", en: "2. Record footage", kr: "2. 영상 녹화" },
  setup_s2_desc: { mn: "Шууд дамжуулалт эхлүүлэх эсвэл бичлэг байршуулна", en: "Start a live stream or upload a recording", kr: "라이브 스트림을 시작하거나 녹화 파일을 업로드합니다" },
  setup_s3_title: { mn: "3. Сэжигтэн бүртгэх", en: "3. Add suspects", kr: "3. 용의자 등록" },
  setup_s3_desc: { mn: "Эрэн сурвалжлах хүмүүсийн зургийг байршуулна", en: "Upload photos of the persons of interest", kr: "관심 대상 인물의 사진을 업로드합니다" },
  setup_s4_title: { mn: "4. Царай илрүүлэлтийг шалгах", en: "4. Verify face detection", kr: "4. 얼굴 검출 확인" },
  setup_s4_desc: { mn: "Бичлэгээс илэрсэн царайг шалгана", en: "Check the faces detected in the recordings", kr: "녹화에서 검출된 얼굴을 확인합니다" },
  setup_s5_title: { mn: "5. 2FA идэвхжүүлэх", en: "5. Enable 2FA", kr: "5. 2단계 인증 활성화" },
  setup_s5_desc: { mn: "TOTP хоёр хүчин зүйлийн баталгаажуулалт тохируулна", en: "Set up TOTP two-factor authentication", kr: "TOTP 2단계 인증을 설정합니다" },
  setup_s6_title: { mn: "6. Системийн төлөв шалгах", en: "6. Check system health", kr: "6. 시스템 상태 점검" },
  setup_s6_desc: { mn: "Бүх үйлчилгээ холбогдсон эсэхийг шалгана", en: "Verify every service is connected", kr: "모든 서비스가 연결되었는지 확인합니다" },
  setup_footer: {
    mn: "Бүх алхмыг дуусгаснаар царай илрүүлэлт, сэжигтэн таних, шифрлэсэн бичлэгийн тоглуулалт бүрэн ажиллана.",
    en: "Complete every step for a fully operational system: face detection, suspect matching and encrypted recording playback.",
    kr: "모든 단계를 완료하면 얼굴 검출, 용의자 매칭, 암호화 녹화 재생이 모두 동작합니다.",
  },

  // /db-monitor — pg_stat_statements table + tips.
  db_empty_hint: {
    mn: "pg_stat_statements хоосон байна (саяхан идэвхжсэн) — хэсэг хүлээгээд хуудсыг дахин ачаална уу.",
    en: "pg_stat_statements is empty (only just enabled) — wait a minute and reload.",
    kr: "pg_stat_statements가 비어 있습니다(방금 활성화됨) — 잠시 후 새로고침하세요.",
  },
  db_col_query: { mn: "Query (эхний 240 тэмдэгт)", en: "Query (first 240 chars)", kr: "쿼리 (앞 240자)" },
  db_col_calls: { mn: "Дуудалт", en: "Calls", kr: "호출 수" },
  db_col_mean: { mn: "Дундаж (ms)", en: "Mean (ms)", kr: "평균 (ms)" },
  db_col_total: { mn: "Нийт (сек)", en: "Total (s)", kr: "합계 (초)" },
  db_col_rows_avg: { mn: "Дундаж мөр", en: "Rows avg", kr: "평균 행 수" },
  db_tips_title: { mn: "Оновчлолын зөвлөмж", en: "Optimisation tips", kr: "최적화 팁" },
  db_tip_slow: {
    mn: "Дундаж > 100ms — индекс нэмэх эсвэл EXPLAIN ANALYZE ажиллуулна",
    en: "Mean above 100 ms — add an index or run EXPLAIN ANALYZE",
    kr: "평균 100ms 초과 — 인덱스를 추가하거나 EXPLAIN ANALYZE를 실행하세요",
  },
  db_tip_mid: {
    mn: "Дундаж 20–100ms — дуудалт олон бол кэш эсвэл materialised view ашиглана",
    en: "Mean 20–100 ms — cache it, or use a materialised view when calls are frequent",
    kr: "평균 20–100ms — 호출이 잦다면 캐시나 구체화 뷰를 사용하세요",
  },
  db_tip_monthly: {
    mn: "Хамгийн удаан гурван query-г сар бүр шалгана",
    en: "Review the three slowest queries every month",
    kr: "가장 느린 상위 3개 쿼리를 매달 점검하세요",
  },
  db_tip_reset: { mn: "Тоолуурыг шинэчлэх", en: "Reset the counters", kr: "카운터 초기화" },

  // /retention — policy cards.
  ret_res_recordings: { mn: "Бичлэгүүд", en: "Recordings", kr: "녹화 영상" },
  ret_res_faces: { mn: "Илрүүлсэн царайнууд", en: "Detected faces", kr: "검출된 얼굴" },
  ret_res_alerts: { mn: "Сэрэмжлүүлгүүд", en: "Alerts", kr: "알림" },
  ret_res_audit_log: { mn: "Аудит лог", en: "Audit log", kr: "감사 로그" },
  ret_res_reveal_jobs: { mn: "Ил болгох ажлууд", en: "Reveal jobs", kr: "공개 작업" },
  ret_res_reveal_outputs: { mn: "Ил болгосон файлууд", en: "Reveal outputs", kr: "공개 결과 파일" },
  ret_res_edge_ingest_events: { mn: "Edge хүргэлтийн бүртгэл", en: "Edge delivery records", kr: "엣지 전송 기록" },
  ret_legal_hold: { mn: "хуулийн хориг", en: "legal hold", kr: "법적 보존" },
  ret_note: {
    mn: "Аудит лог анхдагчаар идэвхгүй (хуулийн хориг) — зөвхөн хуулийн зөвлөгөөний дагуу асаана. Бусад нөөцийн хугацааг өөрчилвөл маргаашийн cron цэвэрлэгээнд хүчин төгөлдөр болно.",
    en: "The audit log is disabled by default (legal hold) — enable it only on legal advice. Changes to the other resources take effect on the next daily cron sweep.",
    kr: "감사 로그는 기본적으로 비활성입니다(법적 보존) — 법률 자문이 있을 때만 활성화하세요. 다른 리소스의 변경은 다음 날 크론 정리에서 적용됩니다.",
  },

  // /users — super-admin row and 2FA cell.
  users_super_admin: { mn: "Супер админ", en: "Super admin", kr: "슈퍼 관리자" },
  users_super_admin_delete_hint: { mn: "Зөвхөн Supabase Studio-аас устгана", en: "Removable only from Supabase Studio", kr: "Supabase Studio에서만 삭제할 수 있습니다" },
  users_super_admin_edit_hint: { mn: "Зөвхөн Supabase Studio-аас засна", en: "Editable only from Supabase Studio", kr: "Supabase Studio에서만 수정할 수 있습니다" },
  users_protected: { mn: "Хамгаалагдсан", en: "Protected", kr: "보호됨" },
  users_2fa_on: { mn: "идэвхтэй", en: "enabled", kr: "사용 중" },
  users_2fa_off: { mn: "идэвхгүй", en: "disabled", kr: "사용 안 함" },
  users_reveal_level_hint: {
    mn: "Ил болгох эрх (ADR 0009): 0 = захирал (бүх нүүр), N = зөвхөн chain_index ≥ N",
    en: "Reveal authority (ADR 0009): 0 = director (every face), N = only chain_index ≥ N",
    kr: "공개 권한 (ADR 0009): 0 = 디렉터(모든 얼굴), N = chain_index ≥ N만",
  },
  users_role_viewer_opt: { mn: "Viewer (зөвхөн харах)", en: "Viewer (read-only)", kr: "뷰어 (읽기 전용)" },
  users_role_auditor_opt: { mn: "Auditor (зөвхөн аудит лог)", en: "Auditor (audit log only)", kr: "감사자 (감사 로그 전용)" },
  users_role_admin_opt: { mn: "Admin (бүрэн эрх)", en: "Admin (full access)", kr: "관리자 (전체 권한)" },

  // /reveal-approvals — decisions table.
  approvals_col_job: { mn: "Ажил", en: "Job", kr: "작업" },
  approvals_col_requester: { mn: "Хүсэлт гаргасан", en: "Requested by", kr: "요청자" },
  approvals_col_decision: { mn: "Шийдвэр", en: "Decision", kr: "결정" },
  approvals_col_time: { mn: "Цаг", en: "Time", kr: "시각" },
  approvals_pending_badge: { mn: "хүлээгдэж буй", en: "pending", kr: "대기 중" },

  // /clusters — DBSCAN grouping.
  clusters_subtitle: {
    mn: "DBSCAN бүлэглэл — ижил төстэй царайг нэг хүн болгон бүлэглэнэ",
    en: "DBSCAN clustering — group similar faces by identity",
    kr: "DBSCAN 클러스터링 — 유사한 얼굴을 인물별로 묶습니다",
  },
  clusters_eps: { mn: "Epsilon (зайн босго)", en: "Epsilon (distance threshold)", kr: "Epsilon (거리 임계값)" },
  clusters_min_samples: { mn: "Хамгийн бага дээжийн тоо", en: "Minimum samples", kr: "최소 샘플 수" },
  clusters_run: { mn: "DBSCAN бүлэглэл ажиллуулах", en: "Run DBSCAN clustering", kr: "DBSCAN 클러스터링 실행" },
  clusters_count: { mn: "Бүлэг", en: "Clusters", kr: "클러스터" },
  clusters_total_faces: { mn: "Нийт царай", en: "Total faces", kr: "전체 얼굴" },
  clusters_noise: { mn: "Бүлэгт ороогүй", en: "Unclustered", kr: "미분류" },
  clusters_cluster_label: { mn: "Бүлэг", en: "Cluster", kr: "클러스터" },
  clusters_faces_unit: { mn: "царай", en: "faces", kr: "개 얼굴" },
  clusters_more_suffix: { mn: "бусад", en: "more", kr: "개 더" },
  clusters_failed: { mn: "Бүлэглэл амжилтгүй боллоо", en: "Clustering failed", kr: "클러스터링에 실패했습니다" },

  // /thresholds — ML tuning sliders.
  thr_subtitle: {
    mn: "Илрүүлэлт, сэрэмжлүүлэг, давхардал арилгах босгыг тохируулна",
    en: "Adjust the detection, alert and dedup thresholds",
    kr: "검출·알림·중복 제거 임계값을 조정합니다",
  },
  thr_detect_label: { mn: "Илрүүлэлтийн итгэл", en: "Detection confidence", kr: "검출 신뢰도" },
  thr_detect_desc: { mn: "InsightFace илрүүлэлтэд шаардах хамгийн бага итгэл", en: "Minimum confidence for an InsightFace detection", kr: "InsightFace 검출에 필요한 최소 신뢰도" },
  thr_haar_label: { mn: "Haar хөршийн доод тоо", en: "Haar minimum neighbours", kr: "Haar 최소 이웃 수" },
  thr_haar_desc: { mn: "Их байх тусам худал эерэг цөөрөх ба илрүүлэлт багасна", en: "Higher means fewer false positives but lower recall", kr: "값이 클수록 오탐은 줄지만 검출률도 낮아집니다" },
  thr_persist_label: { mn: "Далдлалт хадгалах кадр", en: "Mask persist frames", kr: "마스크 유지 프레임" },
  thr_persist_desc: { mn: "Царай алга болсны дараа далдлалтыг хэдэн кадр хадгалах", en: "Frames to keep the mask after a face disappears", kr: "얼굴이 사라진 뒤 마스크를 유지할 프레임 수" },
  thr_alert_label: { mn: "Сэрэмжлүүлгийн босго", en: "Alert threshold", kr: "알림 임계값" },
  thr_alert_desc: { mn: "Сэжигтний сэрэмжлүүлэг үүсгэхэд шаардах косинус ойролцоо байдал", en: "Cosine similarity needed to raise a suspect alert", kr: "용의자 알림을 생성하는 데 필요한 코사인 유사도" },
  thr_dedup_label: { mn: "Давхардал арилгах босго", en: "Dedup threshold", kr: "중복 제거 임계값" },
  thr_dedup_desc: { mn: "Царайн зургийг давхардуулахгүй байхад ашиглах ойролцоо байдал", en: "Similarity used to deduplicate face crops", kr: "얼굴 이미지를 중복 제거할 때 사용하는 유사도" },
  thr_default: { mn: "Анхдагч", en: "Default", kr: "기본값" },
  thr_restart_note: {
    mn: "Босгын өөрчлөлт ML үйлчилгээг дахин ачаалсны дараа хүчин төгөлдөр болно. Railway-ийн орчны хувьсагчийг шинэчлээд дахин байршуулна уу.",
    en: "Threshold changes take effect only after the ML service restarts. Update the Railway environment variables and redeploy.",
    kr: "임계값 변경은 ML 서비스를 재시작해야 적용됩니다. Railway 환경 변수를 수정한 뒤 다시 배포하세요.",
  },

  // /active-learning + /alert-rules + shared table headers.
  al_true_positive: { mn: "Зөв таарц", en: "True positive", kr: "정탐" },
  al_false_positive: { mn: "Худал таарц", en: "False positive", kr: "오탐" },
  col_label: { mn: "Шошго", en: "Label", kr: "라벨" },
  col_threshold: { mn: "Босго", en: "Threshold", kr: "임계값" },
  col_dedup: { mn: "Давхардал", en: "Dedup", kr: "중복 제거" },
  col_burst: { mn: "Дараалсан", en: "Burst", kr: "연속 감지" },

  // /suspects — privacy tier picker + detail placeholders.
  suspect_tier_vip: { mn: "VIP — хамгийн хүчтэй далдлалт", en: "VIP — strongest masking", kr: "VIP — 가장 강한 마스킹" },
  suspect_tier_standard: { mn: "Стандарт", en: "Standard", kr: "표준" },
  suspect_tier_relaxed: { mn: "Сул — хамгийн бага далдлалт", en: "Relaxed — lightest masking", kr: "완화 — 가장 약한 마스킹" },
  suspect_pipeline_note: {
    mn: "ArcFace embedding · ML үйлчилгээ · нууцлалын түвшин → далдлалтын хүч ба ил болгох урсгал",
    en: "ArcFace embedding · ML service · privacy tier → mask strength and reveal flow",
    kr: "ArcFace 임베딩 · ML 서비스 · 개인정보 등급 → 마스킹 강도 및 공개 절차",
  },
  suspect_no_image: { mn: "зураг байхгүй", en: "no image", kr: "이미지 없음" },
  alert_no_screenshot: { mn: "агшин зураг байхгүй", en: "no screenshot", kr: "스크린샷 없음" },

  // /heatmap + /audit small strings.
  heatmap_top_cells: { mn: "Хамгийн идэвхтэй 5 нүд", en: "Top 5 busiest cells", kr: "가장 활동이 많은 셀 5개" },
  audit_rows: { mn: "мөр", en: "rows", kr: "행" },

  // /cameras — server-action refusals shown in the dialog.
  cam_err_key_missing: { mn: "CAMERA_URL_KEY орчны хувьсагч тохируулагдаагүй байна", en: "CAMERA_URL_KEY is not configured", kr: "CAMERA_URL_KEY 환경 변수가 설정되지 않았습니다" },
  cam_err_url_empty: { mn: "Хаяг хоосон байна", en: "The address is empty", kr: "주소가 비어 있습니다" },

  // /live — the third capture mode.
  live_mode_cctv: { mn: "IP камер", en: "IP CCTV", kr: "IP 카메라" },

  // /cameras/[id]/schedule — weekday bitmask field.
  schedule_weekdays_placeholder: { mn: "гарагийн битмаск", en: "weekday bitmask", kr: "요일 비트마스크" },
  schedule_weekdays_title: {
    mn: "1=Ня, 2=Да, …, 64=Бя. Нийлбэрээр бичнэ (127 = өдөр бүр, 62 = Да–Ба).",
    en: "1=Sun, 2=Mon, …, 64=Sat. Enter the sum (127 = every day, 62 = Mon–Fri).",
    kr: "1=일, 2=월, …, 64=토. 합계로 입력합니다(127 = 매일, 62 = 월–금).",
  },

  // /docs — section headings. The reference rows themselves stay in English.
  docs_title: { mn: "Баримт бичиг", en: "Documentation", kr: "문서" },
  docs_subtitle: {
    mn: "Системийн архитектур ба API лавлах — үзүүлэлтийг 2026-09-08-нд амьд орчинтой тулгаж шалгасан",
    en: "System architecture and API reference — figures verified 2026-09-08 against the live project",
    kr: "시스템 아키텍처 및 API 레퍼런스 — 2026-09-08 실제 환경과 대조해 검증한 수치",
  },
  docs_sec_architecture: { mn: "Архитектур", en: "Architecture", kr: "아키텍처" },
  docs_sec_ml: { mn: "ML урсгал", en: "ML pipeline", kr: "ML 파이프라인" },
  docs_sec_security: { mn: "Аюулгүй байдал", en: "Security", kr: "보안" },
  docs_sec_api: { mn: "ML API цэгүүд", en: "ML API endpoints", kr: "ML API 엔드포인트" },
  docs_sec_database: { mn: "Өгөгдлийн сан", en: "Database", kr: "데이터베이스" },
  docs_sec_encryption: { mn: "Шифрлэлт", en: "Encryption", kr: "암호화" },
  docs_sec_deployment: { mn: "Байршуулалт", en: "Deployment", kr: "배포" },
  docs_sec_streaming: { mn: "Шууд дамжуулалт", en: "Live streaming", kr: "라이브 스트리밍" },
  docs_reference_english: {
    mn: "Доорх лавлах мөрүүдийг эх баримттай яг тохируулахын тулд англиар үлдээв.",
    en: "The reference rows below stay in English so they match the source documents exactly.",
    kr: "아래 레퍼런스 항목은 원문 문서와 정확히 일치하도록 영어로 유지합니다.",
  },

  // Research / demo panels that stay English on purpose.
  demo_english_only: {
    mn: "Судалгааны демо — доорх самбар зөвхөн англи хэл дээр.",
    en: "Research demo — the panel below is English only.",
    kr: "연구용 데모 — 아래 패널은 영어로만 제공됩니다.",
  },
  bench_subtitle: {
    mn: "Railway ML үйлчилгээн дэх илрүүлэлт ба embedding-ийн хоцрогдол",
    en: "Detection and embedding latency on the Railway ML service",
    kr: "Railway ML 서비스의 검출·임베딩 지연 시간",
  },
  eval_subtitle: {
    mn: "F1 / FPR / SSIM — илрүүлэлт ба далдлалтын чанарын үзүүлэлт",
    en: "F1 / FPR / SSIM — detection and masking quality metrics",
    kr: "F1 / FPR / SSIM — 검출 및 마스킹 품질 지표",
  },
  edge_subtitle: {
    mn: "Хөтөч дээрх царай илрүүлэлт — сервер рүү зураг явуулахгүй",
    en: "Browser-side face detection — no server round-trip",
    kr: "브라우저에서 실행되는 얼굴 검출 — 서버 왕복 없음",
  },
  zk_subtitle: {
    mn: "Царай ил болгох зөвшөөрлийг нууцлал хамгаалсан ZK протоколоор баталгаажуулах туршилт",
    en: "A ZK proof protocol for privacy-preserving reveal authorisation",
    kr: "공개 승인을 프라이버시 보호 방식으로 검증하는 영지식 증명 프로토콜 실험",
  },
  dp_title: { mn: "Дифференциал нууцлал", en: "Differential privacy", kr: "차등 프라이버시" },
  dp_subtitle: {
    mn: "(ε, δ) баталгаа бүхий нууцлал хамгаалсан царайн embedding",
    en: "Privacy-preserving face embeddings with (ε, δ) guarantees",
    kr: "(ε, δ) 보장을 갖는 프라이버시 보호 얼굴 임베딩",
  },

  // /my-data — the self-service GDPR surface every signed-in role can reach.
  nav_my_data: { mn: "Миний мэдээлэл (GDPR)", en: "My data (GDPR)", kr: "내 데이터 (GDPR)" },
  nav_privacy_dp: { mn: "Дифференциал нууцлал", en: "Differential privacy", kr: "차등 프라이버시" },
  mydata_subtitle: {
    mn: "GDPR 15, 17 дугаар зүйл — өөрийн мэдээллээ татаж авах, эсвэл бүртгэлээ устгах",
    en: "GDPR Articles 15 and 17 — download your own data, or erase your account",
    kr: "GDPR 제15조·제17조 — 본인 데이터를 내려받거나 계정을 삭제합니다",
  },
  mydata_export_title: { mn: "Мэдээллээ татах (15 дугаар зүйл)", en: "Download your data (Article 15)", kr: "데이터 내려받기 (제15조)" },
  mydata_export_text: {
    mn: "Таны профайл, аудит лог дахь мөрүүд, шошгууд болон камерын эрхийг агуулсан ZIP файл бэлдэнэ. Бусад хэрэглэгчийн мэдээлэл багтахгүй.",
    en: "Builds a ZIP with your profile, your rows in the audit log, your labels and your camera grants. It never includes another user's data.",
    kr: "프로필, 감사 로그의 본인 기록, 라벨, 카메라 권한을 담은 ZIP을 생성합니다. 다른 사용자의 데이터는 포함되지 않습니다.",
  },
  mydata_erase_title: { mn: "Бүртгэлээ устгах (17 дугаар зүйл)", en: "Erase your account (Article 17)", kr: "계정 삭제 (제17조)" },
  mydata_erase_text: {
    mn: "Устгасны дараа таныг системээс гаргана. Аудит логийн мөрүүд хуулийн шаардлагаар үлдэх ба хэрэглэгчийн нэр нь таних боломжгүй болно.",
    en: "You are signed out as soon as the erase completes. Audit-log rows are kept as the law requires, with your identity removed.",
    kr: "삭제가 완료되면 즉시 로그아웃됩니다. 감사 로그 기록은 법적 요구에 따라 보존되며, 신원 정보는 제거됩니다.",
  },

  // ─── audit 16: numbers the operator can trust ───
  // A session that never proved its second factor reads every gated table as
  // empty (migration 20260908110000). The user already HAS 2FA enabled, so
  // "enable two-factor" would be wrong advice — they need a fresh sign-in.
  // Chart / page-level statement of the bucketing zone (metric_kst_note is
  // specifically about the word "Today" on the alerts summary).
  metric_tz_kst: {
    mn: "Цагийн бүс: Солонгосын цаг (KST)",
    en: "Time zone: Korea Standard Time (KST)",
    kr: "시간대: 한국 표준시(KST)",
  },
  metric_mfa_session: {
    mn: "Энэ session хоёр дахь хүчин зүйлээ нотлоогүй тул өгөгдөл хаалттай. Дахин нэвтэрнэ үү.",
    en: "This session never proved your second factor, so the data stays closed. Sign in again.",
    kr: "이 세션은 2단계 인증을 증명하지 못해 데이터가 잠겨 있습니다. 다시 로그인하세요.",
  },
  bench_iterations_label: { mn: "давталт", en: "iterations", kr: "반복" },
  bench_config_hint: { mn: "Нэг урсгал · эхний халаалтыг тооцохгүй. Ажиллуулсны дараа бодит оролт энд харагдана.", en: "Single-threaded · first warm-up excluded. The real input appears here after a run.", kr: "단일 스레드 · 첫 워밍업 제외. 실행 후 실제 입력이 여기에 표시됩니다." },
  cam_health_liveness: { mn: "Дүрс ирж буй эсэх", en: "Frames arriving", kr: "프레임 수신" },
  cam_health_last_frame: { mn: "Сүүлийн дүрс", en: "Last frame", kr: "마지막 프레임" },
  cam_health_last_face: { mn: "Сүүлд илэрсэн царай", en: "Last face", kr: "마지막 얼굴" },
  cam_health_not_capturing: { mn: "Энэ камерыг бичиж авахгүй байна", en: "Not being captured", kr: "캡처 중이 아님" },
  wall_no_detection: { mn: "Одоогоор царай илрээгүй", en: "No face detected yet", kr: "아직 얼굴이 감지되지 않음" },
  // TOTP recovery codes display + regeneration
  set_totp_recovery_title: { mn: "Сэргээх кодууд", en: "Recovery codes", kr: "복구 코드" },
  set_totp_recovery_desc: { mn: "Код бүр нэвтрэхэд 6 оронтой кодын оронд нэг л удаа ажиллана. Зөвхөн одоо харагдана — нууц үгийн менежер эсвэл хэвлэмэл хэлбэрээр аюулгүй газар хадгална уу.", en: "Each code works once, in place of the 6-digit code at sign-in. They are shown only now — keep them somewhere safe, such as a password manager or on paper.", kr: "각 코드는 로그인 시 6자리 코드 대신 한 번만 사용할 수 있습니다. 지금만 표시되므로 비밀번호 관리자나 종이 등 안전한 곳에 보관하세요." },
  set_totp_recovery_copy: { mn: "Хуулах", en: "Copy", kr: "복사" },
  set_totp_recovery_copied: { mn: "Хуулсан", en: "Copied", kr: "복사됨" },
  set_totp_recovery_download: { mn: ".txt татах", en: "Download .txt", kr: ".txt 다운로드" },
  set_totp_recovery_saved: { mn: "Хадгалсан", en: "I have saved them", kr: "저장했습니다" },
  set_totp_recovery_saved_relogin: { mn: "Хадгалсан — дахин нэвтрэх", en: "I have saved them — sign in again", kr: "저장했습니다 — 다시 로그인" },
  set_totp_regen: { mn: "Сэргээх код шинэчлэх", en: "Regenerate recovery codes", kr: "복구 코드 재발급" },
  set_totp_regen_desc: { mn: "Authenticator app-ын 6 оронтой кодыг оруулна уу. Хуучин сэргээх кодууд шууд хүчингүй болно.", en: "Enter the 6-digit code from your authenticator app. The old recovery codes stop working immediately.", kr: "인증 앱의 6자리 코드를 입력하세요. 기존 복구 코드는 즉시 무효화됩니다." },
  set_totp_regen_failed: { mn: "Сэргээх кодыг шинэчилж чадсангүй. Хуучин кодууд хүчинтэй хэвээр.", en: "Could not regenerate the recovery codes. The old codes still work.", kr: "복구 코드를 재발급하지 못했습니다. 기존 코드는 계속 유효합니다." },
  set_totp_regen_done: { mn: "Шинэ сэргээх кодууд идэвхжлээ.", en: "The new recovery codes are active.", kr: "새 복구 코드가 활성화되었습니다." },
  set_totp_enable_failed: { mn: "TOTP идэвхжүүлж чадсангүй. Юу ч өөрчлөгдөөгүй — дахин оролдоно уу.", en: "Could not enable TOTP. Nothing was changed — please try again.", kr: "TOTP를 활성화하지 못했습니다. 변경된 내용은 없습니다 — 다시 시도하세요." },
  set_totp_already_enabled: { mn: "Энэ бүртгэлд TOTP аль хэдийн идэвхтэй байна. Хуудсыг дахин ачаална уу.", en: "TOTP is already enabled for this account. Reload the page.", kr: "이 계정에는 이미 TOTP가 활성화되어 있습니다. 페이지를 새로고침하세요." },
  login_err_totp_enrolled: { mn: "Хоёр шатлалт баталгаажуулалт идэвхжлээ. Нууц үг болон 6 оронтой кодоороо дахин нэвтэрнэ үү.", en: "Two-factor authentication is on. Sign in again with your password and the 6-digit code.", kr: "2단계 인증이 켜졌습니다. 비밀번호와 6자리 코드로 다시 로그인하세요." },
  cam_health_no_frame_yet: { mn: "Бичиж эхэлсэн ч нэг ч дүрс ирээгүй", en: "Capturing, but no frame received yet", kr: "캡처 중이지만 아직 프레임이 수신되지 않음" },
  incident_export_err_no_evidence: { mn: "Энэ хэрэгт экспортлох нотлох баримт алга.", en: "This incident has no evidence to export.", kr: "이 사건에는 내보낼 증거가 없습니다." },
  incident_export_err_too_large: { mn: "Нотлох баримт хэт олон тул нэг багцад багтахгүй байна.", en: "Too much evidence to fit in one package.", kr: "증거가 너무 많아 하나의 패키지에 담을 수 없습니다." },
  incident_export_err_renderer: { mn: "Видео боловсруулах сервис одоогоор ажиллахгүй байна. Дараа дахин оролдоно уу.", en: "The video renderer is unavailable. Try again later.", kr: "영상 렌더러를 사용할 수 없습니다. 나중에 다시 시도하세요." },
  incident_export_err_packaging: { mn: "Нотлох баримтын багц үүсгэж чадсангүй.", en: "The evidence package could not be built.", kr: "증거 패키지를 만들 수 없습니다." },
  incident_export_err_audit: { mn: "Аудитын бүртгэл бичигдээгүй тул экспортыг зогсоолоо.", en: "The export was stopped because the audit record could not be written.", kr: "감사 기록을 쓸 수 없어 내보내기를 중단했습니다." },
  search_confidence_legacy_hint: {
    mn: "2026-09-20-ноос өмнө бүртгэгдсэн нүүрэнд итгэлцлийн утга байхгүй тул энэ шүүлтүүрийг тавихад тэдгээр нь үр дүнд орохгүй.",
    en: "Faces captured before 2026-09-20 have no confidence value, so they are left out whenever this filter is set.",
    kr: "2026-09-20 이전에 캡처된 얼굴에는 신뢰도 값이 없어 이 필터를 설정하면 결과에서 제외됩니다.",
  },
  search_confidence_empty_hint: {
    mn: "Нүүрний итгэлцлийн шүүлтүүр идэвхтэй байна — 2026-09-20-ноос өмнөх нүүрийг оруулахын тулд уг талбарыг хоосон болгоод дахин хайна уу.",
    en: "The face confidence filter is on — clear it and search again to include faces captured before 2026-09-20.",
    kr: "얼굴 신뢰도 필터가 켜져 있습니다 — 2026-09-20 이전에 캡처된 얼굴을 포함하려면 필터를 비우고 다시 검색하세요.",
  },
  susp_latest_sample: {
    mn: "Сүүлийн {n} сэрэмжлүүлгээр тооцов",
    en: "From the latest {n} alerts",
    kr: "최근 경보 {n}건 기준",
  },
  suspect_delete_failed: { mn: "Сэжигтнийг устгаж чадсангүй. Дахин оролдоно уу.", en: "Could not delete the suspect. Try again.", kr: "용의자를 삭제하지 못했습니다. 다시 시도하세요." },
  ar_burst_unreachable: {
    mn: "Burst цонх хэт богино: хүн камерт байх үед минутад ойролцоогоор нэг удаа дахин тааруулагддаг тул цонх нь дор хаяж 60 сек × burst тоо байх ёстой.",
    en: "Burst window too short: a person in view is re-matched about once a minute, so the window must be at least 60 s × the burst count.",
    kr: "버스트 창이 너무 짧습니다. 화면에 있는 사람은 약 1분에 한 번 재매칭되므로 창은 최소 60초 × 버스트 횟수여야 합니다.",
  },
  ar_burst_hint: {
    mn: "Камерт байгаа хүн минутад ойролцоогоор нэг удаа дахин тааруулагдана — burst цонх ≥ 60 сек × тоо.",
    en: "A person in view is re-matched about once a minute — burst window ≥ 60 s × count.",
    kr: "화면에 있는 사람은 약 1분에 한 번 재매칭됩니다 — 버스트 창 ≥ 60초 × 횟수.",
  },
  ar_enable_rule: { mn: "Дүрмийг идэвхжүүлэх", en: "Enable rule", kr: "규칙 활성화" },
  ar_disable_rule: { mn: "Дүрмийг идэвхгүй болгох", en: "Disable rule", kr: "규칙 비활성화" },
  wh_test_ok: { mn: "Тест хүргэгдлээ", en: "Test delivered", kr: "테스트 전송됨" },
  wh_test_failed: { mn: "Тест хүргэгдсэнгүй", en: "Test not delivered", kr: "테스트 전송 실패" },
  wh_test_unreachable: {
    mn: "Хаяг руу хүрсэнгүй (DNS, private хаяг, redirect эсвэл timeout)",
    en: "Endpoint unreachable (DNS, private address, redirect or timeout)",
    kr: "엔드포인트에 연결할 수 없음 (DNS, 사설 주소, 리디렉션 또는 시간 초과)",
  },
  wh_enable: { mn: "Идэвхжүүлэх", en: "Enable", kr: "활성화" },
  wh_disable: { mn: "Идэвхгүй болгох", en: "Disable", kr: "비활성화" },
  wh_ev_not_delivered: {
    mn: "Энэ үйл явдлыг юу ч илгээдэггүй — хүргэгдэхгүй",
    en: "Nothing sends this event — it is never delivered",
    kr: "이 이벤트를 보내는 기능이 없어 전달되지 않습니다",
  },
  wh_err_not_found: { mn: "Webhook олдсонгүй", en: "Webhook not found", kr: "웹훅을 찾을 수 없음" },
  wh_err_update: { mn: "Webhook шинэчилж чадсангүй", en: "Could not update webhook", kr: "웹훅을 업데이트할 수 없음" },
  live_watch: { mn: "Үзэх", en: "Watch", kr: "보기" },
  live_stop_watching: { mn: "Үзэхээ зогсоох", en: "Stop watching", kr: "보기 중지" },
  live_not_running: { mn: "Ажиллаагүй", en: "Not running", kr: "실행 안 됨" },
  live_viewer_not_running: {
    mn: "Та зөвхөн ажиллаж буй камерыг үзэж чадна; камерыг админ эхлүүлнэ. Бүх урсгалыг эндээс харна уу:",
    en: "You can watch cameras that are already running; an admin starts them. See every stream on the",
    kr: "이미 실행 중인 카메라만 볼 수 있으며, 카메라는 관리자가 시작합니다. 모든 스트림 보기:",
  },
  health_svc_ops: { mn: "Хуваарьт шалгалтууд", en: "Scheduled checks", kr: "예약 점검" },
  health_detail_degraded: { mn: "Анхаарах шаардлагатай", en: "Needs attention", kr: "주의 필요" },
  pb_reveal_err_reauth: {
    mn: "Дахин баталгаажуулалт шаардлагатай — дахин оролдоно уу",
    en: "Re-authentication required — try again",
    kr: "재인증이 필요합니다 — 다시 시도하세요",
  },
  pb_reveal_err_rate: {
    mn: "Хэт олон reveal хүсэлт — түр хүлээгээд дахин оролдоно уу",
    en: "Too many reveal requests — wait a moment and try again",
    kr: "공개 요청이 너무 많습니다 — 잠시 후 다시 시도하세요",
  },
  pb_reveal_err_reason: {
    mn: "Шалтгаан 10–1000 тэмдэгт байх ёстой",
    en: "The reason must be 10–1000 characters",
    kr: "사유는 10–1000자여야 합니다",
  },
  pb_reveal_err_window: {
    mn: "Цагийн цонх буруу эсвэл бичлэгийн уртаас давсан байна",
    en: "The time window is invalid or longer than the recording",
    kr: "시간 창이 잘못되었거나 녹화 길이를 초과합니다",
  },
  pb_reveal_err_duration: {
    mn: "Бичлэгийн урт тодорхойгүй тул цагаар хязгаарласан reveal хийх боломжгүй",
    en: "The recording length is unknown, so a time-bounded reveal is not possible",
    kr: "녹화 길이를 알 수 없어 시간 제한 공개를 할 수 없습니다",
  },
  pb_reveal_err_not_found: { mn: "Бичлэг эсвэл зорилт олдсонгүй", en: "Recording or target not found", kr: "녹화 또는 대상을 찾을 수 없음" },
  pb_reveal_err_no_original: {
    mn: "Энэ бичлэгт эх хувь үлдээгүй — reveal боломжгүй",
    en: "This recording has no original left — reveal is not possible",
    kr: "이 녹화에는 원본이 없어 공개할 수 없습니다",
  },
  pb_reveal_err_photo: {
    mn: "2 MB хүртэлх JPEG, PNG эсвэл WebP зураг оруулна уу",
    en: "Use a JPEG, PNG or WebP reference up to 2 MB",
    kr: "2MB 이하의 JPEG, PNG 또는 WebP 이미지를 사용하세요",
  },
  pb_reveal_err_ml: {
    mn: "ML сервис хариулсангүй — дахин оролдоно уу",
    en: "The ML service did not answer — try again",
    kr: "ML 서비스가 응답하지 않습니다 — 다시 시도하세요",
  },
  schedule_starts_label: { mn: "Эхлэх (HH:MM)", en: "Starts (HH:MM)", kr: "시작 (HH:MM)" },
  schedule_ends_label: { mn: "Дуусах (HH:MM)", en: "Ends (HH:MM)", kr: "종료 (HH:MM)" },
  schedule_state_unknown: {
    mn: "Тооцоолж чадсангүй — хуваарийг шалгана уу",
    en: "Could not evaluate — check the schedule",
    kr: "평가할 수 없음 — 일정을 확인하세요",
  },
  set_enrol_needs_totp: {
    mn: "Эхлээд TOTP (хоёр дахь хүчин зүйл)-ээ идэвхжүүлнэ үү — бүртгэл нь TOTP баталгаажуулалт шаардана.",
    en: "Enable TOTP (two-factor) first — enrolment needs a TOTP step-up.",
    kr: "먼저 TOTP(2단계 인증)를 활성화하세요 — 등록에는 TOTP 재인증이 필요합니다.",
  },
  set_erase_err_totp: { mn: "Шинэ TOTP код шаардлагатай", en: "A fresh TOTP code is required", kr: "새 TOTP 코드가 필요합니다" },
  set_erase_err_totp_replayed: { mn: "Энэ код аль хэдийн ашиглагдсан", en: "This code was already used", kr: "이미 사용된 코드입니다" },
  set_erase_err_password: { mn: "Нууц үг буруу эсвэл оруулаагүй", en: "Password missing or incorrect", kr: "비밀번호가 없거나 올바르지 않습니다" },
  set_erase_err_rate: {
    mn: "Хэт олон оролдлого — түр хүлээгээд дахин оролдоно уу",
    en: "Too many attempts — wait a moment and try again",
    kr: "시도가 너무 많습니다 — 잠시 후 다시 시도하세요",
  },
  set_erase_password_label: { mn: "Нууц үг (баталгаажуулах)", en: "Password (to confirm)", kr: "비밀번호 (확인용)" },
  users_role_label: { mn: "Үүрэг", en: "Role", kr: "역할" },
  live_rtc_failed: { mn: "WebRTC амжилтгүй", en: "WebRTC failed", kr: "WebRTC 실패" },
  live_rtc_publisher: { mn: "Илгээгч", en: "Publisher", kr: "송신측" },
  live_rtc_subscriber: { mn: "Хүлээн авагч (WebRTC loopback)", en: "Subscriber (WebRTC loopback)", kr: "수신측 (WebRTC 루프백)" },

  // Privacy schedules (ADR 0012) — playback notice + live badges.
  pb_privacy_spans_title: { mn: "Нууцлалын горимд бичигдсэн", en: "Captured in privacy mode", kr: "프라이버시 모드로 촬영됨" },
  pb_privacy_spans_desc: {
    mn: "Эдгээр хэсэгт нүүр танигдаагүй бөгөөд reveal хийх боломжгүй (маск хэвээр үлдэнэ).",
    en: "Faces in these parts were not identified and cannot be revealed (they stay masked).",
    kr: "이 구간의 얼굴은 식별되지 않았으며 reveal할 수 없습니다(마스킹 유지).",
  },
  pb_privacy_until_end: { mn: "төгсгөл хүртэл", en: "until the end", kr: "끝까지" },
  pb_privacy_fail_closed: {
    mn: "хуваарь уншигдаагүй — хамгаалсан",
    en: "schedule unreadable — protected anyway",
    kr: "일정을 읽지 못함 — 보호 적용",
  },
  privacy_mode_badge: { mn: "Нууцлалын горим", en: "Privacy mode", kr: "프라이버시 모드" },
  privacy_mode_badge_title: {
    mn: "Хуваарийн дагуу нууцлалын горимд: нүүр таних, сэрэмжлүүлэг унтарсан, энэ үеийн бичлэгийг reveal хийхгүй. Маск идэвхтэй.",
    en: "Private by schedule: no face recognition or alerts, and footage captured now cannot be revealed. Masking stays on.",
    kr: "일정에 따라 프라이버시 모드: 얼굴 인식과 알림이 꺼지고 지금 촬영되는 영상은 reveal할 수 없습니다. 마스킹은 유지됩니다.",
  },
  privacy_mode_badge_fail_closed: { mn: "Таних түр зогссон", en: "Recognition paused", kr: "인식 일시 중지" },
  privacy_mode_badge_fail_closed_title: {
    mn: "ML үйлчилгээ энэ камерын нууцлалын хуваарийг уншиж чадахгүй байгаа тул хаалттай горимд орсон: нүүр таних, сэрэмжлүүлэг унтарсан, энэ үеийн бичлэг хамгаалагдсан (хэзээ ч reveal хийгдэхгүй). Энэ нь хуваарийн цонх биш, тасалдал юм. Маск идэвхтэй.",
    en: "The ML service cannot read this camera's privacy schedule, so it fails closed: no face recognition or alerts, and footage captured now is recorded as protected (never revealable). This is an outage, not a schedule window. Masking stays on.",
    kr: "ML 서비스가 이 카메라의 프라이버시 일정을 읽을 수 없어 안전 모드로 전환했습니다: 얼굴 인식과 알림이 꺼지고 지금 촬영되는 영상은 보호 대상으로 기록됩니다(절대 reveal 불가). 일정의 시간대가 아니라 장애입니다. 마스킹은 유지됩니다.",
  },
  privacy_mode_legend: {
    mn: "Нууцлалын горим: нүүр таних, нүүр хадгалах, сэрэмжлүүлэг байхгүй, тэр үед бичигдсэн бичлэгийг хэзээ ч reveal хийхгүй. Нүүр аль ч горимд маскласан.",
    en: "Privacy mode: no face recognition, stored faces or alerts, and footage captured then can never be revealed. Faces stay masked in every mode.",
    kr: "프라이버시 모드: 얼굴 인식·얼굴 저장·알림이 없으며 그때 촬영된 영상은 절대 reveal할 수 없습니다. 얼굴은 모든 모드에서 마스킹됩니다.",
  },
  privacy_mode_legend_fail_closed: {
    mn: "«Таних түр зогссон» нь хуваарь уншигдаагүй (тасалдал) гэсэн үг, цонх биш.",
    en: "“Recognition paused” means the schedule could not be read (an outage), not a window.",
    kr: "“인식 일시 중지”는 일정을 읽지 못했다는 뜻(장애)이며 시간대가 아닙니다.",
  },
  privacy_enforcement_title: {
    mn: "Нууцлалын хуваарийн мөрдөлт (ML үйлчилгээ)",
    en: "Privacy schedule enforcement (ML service)",
    kr: "프라이버시 일정 적용 (ML 서비스)",
  },
  privacy_enforcement_ok: {
    mn: "Ажиллаж буй ML үйлчилгээ нууцлалын хуваарийг мөрдөж байна.",
    en: "The running ML service enforces privacy schedules.",
    kr: "실행 중인 ML 서비스가 프라이버시 일정을 적용하고 있습니다.",
  },
  privacy_enforcement_missing: {
    mn: "Ажиллаж буй ML үйлчилгээ нууцлалын хуваарийг мөрддөг гэж мэдээлэхгүй байна (хуучин build эсвэл rollback). Хуваарь хадгалагдсан ч үл тоомсорлогдоно: нууцлалын цонхонд ч нүүр таних, сэрэмжлүүлэг ажиллаж, хамгаалалтын хэсэг бичигдэхгүй. Одоогийн ML үйлчилгээг deploy хийнэ үү.",
    en: "The running ML service does NOT report privacy-schedule enforcement (an older build or a rollback). Schedules are saved but ignored: recognition and alerts run inside private windows and no protected stretches are recorded. Deploy the current ML service.",
    kr: "실행 중인 ML 서비스가 프라이버시 일정 적용을 보고하지 않습니다(이전 빌드 또는 롤백). 일정은 저장되지만 무시되어 프라이버시 시간대에도 인식과 알림이 동작하고 보호 구간이 기록되지 않습니다. 현재 ML 서비스를 배포하세요.",
  },
  privacy_enforcement_unreachable: {
    mn: "ML үйлчилгээнд холбогдож чадсангүй, мөрдөлтийг баталгаажуулах боломжгүй. Унтарсан үед ямар ч нүүр танигдахгүй; сэргэсний дараа дахин шалгана уу.",
    en: "The ML service is not reachable, so enforcement cannot be confirmed. While it is down nothing is recognised at all; check again once it is back.",
    kr: "ML 서비스에 연결할 수 없어 적용 여부를 확인할 수 없습니다. 중단된 동안에는 아무것도 인식되지 않으며, 복구된 뒤 다시 확인하세요.",
  },
  pb_privacy_schedule_title: {
    mn: "Камерын одоогийн хуваарь reveal-ээс хасаж буй хэсэг",
    en: "Withheld by the camera's current schedule",
    kr: "카메라의 현재 일정으로 제외된 구간",
  },
  pb_privacy_schedule_desc: {
    mn: "Камерын нууцлалын хуваарь эдгээр хэсгийг (цонх бүрийн эргэн тойронд 60 секундын зайтай) хамардаг тул reveal тэдгээрийг маскласан хэвээр үлдээнэ — стандарт горимд бичигдсэн бичлэгийг ч. Цонх байгаа л бол ийм байна: сулруулбал (TOTP) дахин reveal хийх боломжтой болно.",
    en: "The camera's privacy schedule covers these stretches (including a 60-second margin around each window), so a reveal keeps them masked — even footage captured in standard mode. This lasts while the window exists: loosening it (TOTP step-up) releases them.",
    kr: "카메라의 프라이버시 일정이 이 구간(각 시간대 앞뒤 60초 여유 포함)을 포함하므로 reveal 시 마스킹된 상태로 남습니다 — 표준 모드로 촬영된 영상도 마찬가지입니다. 시간대가 존재하는 동안 유지되며, 완화하면(TOTP 재인증) 다시 reveal할 수 있습니다.",
  },
  pb_reveal_privacy_blocked_spans: {
    mn: "Сонгосон хугацаа бүхэлдээ нууцлалын горимд бичигдсэн — хэзээ ч reveal хийгдэхгүй. Зөвшөөрөл авсны дараа ч татгалзах тул хүсэлт илгээгдэхгүй.",
    en: "The whole selected range was captured in privacy mode — it can never be revealed. The job would refuse it after approval, so the request is not sent.",
    kr: "선택한 구간 전체가 프라이버시 모드로 촬영되어 절대 reveal할 수 없습니다. 승인 후에도 거부되므로 요청을 보내지 않습니다.",
  },
  pb_reveal_privacy_blocked_schedule: {
    mn: "Камерын одоогийн нууцлалын хуваарь сонгосон хугацааг бүхэлд нь хамардаг тул reveal ажил зөвшөөрлийн дараа татгалзана. Өөр хугацаа сонгох эсвэл эхлээд хуваарийг сулруулна уу (TOTP).",
    en: "The camera's current privacy schedule covers the whole selected range, so the reveal job would refuse it after approval. Pick another range, or loosen the schedule first (TOTP step-up).",
    kr: "카메라의 현재 프라이버시 일정이 선택한 구간 전체를 포함하므로 reveal 작업이 승인 후 거부합니다. 다른 구간을 선택하거나 먼저 일정을 완화하세요(TOTP 재인증).",
  },
  pb_reveal_privacy_partial: {
    mn: "Сонгосон хугацааны зарим хэсэг нууцлалын горимд бичигдсэн эсвэл камерын хуваарьт хамрагдсан — гаралтад маскласан хэвээр үлдэнэ.",
    en: "Parts of the selected range were captured in privacy mode or are covered by the camera's schedule — they stay masked in the output.",
    kr: "선택한 구간의 일부가 프라이버시 모드로 촬영되었거나 카메라 일정에 포함되어 결과물에서 마스킹된 상태로 남습니다.",
  },
  reveal_err_privacy_unavailable: {
    mn: "Нууцлалын хуваарь уншигдаагүй тул reveal зогссон (юу ч тайлагдаагүй). Өгөгдлийн сангийн холболт сэргэсний дараа дахин оролдоно уу.",
    en: "The privacy schedule could not be read, so the reveal was stopped (nothing was decrypted). Retry once the database connection is back.",
    kr: "프라이버시 일정을 읽지 못해 reveal이 중지되었습니다(아무것도 복호화되지 않음). 데이터베이스 연결이 복구되면 다시 시도하세요.",
  },
  reveal_err_privacy_rules_unavailable: {
    mn: "Нууцлалын бүс уншигдаагүй тул reveal зогссон. Өгөгдлийн сангийн холболт сэргэсний дараа дахин оролдоно уу.",
    en: "Privacy zones could not be read, so the reveal was stopped. Retry once the database connection is back.",
    kr: "프라이버시 구역을 읽지 못해 reveal이 중지되었습니다. 데이터베이스 연결이 복구되면 다시 시도하세요.",
  },
  reveal_err_privacy_whole_recording: {
    mn: "Бичлэг бүхэлдээ нууцлалын горимд бичигдсэн — хэзээ ч reveal хийгдэхгүй.",
    en: "The whole recording was captured in privacy mode — it can never be revealed.",
    kr: "녹화 전체가 프라이버시 모드로 촬영되어 절대 reveal할 수 없습니다.",
  },
  reveal_err_privacy_whole_range: {
    mn: "Сонгосон хугацаа бүхэлдээ нууцлалын горимд бичигдсэн — хэзээ ч reveal хийгдэхгүй.",
    en: "The selected time range was captured entirely in privacy mode — it can never be revealed.",
    kr: "선택한 시간 구간 전체가 프라이버시 모드로 촬영되어 절대 reveal할 수 없습니다.",
  },
  reveal_err_privacy_schedule_whole_recording: {
    mn: "Камерын одоогийн нууцлалын хуваарь бичлэгийг бүхэлд нь хамардаг тул reveal хийгдээгүй. Тэр цонхыг сулруулбал (TOTP) л дахин reveal хийх боломжтой болно.",
    en: "The camera's current privacy schedule covers the whole recording, so it was not revealed. It becomes revealable again only if that window is loosened (TOTP step-up).",
    kr: "카메라의 현재 프라이버시 일정이 녹화 전체를 포함하므로 reveal되지 않았습니다. 해당 시간대를 완화해야만(TOTP 재인증) 다시 reveal할 수 있습니다.",
  },
  reveal_err_privacy_schedule_whole_range: {
    mn: "Камерын одоогийн нууцлалын хуваарь сонгосон хугацааг бүхэлд нь хамардаг тул reveal хийгдээгүй. Тэр цонхыг сулруулбал (TOTP) л дахин reveal хийх боломжтой болно.",
    en: "The camera's current privacy schedule covers the whole selected range, so it was not revealed. It becomes revealable again only if that window is loosened (TOTP step-up).",
    kr: "카메라의 현재 프라이버시 일정이 선택한 구간 전체를 포함하므로 reveal되지 않았습니다. 해당 시간대를 완화해야만(TOTP 재인증) 다시 reveal할 수 있습니다.",
  },
} as const;

export type TranslationKey = keyof typeof T;

export function t(key: TranslationKey, lang: Lang = "mn"): string {
  const entry = T[key];
  return entry?.[lang] ?? entry?.mn ?? key;
}
