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
  // ── Navigation ──
  nav_dashboard: { mn: "Хяналтын самбар", en: "Dashboard", kr: "대시보드" },
  nav_live: { mn: "Live бичлэг", en: "Live Feed", kr: "라이브" },
  nav_playback: { mn: "Playback", en: "Playback", kr: "재생" },
  nav_search: { mn: "Царай хайх", en: "Face Search", kr: "얼굴 검색" },
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
  alerts_live_title: { mn: "Real-time Alerts", en: "Real-time Alerts", kr: "실시간 알림" },
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
    mn: "Right to erasure — GDPR Art.17 / PIPA §36",
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
    mn: "Цаг тус бүрд masked / revealed горимыг сонгох. Хоосон бол default → 24/7 mask.",
    en: "Choose masked/revealed mode per time window. Empty list → default = 24/7 masked.",
    kr: "시간대별로 masked/revealed 모드를 선택하세요. 비어 있으면 default = 24/7 masked.",
  },
  schedule_new_window: { mn: "Шинэ window нэмэх", en: "Add new window", kr: "새 시간대 추가" },
  schedule_mode_revealed: { mn: "Илрэх (revealed)", en: "Revealed", kr: "공개 (revealed)" },
  schedule_mode_masked: { mn: "Мaскгүй (masked)", en: "Masked", kr: "마스킹 (masked)" },
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
    mn: "Asia/Seoul цагаар одоо. Шинэ recording-д энэ горим хэрэглэгдэнэ.",
    en: "Now in Asia/Seoul. This mode applies to new recordings.",
    kr: "현재 Asia/Seoul 기준. 새 녹화에 이 모드가 적용됩니다.",
  },
  schedule_default_mode: { mn: "Default горим (window-аас гадуур)", en: "Default mode (outside windows)", kr: "기본 모드 (시간대 외)" },
  schedule_default_masked: { mn: "Masked (24/7 maskingtei — recommended)", en: "Masked (24/7 — recommended)", kr: "Masked (24/7 — 권장)" },
  schedule_default_revealed: { mn: "Revealed (window-уудаас зөвхөн masked үед)", en: "Revealed (masked only during windows)", kr: "Revealed (시간대만 masked)" },
  schedule_default_warning: {
    mn: "⚠️ 'Revealed' default нь privacy-preserving шаардлагыг сулруулна. Зөвхөн хатуу хяналттай ажлын талбарт.",
    en: "⚠️ 'Revealed' default weakens privacy guarantees. Only for strict-access workspaces.",
    kr: "⚠️ 'Revealed' 기본은 프라이버시 보호를 약화시킵니다. 엄격한 통제 환경에서만.",
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
  perm_operate: { mn: "Operate — start/stop recording", en: "Operate — start/stop recording", kr: "Operate — 녹화 시작/중지" },
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
    mn: "Slack / Discord / generic HMAC destinations",
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
  playback_title: { mn: "Playback", en: "Playback", kr: "재생" },
  playback_subtitle: { mn: "Бичлэгүүдийн жагсаалт", en: "Recording list", kr: "녹화 목록" },
  playback_back: { mn: "Playback", en: "Playback", kr: "재생" },
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
  backup_title: { mn: "Backup & Restore", en: "Backup & Restore", kr: "백업 및 복원" },
  backup_subtitle: {
    mn: "DB rows + storage manifest ZIP-аар татах. Admin-only.",
    en: "Download DB rows + storage manifest as ZIP. Admin-only.",
    kr: "DB rows + 스토리지 매니페스트 ZIP 다운로드. 관리자 전용.",
  },
  backup_download: { mn: "Backup татах (ZIP)", en: "Download backup (ZIP)", kr: "백업 다운로드 (ZIP)" },
  backup_warning: {
    mn: "⚠ Blob bytes ZIP-д ороогүй — зөвхөн manifest. AES-256-GCM encrypted recordings нь Supabase Storage point-in-time backup-аар хадгалагдана.",
    en: "⚠ Blob bytes are NOT included — only manifests. AES-256-GCM encrypted recordings are preserved via Supabase Storage point-in-time backup.",
    kr: "⚠ Blob 바이트는 포함되지 않음 — 매니페스트만 포함됩니다. AES-256-GCM 암호화 녹화는 Supabase Storage point-in-time 백업으로 보존됩니다.",
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
    mn: "Бичлэг < 100MB. Face detection, mosaic, encrypted original бүгд автомат — multi-ID reveal боломжтой.",
    en: "Recordings < 100MB. Face detection, mosaic, encrypted original all automatic — multi-ID reveal supported.",
    kr: "녹화 < 100MB. 얼굴 감지, 모자이크, 암호화된 원본 모두 자동 — 다중 ID 공개 지원.",
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
} as const;

export type TranslationKey = keyof typeof T;

export function t(key: TranslationKey, lang: Lang = "mn"): string {
  const entry = T[key];
  return entry?.[lang] ?? entry?.mn ?? key;
}
