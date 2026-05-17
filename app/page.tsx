import Link from "next/link";
import {
  Sparkles,
  ShieldCheck,
  Cctv,
  ArrowRight,
  Cpu,
  Lock,
  Eye,
  KeyRound,
  Activity,
  Users,
  Database,
  ScrollText,
  LogIn,
  LayoutDashboard,
} from "lucide-react";
import { MongolzLogo } from "@/components/logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { createClient } from "@/lib/supabase/server";
import { getServerLang, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { t } = await getT();
  const lang = await getServerLang();

  // Check if user is already signed in — show "Go to dashboard" instead of "Login"
  let signedIn = false;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  } catch {
    signedIn = false;
  }

  return (
    <div className="min-h-screen bg-gradient-hero relative overflow-hidden">
      {/* Decorative mesh */}
      <div className="absolute inset-0 bg-gradient-mesh opacity-40 pointer-events-none" aria-hidden />
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[1100px] h-[500px] rounded-full blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(0,212,255,0.10) 0%, transparent 70%)" }}
        aria-hidden
      />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="relative">
            <div className="absolute inset-0 bg-accent/30 blur-md rounded-full opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
            <MongolzLogo size={36} className="relative" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight">MONGOLZ</div>
            <div className="text-[10px] text-text-muted uppercase tracking-[0.18em] font-medium">
              Security
            </div>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          <LanguageSwitcher current={lang} />
          <ThemeToggle />
          {signedIn ? (
            <Link href={"/dashboard" as never} className="btn-primary btn-sm">
              <LayoutDashboard className="w-3.5 h-3.5" />
              {t("nav_dashboard")}
            </Link>
          ) : (
            <Link href="/login" className="btn-primary btn-sm">
              <LogIn className="w-3.5 h-3.5" />
              {t("login_btn")}
            </Link>
          )}
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-4 md:px-6 lg:px-8 pb-16">
        {/* Hero */}
        <section className="text-center pt-12 pb-16 animate-fade-in-up">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-medium mb-5">
            <Sparkles className="w-3 h-3" />
            {t("home_pill")}
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-gradient-soft max-w-4xl mx-auto leading-[1.1]">
            {t("home_hero_title")}
          </h1>
          <p className="text-base md:text-lg text-text-soft mt-5 max-w-2xl mx-auto text-balance">
            {t("home_hero_body")}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {signedIn ? (
              <Link href={"/dashboard" as never} className="btn-primary btn-lg">
                <LayoutDashboard className="w-4 h-4" />
                {t("home_cta_dashboard")}
              </Link>
            ) : (
              <Link href="/login" className="btn-primary btn-lg">
                <LogIn className="w-4 h-4" />
                {t("home_cta_login")}
              </Link>
            )}
            <a href="#features" className="btn-secondary btn-lg">
              {t("home_cta_learn")}
            </a>
          </div>
        </section>

        {/* 1. Problem */}
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

        {/* 2. Architecture */}
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

        {/* 3. Live demos */}
        <Section
          id="features"
          index={3}
          eyebrow={t("demo_section_demos")}
          title={t("demo_demos_title")}
          body={t("home_demos_body")}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <DemoCard
              icon={<Cctv className="w-5 h-5" />}
              title={t("nav_live")}
              body={t("demo_demos_live_body")}
            />
            <DemoCard
              icon={<Sparkles className="w-5 h-5" />}
              title={t("compare_title")}
              body={t("demo_demos_compare_body")}
              highlight
            />
            <DemoCard
              icon={<Sparkles className="w-5 h-5" />}
              title={t("nav_ai")}
              body={t("demo_demos_ai_body")}
            />
          </div>
        </Section>

        {/* 4. Security stack */}
        <Section
          index={4}
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

        {/* Final CTA */}
        <div className="card-glow mt-8">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/15 text-accent border border-accent/20 inline-flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold tracking-tight">
                {t("home_final_cta_title")}
              </h3>
              <p className="text-sm text-text-soft mt-1.5 text-balance">
                {t("home_final_cta_body")}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {signedIn ? (
                  <Link href={"/dashboard" as never} className="btn-primary btn-sm">
                    <LayoutDashboard className="w-3.5 h-3.5" />
                    {t("home_cta_dashboard")}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                ) : (
                  <Link href="/login" className="btn-primary btn-sm">
                    <LogIn className="w-3.5 h-3.5" />
                    {t("home_cta_login")}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-border flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-2xs text-text-muted">
          <span className="md:max-w-2xl leading-relaxed">
            © {new Date().getFullYear()} MONGOLZ Security — {t("home_footer_tagline")}
          </span>
          <span className="shrink-0">Next.js 16 · Supabase · Railway · Vercel</span>
        </footer>
      </main>
    </div>
  );
}

function Section({
  id,
  index,
  eyebrow,
  title,
  body,
  children,
}: {
  id?: string;
  index: number;
  eyebrow: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-12 animate-fade-in-up">
      <div className="flex items-center gap-3 mb-3">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10 text-accent border border-accent/20 text-sm font-mono font-bold">
          {String(index).padStart(2, "0")}
        </span>
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">
          {eyebrow}
        </span>
      </div>
      <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-text mb-2">{title}</h2>
      <p className="text-base text-text-soft mb-6 max-w-3xl text-balance leading-relaxed">{body}</p>
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
      <div className={`w-10 h-10 inline-flex items-center justify-center rounded-lg border mb-3 ${cls}`}>
        {icon}
      </div>
      <h4 className="text-base font-semibold tracking-tight text-text">{title}</h4>
      <p className="text-sm text-text-soft mt-1.5 leading-relaxed">{body}</p>
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
    <div className="px-4 py-6 text-center">
      <div className={`inline-flex items-center justify-center w-11 h-11 rounded-lg bg-white/[0.04] border border-border ${toneCls} mb-2.5`}>
        {icon}
      </div>
      <div className="text-base font-semibold tracking-tight text-text">{label}</div>
      <div className="text-xs text-text-muted mt-1 font-mono">{meta}</div>
    </div>
  );
}

function DemoCard({
  icon,
  title,
  body,
  highlight,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  highlight?: boolean;
}) {
  return (
    <div className={`${highlight ? "card-glow" : "card"} h-full`}>
      <div className="w-12 h-12 rounded-xl bg-accent/15 text-accent border border-accent/20 inline-flex items-center justify-center mb-3.5">
        {icon}
      </div>
      <h4 className="text-base font-semibold tracking-tight text-text">{title}</h4>
      <p className="text-sm text-text-soft mt-1.5 leading-relaxed">{body}</p>
    </div>
  );
}

function SecPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-lg bg-surface-elevated border border-border">
      <span className="w-8 h-8 rounded-md bg-accent/10 text-accent border border-accent/20 inline-flex items-center justify-center shrink-0">
        {icon}
      </span>
      <span className="text-sm text-text">{label}</span>
    </div>
  );
}
