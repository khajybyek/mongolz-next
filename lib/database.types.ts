// Supabase generated types-ийг тогтмол: `npx supabase gen types typescript --local > lib/database.types.ts`
// Доорх нь schema-тай тохируулсан manual stub.

export type UserRole = "admin" | "viewer" | "auditor";
export type CameraType = "rtsp" | "http" | "usb" | "webcam";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  totp_secret: string | null;
  totp_enabled: boolean;
  totp_recovery_codes: string[];
  created_at: string;
  updated_at: string;
}

export type PublicProfile = Omit<Profile, "totp_secret">;

export interface Camera {
  id: string;
  name: string;
  url: string;
  cam_type: CameraType;
  enabled: boolean;
  created_at: string;
  created_by: string | null;
}

export interface Suspect {
  id: string;
  name: string;
  image_path: string;
  embedding: number[];
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

export interface Face {
  id: string;
  filename: string;
  image_path: string;
  embedding: number[];
  camera_id: string | null;
  detected_at: string;
}

export interface Alert {
  id: string;
  suspect_id: string;
  suspect_name: string;
  face_id: string | null;
  similarity: number;
  screenshot_path: string | null;
  camera_id: string | null;
  camera_name: string | null;
  created_at: string;
}

export interface Recording {
  id: string;
  filename: string;
  storage_path: string;
  original_path: string | null;
  duration_sec: number | null;
  size_bytes: number | null;
  encrypted: boolean;
  has_original: boolean;
  camera_id: string | null;
  camera_name: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface AuditLog {
  id: number;
  action: string;
  detail: string | null;
  user_id: string | null;
  user_email: string | null;
  ip: string | null;
  created_at: string;
}

export type RevealMethod = "upload" | "suspect" | "detected_face";
export type RevealStatus = "queued" | "processing" | "completed" | "failed";

export interface RevealJob {
  id: string;
  recording_id: string;
  method: RevealMethod;
  suspect_id: string | null;
  face_id: string | null;
  /** Multi-face reveal-д сонгогдсон faces.id массив (1-Н ширхэг) */
  face_ids: string[] | null;
  query_embedding: number[] | null;
  /** Multi-target embedding-ууд (jsonb массив). 2+ бол multi-target reveal */
  query_embeddings: number[][] | null;
  threshold: number;
  status: RevealStatus;
  progress: number;
  output_path: string | null;
  output_duration_sec: number | null;
  error_message: string | null;
  requested_by: string | null;
  requested_email: string | null;
  reauth_at: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface MatchSuspectResult {
  id: string;
  name: string;
  image_path: string;
  similarity: number;
}

export interface MatchFaceResult {
  id: string;
  filename: string;
  image_path: string;
  detected_at: string;
  similarity: number;
}
