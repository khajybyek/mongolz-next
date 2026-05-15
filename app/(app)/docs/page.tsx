import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { Shield, Server, Cpu, Key, Database, Globe, Camera, Zap } from "lucide-react";

const sections = [
  {
    title: "Architecture",
    icon: Server,
    items: [
      { label: "Frontend", value: "Next.js 16 (App Router) on Vercel — Singapore" },
      { label: "Database", value: "Supabase PostgreSQL 17 + pgvector — ap-southeast-1" },
      { label: "ML Service", value: "Python FastAPI on Railway — asia-southeast1" },
      { label: "Edge Functions", value: "Supabase Edge (Cloudflare) — telegram-alerts, claude-analysis" },
      { label: "Storage", value: "Supabase Storage — recordings, faces, suspects, revealed, branding" },
    ],
  },
  {
    title: "ML Pipeline",
    icon: Cpu,
    items: [
      { label: "Detection", value: "Multi-layer: Haar Cascade + InsightFace RetinaFace" },
      { label: "Recognition", value: "ArcFace (buffalo_l) — 512-dim embeddings" },
      { label: "Anonymization", value: "Cubist polygon mosaic (Voronoi tessellation)" },
      { label: "Dedup threshold", value: "Cosine similarity ≥ 0.35" },
      { label: "Alert threshold", value: "Cosine similarity ≥ 0.45" },
      { label: "Quality scoring", value: "Laplacian variance (sharpness) + brightness + size" },
    ],
  },
  {
    title: "Security",
    icon: Shield,
    items: [
      { label: "Auth", value: "Supabase Auth (email+password) + TOTP 2FA" },
      { label: "Authorization", value: "RLS-enforced admin/viewer roles on all 9 tables" },
      { label: "Encryption", value: "AES-256-GCM per-recording (HKDF-derived keys)" },
      { label: "Camera URLs", value: "AES-256-GCM encrypted at rest (CAMERA_URL_KEY)" },
      { label: "Stream auth", value: "HMAC-SHA256 signed tickets (5-min TTL)" },
      { label: "Step-up auth", value: "15-min cookie for reveal operations" },
      { label: "Rate limiting", value: "5 reauth/min, 20 reveal/hour (audit_log based)" },
      { label: "Headers", value: "CSP nonce, HSTS, X-Frame-Options DENY, CORP" },
      { label: "Audit", value: "Hash-chain audit log with verify_audit_chain()" },
    ],
  },
  {
    title: "API Endpoints (ML)",
    icon: Zap,
    items: [
      { label: "POST /embed", value: "Image → 512-dim ArcFace embedding" },
      { label: "POST /detect", value: "Image → faces[] with bbox + confidence + embedding" },
      { label: "POST /search", value: "Image → suspect matches via pgvector" },
      { label: "POST /camera/start", value: "Start RTSP/webcam recording" },
      { label: "POST /camera/stop", value: "Stop camera recording" },
      { label: "POST /process-upload", value: "Browser MP4 upload (async)" },
      { label: "POST /reveal/run", value: "Selective unblur job" },
      { label: "POST /cluster", value: "DBSCAN face clustering" },
      { label: "GET /stream/{id}", value: "HLS playlist for live stream" },
      { label: "GET /eval/*", value: "Detection, blur, recognition metrics" },
    ],
  },
  {
    title: "Database",
    icon: Database,
    items: [
      { label: "profiles", value: "Admin/viewer roles, TOTP config" },
      { label: "cameras", value: "RTSP/HTTP/USB/webcam sources (encrypted URL)" },
      { label: "suspects", value: "Name + ArcFace 512-dim embedding" },
      { label: "faces", value: "Detected faces (bbox + embedding + recording)" },
      { label: "alerts", value: "Suspect match events" },
      { label: "recordings", value: "Encrypted MP4 metadata" },
      { label: "reveal_jobs", value: "Selective reveal job queue" },
      { label: "audit_log", value: "Hash-chain immutable audit trail" },
      { label: "clusters", value: "Face clustering results" },
    ],
  },
  {
    title: "Encryption",
    icon: Key,
    items: [
      { label: "Algorithm", value: "AES-256-GCM (AEAD)" },
      { label: "Key derivation", value: "HKDF-SHA256 per recording from master key" },
      { label: "Dual-key rotation", value: "ML_ENCRYPTION_KEY + ML_ENCRYPTION_KEY_PREV fallback" },
      { label: "Performance", value: "~1-2 GB/s with AES-NI hardware acceleration" },
      { label: "Camera URL", value: "AES-256-GCM with random IV, 'enc:' prefix" },
    ],
  },
  {
    title: "Deployment",
    icon: Globe,
    items: [
      { label: "Frontend", value: "vercel deploy --prod --yes" },
      { label: "ML Service", value: "railway up --detach (from ml-service/)" },
      { label: "Edge Functions", value: "supabase functions deploy <name> --project-ref <ref>" },
      { label: "CI", value: "GitHub Actions — lint, typecheck, build, jest, pytest" },
      { label: "Monitoring", value: "Sentry (error tracking) + OpenTelemetry (tracing)" },
    ],
  },
  {
    title: "Live Streaming",
    icon: Camera,
    items: [
      { label: "Protocol", value: "HLS (HTTP Live Streaming) via FFmpeg" },
      { label: "Player", value: "hls.js with ticket-authenticated segment requests" },
      { label: "Ticket auth", value: "HMAC-SHA256 signed, 5-min TTL, timing-safe verify" },
      { label: "Processing", value: "Real-time face detection + cubist blur on frames" },
      { label: "Grid view", value: "1x1 / 2x2 / 3x3 multi-camera layout" },
    ],
  },
] as const;

export default async function DocsPage() {
  await requireAdmin();

  return (
    <>
      <PageHeader title="Documentation" subtitle="System architecture and API reference" />

      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <div key={section.title} className="card space-y-3">
            <div className="flex items-center gap-2">
              <section.icon className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-semibold">{section.title}</h3>
            </div>
            <div className="space-y-1.5">
              {section.items.map((item) => (
                <div key={item.label} className="flex gap-2 text-xs">
                  <span className="text-neutral-400 shrink-0 w-28 font-mono">{item.label}</span>
                  <span className="text-neutral-300">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
