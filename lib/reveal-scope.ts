export const REVEAL_REASON_MIN = 10;
export const REVEAL_REASON_MAX = 1000;
export const REVEAL_SCOPE_MAX_TARGETS = 50;
export type RevealScope = {
  version: 1;
  recording: { id: string; filename: string; duration_sec: number | null };
  method: "upload" | "suspect" | "detected_face";
  targets: { id: string; label: string }[];
  threshold: number;
  start_sec: number | null;
  end_sec: number | null;
  reference_sha256?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const BASE_KEYS = ["version", "recording", "method", "targets", "threshold", "start_sec", "end_sec"];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function readRevealScope(value: unknown): RevealScope | null {
  if (!isObject(value)) return null;
  const method = value.method;
  if (!hasExactKeys(value, method === "upload" ? [...BASE_KEYS, "reference_sha256"] : BASE_KEYS)
    || value.version !== 1
    || !["upload", "suspect", "detected_face"].includes(String(method))) return null;

  const recording = value.recording;
  if (!isObject(recording) || !hasExactKeys(recording, ["id", "filename", "duration_sec"])
    || typeof recording.id !== "string" || !UUID_RE.test(recording.id)
    || typeof recording.filename !== "string" || recording.filename.trim().length === 0
    || !(recording.duration_sec === null || (finiteNumber(recording.duration_sec) && recording.duration_sec >= 0))) return null;

  if (!finiteNumber(value.threshold) || value.threshold < 0.3 || value.threshold > 0.85) return null;
  const wholeRecording = value.start_sec === null && value.end_sec === null;
  const validWindow = finiteNumber(value.start_sec) && finiteNumber(value.end_sec)
    && value.start_sec >= 0 && value.end_sec > value.start_sec;
  if (!wholeRecording && !validWindow) return null;

  if (!Array.isArray(value.targets) || value.targets.length === 0
    || value.targets.length > REVEAL_SCOPE_MAX_TARGETS) return null;
  const targets = value.targets;
  if (!targets.every((target) => isObject(target) && hasExactKeys(target, ["id", "label"])
    && typeof target.id === "string" && typeof target.label === "string"
    && target.label.trim().length > 0)) return null;
  const targetIds = targets.map((target) => target.id as string);
  if (new Set(targetIds).size !== targetIds.length) return null;

  if (method === "upload") {
    if (targets.length !== 1 || typeof value.reference_sha256 !== "string"
      || !SHA256_RE.test(value.reference_sha256) || targetIds[0] !== value.reference_sha256) return null;
  } else if (method === "suspect") {
    if (targets.length !== 1 || !UUID_RE.test(targetIds[0])) return null;
  } else if (!targetIds.every((id) => UUID_RE.test(id))) {
    return null;
  }

  return value as RevealScope;
}

export const revealScopeCopy = {
  mn: { reason: "Ил гаргах үндэслэл / хэргийн лавлагаа", hint: "Ямар үйл явдлыг, ямар зорилгоор шалгаж байгааг бичнэ үү (10–1000 тэмдэгт).", whole: "Бичлэгийн бүх хугацаа", evidence: "Масктай бичлэгийг нээх", reference: "Хүсэлтэд ашигласан зураг", missing: "Хүсэлтийн үндэслэл эсвэл хүрээ дутуу. Татгалзаад шинэ хүсэлт авна уу.", unavailable: "Хүсэлтүүдийг ачаалж чадсангүй. Дахин оролдоно уу." },
  en: { reason: "Reason for reveal / case reference", hint: "Describe the event and purpose of this investigation (10–1000 characters).", whole: "Entire recording", evidence: "Open masked recording", reference: "Request reference image", missing: "Request reason or scope is missing. Reject and request a new submission.", unavailable: "Requests could not be loaded. Please retry." },
  kr: { reason: "공개 사유 / 사건 참조", hint: "조사할 사건과 목적을 적어 주세요 (10–1000자).", whole: "전체 녹화 시간", evidence: "마스킹된 녹화 열기", reference: "요청에 사용된 참조 이미지", missing: "요청 사유 또는 범위가 없습니다. 거부 후 새 요청을 받아 주세요.", unavailable: "요청을 불러오지 못했습니다. 다시 시도해 주세요." },
} as const;
