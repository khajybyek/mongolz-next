import Link from "next/link";
import {
  Sparkles,
  ShieldCheck,
  Cctv,
  ArrowRight,
  Bell,
  Cpu,
  Lock,
  Eye,
  KeyRound,
  Activity,
  Layers,
  Users,
  Database,
  ScrollText,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [
    { count: faceCount },
    { count: alertCount },
    { count: recordingCount },
    { count: alerts24h },
    { count: profileCount },
  ] = await Promise.all([
    supabase.from("faces").select("*", { count: "exact", head: true }),
    supabase.from("alerts").select("*", { count: "exact", head: true }),
    supabase.from("recordings").select("*", { count: "exact", head: true }),
    supabase.from("alerts").select("*", { count: "exact", head: true }).gte("created_at", since24h),
    supabase.from("profiles").select("*", { count: "exact", head: true }),
  ]);

  return (
    <>
      <PageHeader
        title={t("demo_title")}
        subtitle={t("demo_subtitle")}
        icon={<Sparkles className="w-5 h-5" />}
      />

      {/* ────────── 1. Problem ────────── */}
      <Section
        index={1}
        eyebrow={t("demo_section_problem")}
        title={t("demo_problem_title")}
        body={t("demo_problem_body")}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Tile
            icon={<Eye className="w-4 h-4" />}
            title={t("demo_problem_tile_a_title")}
            body={t("demo_problem_tile_a_body")}
            tone="danger"
          />
          <Tile
            icon={<ShieldCheck className="w-4 h-4" />}
            title={t("demo_problem_tile_b_title")}
            body={t("demo_problem_tile_b_body")}
            tone="accent"
          />
        </div>
      </Section>

      {/* ────────── 2. Architecture ────────── */}
      <Section
        index={2}
        eyebrow={t("demo_section_arch")}
        title={t("demo_arch_title")}
        body={t("demo_arch_body")}
      >
        <div className="card overflow-hidden p-0">
          <div className="grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-border">
            <ArchNode
              icon={<Cctv className="w-4 h-4" />}
              label={t("demo_arch_n_camera")}
              tone="info"
              meta="RTSP / USB / Browser"
            />
            <ArchNode
              icon={<Cpu className="w-4 h-4" />}
              label="ML Service"
              tone="accent"
              meta="FastAPI · InsightFace · OpenCV"
            />
            <ArchNode
              icon={<Database className="w-4 h-4" />}
              label="Supabase"
              tone="warning"
              meta="Postgres + pgvector · RLS"
            />
            <ArchNode
              icon={<Activity className="w-4 h-4" />}
              label="Vercel"
              tone="default"
              meta="Next.js 16 · Edge"
            />
          </div>
        </div>
      </Section>

      {/* ────────── 3. Live numbers ────────── */}
      <Section
        index={3}
        eyebrow={t("demo_section_numbers")}
        title={t("demo_numbers_title")}
        body={t("demo_numbers_body")}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <BigStat label={t("total_faces")} value={faceCount ?? 0} icon={<Users className="w-4 h-4" />} tone="info" />
          <BigStat label={t("alert_history")} value={alertCount ?? 0} icon={<Bell className="w-4 h-4" />} tone="danger" />
          <BigStat
            label={t("recording_days")}
            value={recordingCount ?? 0}
            icon={<Layers className="w-4 h-4" />}
            tone="warning"
          />
          <BigStat
            label={t("alerts_24h")}
            value={alerts24h ?? 0}
            icon={<Activity className="w-4 h-4" />}
            tone="accent"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Link href={"/analytics" as never} className="card-hover hover-lift flex items-center justify-between">
            <span className="text-xs text-text-soft">
              {t("nav_analytics")}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
          </Link>
          <Link href={"/alerts" as never} className="card-hover hover-lift flex items-center justify-between">
            <span className="text-xs text-text-soft">{t("nav_alerts")}</span>
            <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
          </Link>
          <Link href={"/audit" as never} className="card-hover hover-lift flex items-center justify-between">
            <span className="text-xs text-text-soft">{t("nav_audit")}</span>
            <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
          </Link>
          <Link href={"/users" as never} className="card-hover hover-lift flex items-center justify-between">
            <span className="text-xs text-text-soft">
              {profileCount ?? 0} {t("users_title")}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
          </Link>
        </div>
      </Section>

      {/* ────────── 4. Live demos ────────── */}
      <Section
        index={4}
        eyebrow={t("demo_section_demos")}
        title={t("demo_demos_title")}
        body={t("demo_demos_body")}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <DemoCard
            href={"/live" as never}
            icon={<Cctv className="w-5 h-5" />}
            title={t("nav_live")}
            body={t("demo_demos_live_body")}
            cta={t("demo_demos_open")}
          />
          <DemoCard
            href={"/compare" as never}
            icon={<Sparkles className="w-5 h-5" />}
            title={t("compare_title")}
            body={t("demo_demos_compare_body")}
            cta={t("demo_demos_open")}
            highlight
          />
          <DemoCard
            href={"/ai" as never}
            icon={<Sparkles className="w-5 h-5" />}
            title={t("nav_ai")}
            body={t("demo_demos_ai_body")}
            cta={t("demo_demos_open")}
          />
        </div>
      </Section>

      {/* ────────── 5. Security stack ────────── */}
      <Section
        index={5}
        eyebrow={t("demo_section_security")}
        title={t("demo_sec_title")}
        body={t("demo_sec_body")}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <SecPill icon={<KeyRound className="w-3.5 h-3.5" />} label={t("demo_sec_totp")} />
          <SecPill icon={<ShieldCheck className="w-3.5 h-3.5" />} label={t("demo_sec_rls")} />
          <SecPill icon={<Lock className="w-3.5 h-3.5" />} label={t("demo_sec_aes")} />
          <SecPill icon={<ScrollText className="w-3.5 h-3.5" />} label={t("demo_sec_audit")} />
          <SecPill icon={<Eye className="w-3.5 h-3.5" />} label={t("demo_sec_4eyes")} />
          <SecPill icon={<Users className="w-3.5 h-3.5" />} label={t("demo_sec_roles")} />
        </div>
      </Section>

      {/* ────────── 6. CTA ────────── */}
      <div className="card-glow mt-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/15 text-accent border border-accent/20 inline-flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold tracking-tight">
              {t("demo_cta_title")}
            </h3>
            <p className="text-sm text-text-soft mt-1.5 text-balance">
              {t("demo_cta_body")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={"/compare" as never} className="btn-primary btn-sm">
                <Sparkles className="w-3.5 h-3.5" />
                {t("compare_title")}
              </Link>
              <Link href={"/dashboard" as never} className="btn-secondary btn-sm">
                {t("nav_dashboard")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Section({
  index,
  eyebrow,
  title,
  body,
  children,
}: {
  index: number;
  eyebrow: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8 animate-fade-in-up">
      <div className="flex items-center gap-3 mb-3">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent/10 text-accent border border-accent/20 text-xs font-mono font-bold">
          {String(index).padStart(2, "0")}
        </span>
        <span className="section-title">{eyebrow}</span>
      </div>
      <h2 className="text-xl font-bold tracking-tight text-text mb-1.5">{title}</h2>
      <p className="text-sm text-text-soft mb-4 max-w-3xl text-balance">{body}</p>
      {children}
    </section>
  );
}

function Tile({
  icon,
  title,
  body,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone: "danger" | "accent";
}) {
  const cls =
    tone === "danger"
      ? "bg-danger-soft border-danger/20 text-danger"
      : "bg-accent/10 border-accent/20 text-accent";
  return (
    <div className="card">
      <div className={`w-8 h-8 inline-flex items-center justify-center rounded-lg border mb-2.5 ${cls}`}>
        {icon}
      </div>
      <h4 className="text-sm font-semibold tracking-tight text-text">{title}</h4>
      <p className="text-xs text-text-soft mt-1 leading-relaxed">{body}</p>
    </div>
  );
}

function ArchNode({
  icon,
  label,
  meta,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  meta: string;
  tone: "info" | "accent" | "warning" | "default";
}) {
  const toneCls = {
    info: "text-info",
    accent: "text-accent",
    warning: "text-warning",
    default: "text-text",
  }[tone];
  return (
    <div className="px-4 py-4 text-center">
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/[0.04] border border-border ${toneCls} mb-2`}>
        {icon}
      </div>
      <div className="text-sm font-semibold tracking-tight text-text">{label}</div>
      <div className="text-2xs text-text-muted mt-0.5 font-mono">{meta}</div>
    </div>
  );
}

function BigStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "info" | "accent" | "warning" | "danger";
}) {
  const toneCls = {
    info: "bg-info-soft border-info/20 text-info",
    accent: "bg-accent/10 border-accent/20 text-accent",
    warning: "bg-warning-soft border-warning/20 text-warning",
    danger: "bg-danger-soft border-danger/20 text-danger",
  }[tone];
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xs uppercase tracking-wider text-text-muted">{label}</span>
        <div className={`w-7 h-7 rounded-lg inline-flex items-center justify-center border ${toneCls}`}>
          {icon}
        </div>
      </div>
      <div className="text-3xl font-bold tabular-nums tracking-tight text-text">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function DemoCard({
  href,
  icon,
  title,
  body,
  cta,
  highlight,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  cta: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href as never}
      className={`block ${highlight ? "card-glow" : "card-hover"} hover-lift transition`}
    >
      <div className="flex items-start justify-between mb-2.5">
        <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent border border-accent/20 inline-flex items-center justify-center">
          {icon}
        </div>
        <ArrowRight className="w-4 h-4 text-text-muted" />
      </div>
      <h4 className="text-sm font-semibold tracking-tight text-text">{title}</h4>
      <p className="text-xs text-text-soft mt-1 leading-relaxed">{body}</p>
      <span className="text-2xs text-accent font-medium mt-2 inline-block">
        {cta} →
      </span>
    </Link>
  );
}

function SecPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface-elevated border border-border">
      <span className="w-7 h-7 rounded-md bg-accent/10 text-accent border border-accent/20 inline-flex items-center justify-center shrink-0">
        {icon}
      </span>
      <span className="text-xs text-text">{label}</span>
    </div>
  );
}
