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
} as const;

export type TranslationKey = keyof typeof T;

export function t(key: TranslationKey, lang: Lang = "mn"): string {
  const entry = T[key];
  return entry?.[lang] ?? entry?.mn ?? key;
}
