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

  // ── Login ──
  login_title: { mn: "Нэвтрэх", en: "Sign In", kr: "로그인" },
  login_email: { mn: "И-мэйл", en: "Email", kr: "이메일" },
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
} as const;

export type TranslationKey = keyof typeof T;

export function t(key: TranslationKey, lang: Lang = "mn"): string {
  const entry = T[key];
  return entry?.[lang] ?? entry?.mn ?? key;
}
