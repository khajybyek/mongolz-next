import type { Lang } from "@/lib/i18n/translations";

interface LoginCopy {
  console: string;
  heading: string;
  description: string;
  features: readonly [string, string, string];
  workspace: string;
  welcome: string;
  signInHint: string;
  accountHelp: string;
  authorized: string;
  showPassword: string;
  hidePassword: string;
  signingIn: string;
  totpTitle: string;
  totpLabel: string;
  verify: string;
  verifying: string;
  cancel: string;
  cancelling: string;
  or: string;
  passkey: string;
  passkeyBusy: string;
  passkeyHint: string;
  passkeyNeedEmail: string;
  passkeyUnavailable: string;
  passkeyUnsupported: string;
  passkeyCancelled: string;
  passkeyError: string;
}

export const loginCopy: Record<Lang, LoginCopy> = {
  mn: {
    console: "АЮУЛГҮЙ БАЙДЛЫН УДИРДЛАГА",
    heading: "Бүх хяналт.\nНэг дор.",
    description: "Камерын хяналт, үйл явдал, дүн шинжилгээг нэг орчноос удирдаарай.",
    features: ["Камерын шууд хяналт", "Үйл явдал ба мэдэгдэл", "Хандалтын эрхийн удирдлага"],
    workspace: "Удирдлагын орчин",
    welcome: "Тавтай морил",
    signInHint: "Үргэлжлүүлэхийн тулд бүртгэлээрээ нэвтэрнэ үү.",
    accountHelp: "Хандах эрх хэрэгтэй бол системийн админтай холбогдоно уу.",
    authorized: "Зөвхөн зөвшөөрөлтэй хэрэглэгчид нэвтрэх эрхтэй.",
    showPassword: "Нууц үг харуулах",
    hidePassword: "Нууц үг нуух",
    signingIn: "Нэвтэрч байна…",
    totpTitle: "Нэвтрэлтийг баталгаажуулах",
    totpLabel: "Баталгаажуулах эсвэл сэргээх код",
    verify: "Баталгаажуулах",
    verifying: "Баталгаажуулж байна…",
    cancel: "Нэвтрэх хуудас руу буцах",
    cancelling: "Буцаж байна…",
    or: "эсвэл",
    passkey: "Passkey-ээр нэвтрэх",
    passkeyBusy: "Passkey хүлээж байна…",
    passkeyHint: "Passkey ашиглахын өмнө имэйл эсвэл хэрэглэгчийн нэрээ оруулна уу.",
    passkeyNeedEmail: "Эхлээд имэйл эсвэл хэрэглэгчийн нэрээ оруулна уу.",
    passkeyUnavailable: "Энэ бүртгэлээр passkey нэвтрэлт хийх боломжгүй байна.",
    passkeyUnsupported: "Энэ браузер passkey дэмжихгүй байна.",
    passkeyCancelled: "Passkey нэвтрэлт цуцлагдлаа. Дахин оролдож болно.",
    passkeyError: "Passkey нэвтрэлт амжилтгүй боллоо. Дахин оролдоно уу.",
  },
  en: {
    console: "SECURITY OPERATIONS",
    heading: "Your security.\nOne workspace.",
    description: "Bring your cameras, events, and insights together in one focused workspace.",
    features: ["Live camera monitoring", "Events and notifications", "Role-based access control"],
    workspace: "Management console",
    welcome: "Welcome back",
    signInHint: "Sign in to your account to continue.",
    accountHelp: "Need access? Contact your system administrator.",
    authorized: "Access is restricted to authorized personnel.",
    showPassword: "Show password",
    hidePassword: "Hide password",
    signingIn: "Signing in…",
    totpTitle: "Verify your sign-in",
    totpLabel: "Authentication or recovery code",
    verify: "Verify and continue",
    verifying: "Verifying…",
    cancel: "Back to sign in",
    cancelling: "Going back…",
    or: "or",
    passkey: "Sign in with passkey",
    passkeyBusy: "Waiting for passkey…",
    passkeyHint: "Enter your email or username before using your passkey.",
    passkeyNeedEmail: "Enter your email or username first.",
    passkeyUnavailable: "Passkey sign-in is unavailable for this account.",
    passkeyUnsupported: "This browser does not support passkeys.",
    passkeyCancelled: "Passkey sign-in was cancelled. You can try again.",
    passkeyError: "Passkey sign-in failed. Please try again.",
  },
  kr: {
    console: "보안 운영",
    heading: "모든 보안을\n한곳에서.",
    description: "카메라 모니터링, 이벤트, 분석을 하나의 작업 공간에서 관리하세요.",
    features: ["실시간 카메라 모니터링", "이벤트 및 알림", "역할 기반 접근 제어"],
    workspace: "관리 콘솔",
    welcome: "다시 오신 것을 환영합니다",
    signInHint: "계속하려면 계정에 로그인하세요.",
    accountHelp: "접근 권한이 필요하면 시스템 관리자에게 문의하세요.",
    authorized: "승인된 사용자만 접근할 수 있습니다.",
    showPassword: "비밀번호 표시",
    hidePassword: "비밀번호 숨기기",
    signingIn: "로그인 중…",
    totpTitle: "로그인 인증",
    totpLabel: "인증 코드 또는 복구 코드",
    verify: "인증하고 계속",
    verifying: "인증 중…",
    cancel: "로그인으로 돌아가기",
    cancelling: "돌아가는 중…",
    or: "또는",
    passkey: "패스키로 로그인",
    passkeyBusy: "패스키 확인 대기 중…",
    passkeyHint: "패스키를 사용하기 전에 이메일 또는 사용자명을 입력하세요.",
    passkeyNeedEmail: "먼저 이메일 또는 사용자명을 입력하세요.",
    passkeyUnavailable: "이 계정에서 패스키 로그인을 사용할 수 없습니다.",
    passkeyUnsupported: "이 브라우저는 패스키를 지원하지 않습니다.",
    passkeyCancelled: "패스키 로그인이 취소되었습니다. 다시 시도할 수 있습니다.",
    passkeyError: "패스키 로그인에 실패했습니다. 다시 시도하세요.",
  },
};
