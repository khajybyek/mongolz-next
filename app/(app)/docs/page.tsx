import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { Shield, Server, Cpu, Key, Database, Globe, Camera, Zap } from "lucide-react";

const sections = [
  {
    title: "Architecture",
    icon: Server,
    items: [
      { label: "Frontend", value: "Next.js 16 (App Router) on Vercel — sin1, Singapore" },
      { label: "Database", value: "Supabase PostgreSQL 17 + pgvector — ap-southeast-1, Singapore" },
      {
        label: "ML Service",
        value:
          "Python FastAPI on Railway — us-west2 (United States). NOT co-located with storage: decrypted frames and embeddings cross SG → US (COMPLIANCE.md §2, DPIA §D.5)",
      },
      { label: "Edge Functions", value: "Supabase Edge (Cloudflare) — telegram-alerts, claude-analysis" },
      {
        label: "Storage",
        value:
          "Supabase Storage — 6 buckets: recordings, faces, suspects, revealed, alert-screenshots (all private) + branding (public: logo + icons only)",
      },
    ],
  },
  {
    title: "ML Pipeline",
    icon: Cpu,
    items: [
      { label: "Detection", value: "Multi-layer: Haar Cascade + InsightFace RetinaFace (min confidence 0.55)" },
      { label: "Recognition", value: "ArcFace (buffalo_l) — 512-dim embeddings" },
      {
        label: "Anonymization",
        value:
          "Cubist polygon mosaic (Voronoi tessellation), applied when the playback view is rendered — not at capture, and not on the live feed",
      },
      {
        label: "Mask strength",
        value:
          "Measured SSIM on 20 photo-realistic faces (2026-05-18): cubist standard 0.613 ± 0.058 vs pixelate 0.627, gaussian 0.778 — lower is stronger. Source: docs/BENCHMARK_REAL.md",
      },
      { label: "Dedup threshold", value: "Cosine similarity ≥ 0.35" },
      { label: "Alert threshold", value: "Cosine similarity ≥ 0.45" },
      { label: "Quality scoring", value: "Laplacian variance (sharpness) + brightness + size" },
    ],
  },
  {
    title: "Security",
    icon: Shield,
    items: [
      { label: "Auth", value: "Supabase Auth (email or username + password) + TOTP 2FA (mandatory for admins) + WebAuthn passkeys" },
      {
        label: "Authorization",
        value:
          "RLS on all 23 public tables (46 policies over 22 of them; retention_deletion_queue is policy-less = service-role only). Roles: admin / viewer / auditor, plus the DB-locked super-admin flag and reveal_level 0–99 (ADR 0009)",
      },
      {
        label: "Encryption",
        value:
          "AES-256-GCM per recording (HKDF-derived keys), server-side at rest — the ML service holds the master key and decrypts to render. Not end-to-end",
      },
      { label: "Camera URLs", value: "AES-256-GCM encrypted at rest (CAMERA_URL_KEY)" },
      {
        label: "Stream auth",
        value:
          "HMAC-SHA256 signed tickets (5-min TTL); playlist and every segment require an enabled camera plus admin or an explicit camera_permissions grant, and each view is written to the audit log",
      },
      { label: "Step-up auth", value: "15-min cookie for reveal, user/role changes and backup download" },
      { label: "Rate limiting", value: "5 step-up attempts/min, 5 TOTP login failures/15 min, 20 reveals/hour (audit_log based)" },
      { label: "Headers", value: "CSP nonce, HSTS, X-Frame-Options DENY, CORP" },
      { label: "Audit", value: "Hash-chain audit log with verify_audit_chain()" },
      {
        label: "Audit coverage",
        value:
          "Records every privileged change, every login/step-up, and the personal-data read paths — FACE_CROP_VIEWED, RECORDING_VIEWED, STREAM_VIEWED/STREAM_DENIED, FACE_SEARCH, REID_TRAIL, ALERTS_EXPORTED, REVEAL_OUTPUT_DOWNLOADED, one row per user per object per 5 min. Does NOT record page views, dashboard aggregates, individual HLS segments, the audit-log CSV export or direct PostgREST reads",
      },
    ],
  },
  {
    title: "API Endpoints (ML)",
    icon: Zap,
    items: [
      { label: "POST /embed", value: "Image → 512-dim ArcFace embedding" },
      { label: "POST /detect", value: "Image → faces[] with bbox + confidence + embedding" },
      { label: "POST /search", value: "Image → suspect matches via pgvector" },
      { label: "POST /camera/start", value: "Start RTSP / webcam / demo:// capture" },
      { label: "POST /camera/stop", value: "Stop camera capture" },
      { label: "GET /camera/active", value: "Running capture sessions (restart count, last error)" },
      { label: "POST /process-upload", value: "Browser MP4 upload, chunk-assembled (async)" },
      { label: "POST /reveal/run", value: "Selective unblur job (4-eyes approved only)" },
      { label: "GET /recording/{id}/view", value: "On-demand masked playback render (ADR 0010), disk-cached" },
      { label: "GET /face/{id}/secure-crop", value: "Sealed face crop decrypted under the caller's reveal_level (ADR 0009)" },
      { label: "POST /cluster", value: "DBSCAN face clustering" },
      { label: "GET /stream/{id}/index.m3u8", value: "HLS playlist for the live stream (unmasked frames)" },
      { label: "POST /eval/*", value: "detection · blur · recognition · compare · bench (GET /eval/system)" },
      { label: "Auth", value: "Every endpoint requires the ML_SERVICE_TOKEN bearer except GET / (the unauthenticated health probe); /docs is disabled in production" },
    ],
  },
  {
    title: "Database",
    icon: Database,
    items: [
      { label: "Schema", value: "23 tables in public, RLS enabled on every one. Core tables below; the rest cover auth (webauthn_*, totp_used_codes, push_subscriptions), policy (alert_rules, camera_permissions, masking_schedules, privacy_zones, retention_*), and ops (camera_sessions, uptime_checks, webhooks, web_vitals)" },
      { label: "profiles", value: "Role (admin/viewer/auditor), TOTP config, is_super_admin, reveal_level" },
      { label: "cameras", value: "RTSP/HTTP/USB/webcam/demo sources (encrypted URL)" },
      { label: "suspects", value: "Name + ArcFace 512-dim embedding + privacy tier" },
      { label: "faces", value: "Detected faces (bbox + embedding + recording + chain_index/crop_sealed)" },
      { label: "alerts", value: "Suspect match events + workflow state (new/acknowledged/closed)" },
      { label: "recordings", value: "Encrypted MP4 metadata + blur_strategy (baked | on_demand)" },
      { label: "reveal_jobs", value: "Selective reveal queue with 4-eyes approval columns" },
      { label: "audit_log", value: "Hash-chain append-only audit trail (UPDATE/DELETE rejected by trigger)" },
      { label: "clusters", value: "Face clustering results" },
    ],
  },
  {
    title: "Encryption",
    icon: Key,
    items: [
      { label: "Algorithm", value: "AES-256-GCM (AEAD)" },
      { label: "Key derivation", value: "HKDF-SHA256 per recording from master key; per-face keys chain forward with SHA-256 (ADR 0009)" },
      { label: "Dual-key rotation", value: "ML_ENCRYPTION_KEY + ML_ENCRYPTION_KEY_PREV fallback" },
      {
        label: "Threat model",
        value:
          "Stolen storage blobs and stolen DB rows. The ML service holds the master key and decrypts server-side, so it is not end-to-end and does not defend against a compromised ML service",
      },
      { label: "Performance", value: "AES-NI throughput (general hardware figure, not a measurement of this deployment)" },
      { label: "Camera URL", value: "AES-256-GCM with random IV, 'enc:' prefix" },
    ],
  },
  {
    title: "Deployment",
    icon: Globe,
    items: [
      { label: "Frontend", value: "git push origin main (Vercel auto-deploy) — vercel deploy --prod --yes to override" },
      { label: "ML Service", value: "railway up --detach (from ml-service/)" },
      { label: "Edge Functions", value: "supabase functions deploy <name> --project-ref <ref>" },
      { label: "CI", value: "GitHub Actions — ci.yml (lint + build, frontend tests, ML tests) + security.yml (Semgrep, trufflehog, Nuclei, ZAP)" },
      { label: "Monitoring", value: "Sentry server + edge (instrumentation.ts); browser reporting is an open item from the 2026-09-08 audit. pg_cron probes /api/uptime every 5 min → uptime_checks + Telegram on ML up/down transitions" },
      { label: "Public probe", value: "GET /api/uptime — bucketed ml + db latency, no auth" },
    ],
  },
  {
    title: "Live Streaming",
    icon: Camera,
    items: [
      { label: "Protocol", value: "HLS (HTTP Live Streaming) via FFmpeg" },
      { label: "Player", value: "hls.js with ticket-authenticated segment requests" },
      { label: "Ticket auth", value: "HMAC-SHA256 signed, 5-min TTL, timing-safe verify" },
      {
        label: "Masking",
        value:
          "NOT applied to the live feed — frames reach the HLS writer unmasked. The Cubist mosaic is a playback-time step (GET /recording/{id}/view). Treat /live, /grid and /wall as raw footage",
      },
      {
        label: "Access",
        value:
          "Authenticated session, an enabled camera, and admin or an explicit camera_permissions grant on the playlist and every segment; each view writes STREAM_VIEWED and each refusal STREAM_DENIED. Grant access per camera on /cameras/<id>/permissions",
      },
      { label: "Grid view", value: "/grid — auto / 1 / 2×2 / 3×3 / 4×4 with paging (2 columns on phones)" },
    ],
  },
] as const;

export default async function DocsPage() {
  await requireAdmin();

  return (
    <>
      <PageHeader
        title="Documentation"
        subtitle="System architecture and API reference — figures verified 2026-09-08 against the live project"
      />

      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <div key={section.title} className="card space-y-3">
            <div className="flex items-center gap-2">
              <section.icon className="w-4 h-4 text-accent" />
              <h3 className="section-title">{section.title}</h3>
            </div>
            <div className="space-y-1.5">
              {section.items.map((item) => (
                <div key={item.label} className="flex gap-2 text-xs">
                  <span className="text-text-soft shrink-0 w-28 font-mono">{item.label}</span>
                  <span className="text-text-soft">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
