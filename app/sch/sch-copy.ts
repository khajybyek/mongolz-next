/**
 * SCH Esports — copy for the public registration page (`/sch`) and the
 * public teams page (`/sch/teams`). Mongolian is the primary language; the
 * English and Korean variants carry the same keys. Rank and role labels are
 * the games' own English names (see lib/sch/schema.ts) and are not translated.
 *
 * Pure module: no I/O, safe to import from server and client components.
 */
import type { Lang } from "@/lib/i18n/translations";
import { SCH_SEED_TEXT, type SchGame, type SchSeedTextKind } from "@/lib/sch/schema";

const en = {
  eventTitle: "Chuseok 2026 SCH Esports Tournament",
  eventIntro:
    "The tournament runs 25–27 September.\n" +
    "So that every student gets a fair chance and the competition stays fun and friendly, players are balanced by rank and the teams are drawn at random.\n" +
    "A registration is confirmed only once the fee has been paid.",
  eventPayment:
    "Korean account: Toss Bank 1001-9949-6201\n" +
    "Mongolian account: 450004000409071526 (TDB)\n" +
    "Write your full name in the transfer memo.",
  metaDescription: "Registration for the Chuseok 2026 SCH Esports tournament — Mobile Legends, CS2, Dota 2.",
  brand: "SCH Esports",
  eyebrow: "Chuseok 2026 · Mongolian students at SCH",
  navRegister: "Register",
  navTeams: "Teams",
  backHome: "MONGOLZ Security",
  schedule: "Schedule",
  fee: "Entry fee",
  feePerGame: "per game",
  deadline: "Registration deadline",
  contact: "Contact",
  rules: "How it works",
  openBadge: "Registration open",
  closedBadge: "Registration closed",
  teamsPublished: "Teams have been published",
  viewTeams: "View the teams",
  goToForm: "Go to the form",
  closedTitle: "Registration is closed",
  closedBody: "Thank you for your interest. If you have a question about an existing registration, contact the organiser.",
  offlineNote: "Event details could not be loaded right now — the defaults are shown; the form still works.",

  formTitle: "Registration form",
  formHint: "One form for every game you enter. Fields marked * are required.",
  stepPlayer: "Player",
  stepGames: "Games",
  stepPayment: "Payment",
  fullName: "Full name",
  fullNameHint: "Exactly as written on your bank transfer.",
  email: "Email",
  facebook: "Facebook (for contact)",
  facebookHint: "Profile link or username — the organiser will message you there.",
  phone: "Phone number",
  optional: "optional",
  gamesHint: "Pick every game you want to play — the fee is charged per game.",
  selected: "Selected",
  mlRank: "Highest rank",
  mlRoles: "Roles you play",
  mlId: "Mobile Legends ID",
  mlIdHint: "e.g. 123456789 (1234)",
  cs2Premier: "Premier rating",
  cs2PremierHint: "e.g. 15000 — leave empty if you have none.",
  steamUrl: "Steam profile URL",
  steamHint: "e.g. https://steamcommunity.com/id/yourname",
  faceit: "Do you have a FACEIT account?",
  faceitYes: "Yes",
  faceitNo: "No",
  dotaRoles: "Positions you play",
  dotaRank: "MMR medal",

  payment: "Pay the fee",
  paymentHint: "Transfer the total to one of the accounts below first, then upload a screenshot of the transfer.",
  total: "Total",
  games: "games",
  accounts: "Bank accounts",
  paymentTba: "Payment details will be announced.",
  copy: "Copy",
  copied: "Copied",
  warning: "If the amount on the screenshot differs, the recipient's name is not visible, or the transfer memo does not contain the registrant's name, the registration will be cancelled.",
  receipt: "Transfer screenshot",
  receiptHint: "One image — JPG, PNG or WebP, up to 10 MB. iPhone photos are converted to JPG automatically.",
  chooseImage: "Choose image",
  replace: "Replace",
  remove: "Remove",
  noPreview: "No preview for this format",
  consent: "I agree that this information is used only to organise the tournament and to contact me about it.",
  submit: "Submit registration",
  preparing: "Preparing…",
  uploading: "Uploading the receipt…",
  submitting: "Submitting…",
  retryUpload: "Retry upload",

  errRequired: "Required.",
  errName: "Enter your full name (2–80 characters).",
  errEmail: "Enter a valid email address.",
  errFacebook: "Enter your Facebook link or username.",
  errSteam: "Enter a Steam profile URL (steamcommunity.com/id/… or /profiles/…).",
  errRoles: "Pick at least one role.",
  errRank: "Pick your rank.",
  errGames: "Pick at least one game.",
  errReceipt: "Upload the transfer screenshot.",
  errReceiptType: "Only JPG, PNG or WebP images are accepted.",
  errReceiptSize: "The image must be 10 MB or smaller.",
  errConsent: "Please confirm the consent line.",
  errFix: "Fix the highlighted fields and try again.",
  errDuplicate: "This email is already registered for",
  errRateLimited: "Too many attempts from this network. Try again in an hour.",
  errClosed: "Registration is closed.",
  errInvalid: "Some answers were rejected — check the form and try again.",
  errUnavailable: "Could not submit right now. Your answers are kept — try again in a moment.",
  errUpload: "The receipt upload failed. Check your connection and retry.",
  errConflict: "This submission was already sent.",

  successTitle: "Registration received",
  successRef: "Reference code",
  successRefHint: "Keep it — the organiser may ask for it.",
  successGames: "Registered games",
  successTotal: "Amount to pay",
  successPay: "Payment",
  successRule: "Your registration is confirmed only after the organiser has checked your payment.",
  successAnother: "Register another person",

  teamsTitle: "Teams",
  teamsSubtitle: "Balanced random draw — published by the organiser.",
  teamsEmpty: "Teams are not published yet",
  teamsEmptyDesc: "Come back after the draw. Registered players are told when their game is published.",
  avgRank: "avg. rank score",
  players: "players",
  teamsWord: "teams",
  teamsLoadFailed: "The teams could not be loaded right now. Try again in a moment.",
  copyAccount: "Copy account",
  receiptUploaded: "Uploaded",
  draftRestored: "Your earlier answers were restored.",
  draftReceiptKept: "The transfer screenshot you uploaded is still attached.",
  errReceiptAgain: "Pick the transfer screenshot again.",
  weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as readonly string[],
};
export type SchCopy = typeof en;

const mn: SchCopy = {
  eventTitle: "Chuseok 2026 SCH Esport тэмцээн",
  eventIntro:
    "Тэмцээн 9/25 – 9/27-ний хооронд болно.\n" +
    "Бүх оюутныг тэгш оролцоогоор хангаж, илүү сонирхолтой, нөхөрсөг өрсөлдөөнийг бүрдүүлэхийн тулд оролцогчдыг rank-д нь үндэслэн багуудын түвшинг аль болох тэнцвэртэй байхаар тооцож, багийн хуваарилалтыг random байдлаар хийнэ.\n" +
    "Төлбөрөө төлсөн тохиолдолд л бүртгэл баталгаажна.",
  eventPayment:
    "Солонгос данс: 토스뱅크 1001-9949-6201\n" +
    "Монгол данс: 450004000409071526 ХХБ\n" +
    "Гүйлгээний утга дээр өөрийн бүтэн нэрээ оруулна уу.",
  metaDescription: "Chuseok 2026 SCH Esport тэмцээний бүртгэл — Mobile Legends, CS2, Dota 2.",
  brand: "SCH Esports",
  eyebrow: "Chuseok 2026 · SCH-ийн монгол оюутнууд",
  navRegister: "Бүртгүүлэх",
  navTeams: "Багууд",
  backHome: "MONGOLZ Security",
  schedule: "Хуваарь",
  fee: "Хураамж",
  feePerGame: "тоглоом бүрд",
  deadline: "Бүртгэл хаагдах хугацаа",
  contact: "Холбоо барих",
  rules: "Тэмцээний журам",
  openBadge: "Бүртгэл нээлттэй",
  closedBadge: "Бүртгэл хаагдсан",
  teamsPublished: "Багийн хуваарилалт гарсан",
  viewTeams: "Багуудыг харах",
  goToForm: "Бүртгэлийн маягт руу",
  closedTitle: "Бүртгэл хаагдсан",
  closedBody: "Сонирхон үзсэнд баярлалаа. Өмнө хийсэн бүртгэлийн талаар асуух зүйл байвал зохион байгуулагчтай холбогдоно уу.",
  offlineNote: "Тэмцээний мэдээллийг одоогоор ачаалж чадсангүй — үндсэн тохиргоог харуулж байна; маягт хэвийн ажиллана.",

  formTitle: "Бүртгэлийн маягт",
  formHint: "Оролцох бүх тоглоомоо нэг маягтаар бүртгүүлнэ. * тэмдэгтэй талбарыг заавал бөглөнө.",
  stepPlayer: "Тоглогч",
  stepGames: "Тоглоом",
  stepPayment: "Төлбөр",
  fullName: "Овог нэр",
  fullNameHint: "Банкны гүйлгээнд бичигдсэнтэй яг адил бичнэ үү.",
  email: "Имэйл",
  facebook: "Холбоо барих Facebook хаяг",
  facebookHint: "Профайлын холбоос эсвэл хэрэглэгчийн нэр — зохион байгуулагч энд мессеж бичнэ.",
  phone: "Утасны дугаар",
  optional: "заавал биш",
  gamesHint: "Оролцох тоглоомуудаа бүгдийг нь сонгоно уу — хураамж тоглоом бүрд тусдаа.",
  selected: "Сонгосон",
  mlRank: "Хамгийн өндөр rank",
  mlRoles: "Тоглодог role / position",
  mlId: "Mobile Legends ID",
  mlIdHint: "ж: 123456789 (1234)",
  cs2Premier: "Premier rank",
  cs2PremierHint: "ж: 15000 — байхгүй бол хоосон орхино.",
  steamUrl: "Steam профайлын холбоос",
  steamHint: "ж: https://steamcommunity.com/id/yourname",
  faceit: "FACEIT байгаа юу?",
  faceitYes: "Байгаа",
  faceitNo: "Байхгүй",
  dotaRoles: "Тоглодог role / position",
  dotaRank: "MMR medal",

  payment: "Хураамж төлөх",
  paymentHint: "Эхлээд нийт дүнг доорх дансны аль нэгэнд шилжүүлээд, гүйлгээний дэлгэцийн зургийг хавсаргана уу.",
  total: "Нийт",
  games: "тоглоом",
  accounts: "Дансны мэдээлэл",
  paymentTba: "Төлбөрийн мэдээллийг тусад нь зарлана.",
  copy: "Хуулах",
  copied: "Хуулсан",
  warning: "Илгээсэн зураг дээр гүйлгээний дүн зөрүүтэй байх, хүлээн авагчийн нэр харагдахгүй байх, гүйлгээний утга дээр бүртгүүлэгчийн нэр байхгүй тохиолдолд бүртгэл цуцлагдах тул анхаарна уу.",
  receipt: "Гүйлгээний дэлгэцийн зураг",
  receiptHint: "1 зураг — JPG, PNG эсвэл WebP, 10 MB хүртэл. iPhone-ы зураг автоматаар JPG болно.",
  chooseImage: "Зураг сонгох",
  replace: "Солих",
  remove: "Устгах",
  noPreview: "Энэ форматыг урьдчилан харуулах боломжгүй",
  consent: "Энэ мэдээллийг зөвхөн тэмцээнийг зохион байгуулах, надтай холбогдоход ашиглахыг зөвшөөрч байна.",
  submit: "Бүртгүүлэх",
  preparing: "Бэлтгэж байна…",
  uploading: "Зураг илгээж байна…",
  submitting: "Бүртгэж байна…",
  retryUpload: "Дахин илгээх",

  errRequired: "Заавал бөглөнө.",
  errName: "Овог нэрээ бүтнээр бичнэ үү (2–80 тэмдэгт).",
  errEmail: "Зөв имэйл хаяг оруулна уу.",
  errFacebook: "Facebook холбоос эсвэл хэрэглэгчийн нэрээ оруулна уу.",
  errSteam: "Steam профайлын холбоос оруулна уу (steamcommunity.com/id/… эсвэл /profiles/…).",
  errRoles: "Дор хаяж нэг role сонгоно уу.",
  errRank: "Rank-аа сонгоно уу.",
  errGames: "Дор хаяж нэг тоглоом сонгоно уу.",
  errReceipt: "Гүйлгээний дэлгэцийн зургийг хавсаргана уу.",
  errReceiptType: "Зөвхөн JPG, PNG эсвэл WebP зураг хүлээн авна.",
  errReceiptSize: "Зураг 10 MB-аас ихгүй байх ёстой.",
  errConsent: "Зөвшөөрлийн мөрийг баталгаажуулна уу.",
  errFix: "Тэмдэглэсэн талбаруудыг зассаны дараа дахин оролдоно уу.",
  errDuplicate: "Энэ имэйл дараах тоглоомд аль хэдийн бүртгэгдсэн байна:",
  errRateLimited: "Энэ сүлжээнээс хэт олон оролдлого хийсэн байна. Нэг цагийн дараа дахин оролдоно уу.",
  errClosed: "Бүртгэл хаагдсан байна.",
  errInvalid: "Зарим хариулт хүлээн авагдсангүй — маягтаа шалгаад дахин оролдоно уу.",
  errUnavailable: "Одоогоор бүртгэж чадсангүй. Хариултууд хадгалагдсан — түр хүлээгээд дахин оролдоно уу.",
  errUpload: "Зураг илгээж чадсангүй. Интернэт холболтоо шалгаад дахин оролдоно уу.",
  errConflict: "Энэ бүртгэл аль хэдийн илгээгдсэн байна.",

  successTitle: "Бүртгэл хүлээн авлаа",
  successRef: "Лавлах код",
  successRefHint: "Хадгалж аваарай — зохион байгуулагч асууж магадгүй.",
  successGames: "Бүртгүүлсэн тоглоом",
  successTotal: "Төлөх дүн",
  successPay: "Төлбөр",
  successRule: "Зохион байгуулагч төлбөрийг шалгаж баталсны дараа л бүртгэл баталгаажна.",
  successAnother: "Өөр хүн бүртгүүлэх",

  teamsTitle: "Багууд",
  teamsSubtitle: "Rank-д үндэслэн тэнцвэржүүлсэн санамсаргүй хуваарилалт — зохион байгуулагч нийтэлсэн.",
  teamsEmpty: "Багийн хуваарилалт хараахан гараагүй",
  teamsEmptyDesc: "Хуваарилалт хийгдсэний дараа дахин орж үзнэ үү. Бүртгүүлсэн тоглогчдод мэдэгдэнэ.",
  avgRank: "дундаж rank оноо",
  players: "тоглогч",
  teamsWord: "баг",
  teamsLoadFailed: "Багуудыг одоогоор ачаалж чадсангүй. Түр хүлээгээд дахин оролдоно уу.",
  copyAccount: "Данс хуулах",
  receiptUploaded: "Илгээгдсэн",
  draftRestored: "Өмнө оруулсан хариултуудыг сэргээлээ.",
  draftReceiptKept: "Илгээсэн гүйлгээний зураг хэвээр хавсаргагдсан байна.",
  errReceiptAgain: "Гүйлгээний зургаа дахин сонгоно уу.",
  weekdays: ["Ням", "Дав", "Мяг", "Лха", "Пүр", "Баа", "Бям"],
};

const kr: SchCopy = {
  eventTitle: "추석 2026 SCH e스포츠 대회",
  eventIntro:
    "대회는 9월 25일부터 27일까지 진행됩니다.\n" +
    "모든 학생이 공평하게 참여하고 더 재미있고 우호적인 경쟁이 되도록, 참가자의 랭크를 기준으로 팀 전력을 최대한 균형 있게 맞춰 무작위로 팀을 배정합니다.\n" +
    "참가비를 납부한 경우에만 등록이 확정됩니다.",
  eventPayment:
    "한국 계좌: 토스뱅크 1001-9949-6201\n" +
    "몽골 계좌: 450004000409071526 (TDB, 몽골무역개발은행)\n" +
    "송금 메모(입금자명)에 본인의 성명을 입력해 주세요.",
  metaDescription: "추석 2026 SCH e스포츠 대회 등록 — Mobile Legends, CS2, Dota 2.",
  brand: "SCH Esports",
  eyebrow: "추석 2026 · SCH 몽골 유학생",
  navRegister: "등록",
  navTeams: "팀",
  backHome: "MONGOLZ Security",
  schedule: "일정",
  fee: "참가비",
  feePerGame: "게임당",
  deadline: "등록 마감",
  contact: "문의",
  rules: "대회 안내",
  openBadge: "등록 진행 중",
  closedBadge: "등록 마감",
  teamsPublished: "팀 편성이 공개되었습니다",
  viewTeams: "팀 보기",
  goToForm: "등록 양식으로",
  closedTitle: "등록이 마감되었습니다",
  closedBody: "관심 가져 주셔서 감사합니다. 기존 등록에 대한 문의는 주최자에게 연락해 주세요.",
  offlineNote: "대회 정보를 불러오지 못해 기본값을 표시합니다. 양식은 정상적으로 작동합니다.",

  formTitle: "등록 양식",
  formHint: "참가할 모든 게임을 한 번에 등록합니다. * 표시는 필수 항목입니다.",
  stepPlayer: "선수",
  stepGames: "게임",
  stepPayment: "결제",
  fullName: "성명",
  fullNameHint: "은행 이체 시 표시되는 이름과 동일하게 입력하세요.",
  email: "이메일",
  facebook: "연락용 Facebook",
  facebookHint: "프로필 링크 또는 사용자명 — 주최자가 이곳으로 연락합니다.",
  phone: "전화번호",
  optional: "선택",
  gamesHint: "참가할 게임을 모두 선택하세요. 참가비는 게임마다 부과됩니다.",
  selected: "선택됨",
  mlRank: "최고 랭크",
  mlRoles: "플레이하는 역할",
  mlId: "Mobile Legends ID",
  mlIdHint: "예: 123456789 (1234)",
  cs2Premier: "Premier 레이팅",
  cs2PremierHint: "예: 15000 — 없으면 비워 두세요.",
  steamUrl: "Steam 프로필 URL",
  steamHint: "예: https://steamcommunity.com/id/yourname",
  faceit: "FACEIT 계정이 있나요?",
  faceitYes: "있음",
  faceitNo: "없음",
  dotaRoles: "플레이하는 포지션",
  dotaRank: "MMR 메달",

  payment: "참가비 결제",
  paymentHint: "먼저 아래 계좌 중 하나로 총액을 이체한 뒤 이체 화면 캡처를 업로드하세요.",
  total: "합계",
  games: "게임",
  accounts: "입금 계좌",
  paymentTba: "결제 정보는 추후 안내됩니다.",
  copy: "복사",
  copied: "복사됨",
  warning: "캡처의 이체 금액이 다르거나, 수취인 이름이 보이지 않거나, 이체 메모에 등록자 이름이 없는 경우 등록이 취소되니 주의하세요.",
  receipt: "이체 화면 캡처",
  receiptHint: "이미지 1장 — JPG, PNG 또는 WebP, 최대 10 MB. iPhone 사진은 자동으로 JPG로 변환됩니다.",
  chooseImage: "이미지 선택",
  replace: "변경",
  remove: "삭제",
  noPreview: "이 형식은 미리보기를 지원하지 않습니다",
  consent: "이 정보가 대회 운영과 관련 연락에만 사용되는 것에 동의합니다.",
  submit: "등록 제출",
  preparing: "준비 중…",
  uploading: "영수증 업로드 중…",
  submitting: "제출 중…",
  retryUpload: "업로드 재시도",

  errRequired: "필수 항목입니다.",
  errName: "성명을 입력하세요 (2–80자).",
  errEmail: "올바른 이메일 주소를 입력하세요.",
  errFacebook: "Facebook 링크 또는 사용자명을 입력하세요.",
  errSteam: "Steam 프로필 URL을 입력하세요 (steamcommunity.com/id/… 또는 /profiles/…).",
  errRoles: "역할을 하나 이상 선택하세요.",
  errRank: "랭크를 선택하세요.",
  errGames: "게임을 하나 이상 선택하세요.",
  errReceipt: "이체 화면 캡처를 업로드하세요.",
  errReceiptType: "JPG, PNG 또는 WebP 이미지만 가능합니다.",
  errReceiptSize: "이미지는 10 MB 이하여야 합니다.",
  errConsent: "동의 항목을 확인해 주세요.",
  errFix: "표시된 항목을 수정한 뒤 다시 시도하세요.",
  errDuplicate: "이 이메일은 이미 다음 게임에 등록되어 있습니다:",
  errRateLimited: "이 네트워크에서 시도가 너무 많습니다. 한 시간 후 다시 시도하세요.",
  errClosed: "등록이 마감되었습니다.",
  errInvalid: "일부 답변이 거부되었습니다. 양식을 확인하고 다시 시도하세요.",
  errUnavailable: "지금은 제출할 수 없습니다. 입력 내용은 유지됩니다. 잠시 후 다시 시도하세요.",
  errUpload: "영수증 업로드에 실패했습니다. 연결을 확인하고 다시 시도하세요.",
  errConflict: "이 등록은 이미 제출되었습니다.",

  successTitle: "등록이 접수되었습니다",
  successRef: "참조 코드",
  successRefHint: "주최자가 요청할 수 있으니 보관하세요.",
  successGames: "등록한 게임",
  successTotal: "결제 금액",
  successPay: "결제",
  successRule: "주최자가 결제를 확인한 후에만 등록이 확정됩니다.",
  successAnother: "다른 사람 등록하기",

  teamsTitle: "팀",
  teamsSubtitle: "랭크 기반 균형 랜덤 편성 — 주최자가 공개했습니다.",
  teamsEmpty: "아직 팀이 공개되지 않았습니다",
  teamsEmptyDesc: "편성 후 다시 확인하세요. 등록한 선수에게 안내됩니다.",
  avgRank: "평균 랭크 점수",
  players: "명",
  teamsWord: "팀",
  teamsLoadFailed: "지금은 팀 목록을 불러올 수 없습니다. 잠시 후 다시 시도하세요.",
  copyAccount: "계좌 복사",
  receiptUploaded: "업로드됨",
  draftRestored: "이전에 입력한 내용을 복원했습니다.",
  draftReceiptKept: "업로드한 이체 캡처는 그대로 첨부되어 있습니다.",
  errReceiptAgain: "이체 캡처를 다시 선택하세요.",
  weekdays: ["일", "월", "화", "수", "목", "금", "토"],
};

export function schCopy(lang: Lang): SchCopy {
  return { mn, en, kr }[lang] ?? mn;
}

/** Game order and colour accents used by the chips and cards. */
export const SCH_GAME_TONE: Record<SchGame, "accent" | "warning" | "info"> = {
  mobile_legends: "accent",
  cs2: "warning",
  dota2: "info",
};

/**
 * `YYYY-MM-DD` → `9/25 (Баа)`. Assembled by hand instead of Intl so the
 * server and the browser agree byte-for-byte (hydration) and mn works even
 * where ICU lacks the locale. An unparseable value is returned unchanged.
 */
export function formatGameDate(iso: string | null | undefined, lang: Lang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return iso ?? "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const wd = schCopy(lang).weekdays[weekday] ?? "";
  return `${mo}/${d} (${wd})`;
}

/** Thousands separators, identical on server and client (en-US grouping). */
export function formatAmount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

const KIND_KEY: Record<SchSeedTextKind, "eventTitle" | "eventIntro" | "eventPayment"> = {
  title: "eventTitle",
  intro: "eventIntro",
  payment: "eventPayment",
};

function foldWhitespace(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

/**
 * Organiser texts (`sch_event.title` / `intro` / `payment_info`) are stored in
 * one language. While a value still equals the seeded Mongolian text, en/kr
 * readers get the translation; anything the organiser changed is shown as-is.
 */
export function localizeEventText(value: string | null | undefined, kind: SchSeedTextKind, lang: Lang): string | null {
  if (value == null) return null;
  if (lang === "mn") return value;
  return foldWhitespace(value) === foldWhitespace(SCH_SEED_TEXT[kind]) ? schCopy(lang)[KIND_KEY[kind]] : value;
}
