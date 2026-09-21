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
  Bell,
  Video,
  Search,
  BarChart3,
  Settings,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { MongolzLogo } from "@/components/logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { LiveStatus } from "@/components/live-status";
import { createClient } from "@/lib/supabase/server";
import { getServerLang, getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

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

  const primaryCta = signedIn ? (
    <Link href={"/dashboard" as never} className="btn-primary btn-lg">
      <LayoutDashboard className="w-4 h-4" />
      {t("home_cta_dashboard")}
    </Link>
  ) : (
    <Link href="/login" className="btn-primary btn-lg">
      <LogIn className="w-4 h-4" />
      {t("home_cta_login")}
    </Link>
  );

  return (
    <div className="min-h-screen min-h-dvh bg-gradient-hero relative overflow-hidden">
      <header className="relative z-20 border-b border-border bg-bg/80 backdrop-blur-xl">
        <div className="page-safe-gutter max-w-7xl mx-auto flex min-h-20 flex-wrap items-center justify-between gap-3 py-3">
          <Link href="/" className="flex items-center gap-3" aria-label="MONGOLZ Security">
            <MongolzLogo size={38} />
            <div>
              <div className="text-sm font-bold tracking-[0.06em]">MONGOLZ</div>
              <div className="text-[10px] text-text-muted tracking-[0.2em] mt-0.5">SECURITY</div>
            </div>
          </Link>
          <nav aria-label={t("home_workspace")} className="hidden xl:flex items-center gap-7 text-sm text-text-muted">
            <a href="#features" className="py-3 hover:text-text transition-colors">{t("home_workspace")}</a>
            <a href="#privacy" className="py-3 hover:text-text transition-colors">{t("home_privacy_label")}</a>
            <a href="#security" className="py-3 hover:text-text transition-colors">{t("home_access_label")}</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher current={lang} className="hidden sm:inline-flex" />
            <ThemeToggle />
            <Link href={signedIn ? "/dashboard" : "/login"} className="btn-secondary btn-sm max-w-[10rem]">
              <span className="truncate">{signedIn ? t("nav_dashboard") : t("login_btn")}</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </Link>
          </div>
          <div className="sm:hidden w-full flex justify-end border-t border-border pt-2">
            <LanguageSwitcher current={lang} />
          </div>
        </div>
      </header>

      <main className="page-safe-gutter relative z-10 max-w-7xl mx-auto pb-[calc(4rem+env(safe-area-inset-bottom,0px))]">
        {/* Hero */}
        <section className="grid lg:grid-cols-[1fr_1.05fr] gap-12 lg:gap-14 items-center pt-12 md:pt-20 pb-12 md:pb-20">
          <div className="text-left animate-fade-in-up">
            <div className="mb-7 rounded-2xl border border-accent/20 bg-accent/[0.045] px-4 py-3.5 shadow-sm sm:px-5">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent sm:text-xs">
                <ScrollText className="h-3.5 w-3.5" aria-hidden />
                <span>{t("home_pill")}</span>
                <span className="text-border-strong" aria-hidden>·</span>
                <span>{t("home_project_label")}</span>
              </div>
              <p className="max-w-2xl text-sm font-medium leading-relaxed text-text-soft text-balance sm:text-base">
                {t("home_footer_tagline")}
              </p>
            </div>
            <h1 className="text-[2.35rem] sm:text-5xl xl:text-[3.5rem] font-semibold tracking-[-0.045em] text-gradient-soft leading-[1.13] text-balance">
              {t("home_hero_title")}
            </h1>
            <p className="text-base md:text-lg text-text-muted mt-6 max-w-xl text-pretty leading-relaxed">
              {t("home_hero_body")}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {primaryCta}
              <a href="#features" className="btn-secondary btn-lg">
                {t("home_cta_learn")}
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
            <p className="mt-7 text-[10px] sm:text-2xs tracking-[0.10em] text-text-muted font-medium">
              {t("home_trust_row")}
            </p>
          </div>

          <div className="relative animate-fade-in-up" style={{ animationDelay: "120ms" }}>
            <div className="flex items-center justify-between gap-3 mb-3 text-xs text-text-muted">
              <span className="inline-flex items-center gap-2 font-medium"><LayoutDashboard className="w-3.5 h-3.5" />{t("home_preview_label")}</span>
              <span className="font-mono text-[10px]">MONGOLZ / 01</span>
            </div>
            <HeroMockup
              labels={{
                url: "aicctv.dev/dashboard",
                faces: t("total_faces"),
                alerts: t("today_alerts"),
                cameras: t("home_mock_cameras"),
                recent: t("home_mock_recent"),
                live: t("home_mock_live"),
                sealed: t("home_mock_sealed"),
                pending: t("home_mock_pending"),
                approved: t("home_mock_approved"),
              }}
            />
            <p className="mt-8 text-[11px] text-text-muted text-center">{t("home_preview_note")}</p>
          </div>
        </section>

        {/* Stats strip */}
        <section className="mb-16 md:mb-20 animate-fade-in-up" style={{ animationDelay: "160ms" }}>
          <div className="card p-0 overflow-hidden">
            <dl className="grid grid-cols-2 md:grid-cols-4 [&>div]:border-border [&>div:nth-child(odd)]:border-r [&>div:nth-child(n+3)]:border-t md:[&>div:nth-child(n+3)]:border-t-0 md:[&>div:not(:last-child)]:border-r">
              <Stat value="512-d" label={t("home_stat_embed")} />
              <Stat value="AES-256" label={t("home_stat_enc")} />
              <Stat value="3 + 4-eyes" label={t("home_stat_roles")} />
              <Stat value={t("home_stat_locales_value")} label={t("home_stat_locales")} />
            </dl>
          </div>
        </section>

        {/* 1. Problem */}
        <Section
          id="privacy"
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
            <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 divide-border [&>*:nth-child(odd)]:border-r md:[&>*]:border-r [&>*:last-child]:border-r-0">
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
              href={signedIn ? "/live" : "/login?next=%2Flive"}
              cta={t("home_open_feature")}
            />
            <DemoCard
              icon={<Sparkles className="w-5 h-5" />}
              title={t("compare_title")}
              body={t("demo_demos_compare_body")}
              href={signedIn ? "/compare" : "/login?next=%2Fcompare"}
              cta={t("home_open_feature")}
              highlight
            />
            <DemoCard
              icon={<Sparkles className="w-5 h-5" />}
              title={t("nav_ai")}
              body={t("demo_demos_ai_body")}
              href={signedIn ? "/ai" : "/login?next=%2Fai"}
              cta={t("home_open_feature")}
            />
          </div>
        </Section>

        {/* 4. Security stack */}
        <Section
          id="security"
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
        <div className="relative overflow-hidden rounded-2xl border border-accent/25 p-6 md:p-8 mt-4">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(80% 120% at 0% 0%, rgba(0,212,255,0.14) 0%, transparent 60%), radial-gradient(60% 100% at 100% 100%, rgba(124,58,237,0.16) 0%, transparent 60%)",
            }}
            aria-hidden
          />
          <div className="relative flex flex-col md:flex-row md:items-center gap-5">
            <div className="icon-tile w-12 h-12">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold tracking-tight">{t("home_final_cta_title")}</h3>
              <p className="text-sm text-text-soft mt-1.5 text-pretty max-w-2xl">{t("home_final_cta_body")}</p>
            </div>
            <div className="shrink-0">
              {signedIn ? (
                <Link href={"/dashboard" as never} className="btn-primary">
                  <LayoutDashboard className="w-4 h-4" />
                  {t("home_cta_dashboard")}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              ) : (
                <Link href="/login" className="btn-primary">
                  <LogIn className="w-4 h-4" />
                  {t("home_cta_login")}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-border flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-2xs text-text-muted">
          <span className="md:max-w-2xl leading-relaxed">
            © {new Date().getFullYear()} MONGOLZ Security — {t("home_footer_tagline")}
          </span>
          <span className="shrink-0 flex items-center gap-3">
            <LiveStatus lang={lang} />
            <span aria-hidden>·</span>
            Next.js 16 · Supabase · Railway · Vercel
          </span>
        </footer>
      </main>
    </div>
  );
}

/* ───────────────────────── Hero mockup ───────────────────────── */

interface MockLabels {
  url: string;
  faces: string;
  alerts: string;
  cameras: string;
  recent: string;
  live: string;
  sealed: string;
  pending: string;
  approved: string;
}

const MOSAIC_PALETTES = [
  ["bg-accent/70", "bg-accent/40", "bg-accent-2/60", "bg-text-muted/50", "bg-accent/55", "bg-accent-2/40", "bg-text-muted/35", "bg-accent/30", "bg-accent-2/70"],
  ["bg-accent-2/60", "bg-text-muted/40", "bg-accent/50", "bg-accent-2/45", "bg-accent/70", "bg-text-muted/55", "bg-accent/35", "bg-accent-2/70", "bg-accent/45"],
  ["bg-text-muted/45", "bg-accent/60", "bg-accent-2/50", "bg-accent/30", "bg-text-muted/60", "bg-accent-2/65", "bg-accent/50", "bg-text-muted/35", "bg-accent-2/40"],
];

function MosaicAvatar({ variant }: { variant: number }) {
  const palette = MOSAIC_PALETTES[variant % MOSAIC_PALETTES.length]!;
  return (
    <div className="w-8 h-8 rounded-md overflow-hidden grid grid-cols-3 grid-rows-3 gap-px bg-border shrink-0" aria-hidden>
      {palette.map((cls, i) => (
        <span key={i} className={cn("block", cls)} />
      ))}
    </div>
  );
}

function HeroMockup({ labels }: { labels: MockLabels }) {
  const alerts = [
    { name: "Suspect #12", cam: "Gate A", score: "92%", tone: "danger" as const },
    { name: "Suspect #07", cam: "Lobby", score: "71%", tone: "warning" as const },
    { name: "Unknown", cam: "Parking N", score: "48%", tone: "info" as const },
  ];
  const bars = [3, 5, 4, 7, 6, 9, 8];
  const sideIcons = [LayoutDashboard, Video, Search, Bell, BarChart3, Settings];
  return (
    <div className="relative">
      <div className="relative rounded-2xl border border-border-strong bg-surface/80 backdrop-blur-xl shadow-overlay overflow-hidden">
        {/* Window chrome */}
        <div className="flex items-center gap-2 px-3.5 h-9 border-b border-border bg-surface-elevated/70">
          <span className="w-2.5 h-2.5 rounded-full bg-danger/70" aria-hidden />
          <span className="w-2.5 h-2.5 rounded-full bg-warning/70" aria-hidden />
          <span className="w-2.5 h-2.5 rounded-full bg-success/70" aria-hidden />
          <span className="mx-auto inline-flex items-center gap-1.5 text-2xs font-mono text-text-muted bg-text-muted/[0.06] border border-border rounded-md px-2 py-0.5">
            <Lock className="w-2.5 h-2.5 opacity-70" aria-hidden />
            {labels.url}
          </span>
        </div>

        <div className="grid grid-cols-[44px_1fr] sm:grid-cols-[52px_1fr]">
          {/* Mini sidebar */}
          <div className="border-r border-border p-2 flex flex-col items-center gap-1.5 bg-surface/60">
            <span className="w-6 h-6 rounded-md bg-accent/20 border border-accent/30 mb-1" aria-hidden />
            {sideIcons.map((Icon, i) => (
              <span
                key={i}
                className={cn(
                  "w-7 h-7 rounded-md inline-flex items-center justify-center",
                  i === 0 ? "bg-accent/15 text-accent" : "text-text-faint",
                )}
                aria-hidden
              >
                <Icon className="w-3.5 h-3.5" />
              </span>
            ))}
          </div>

          <div className="p-3 sm:p-4 sm:pb-9 space-y-3">
            {/* Stat row */}
            <div className="grid grid-cols-3 gap-2">
              <MiniStat label={labels.faces} value="1,723" tone="info" bars={bars} />
              <MiniStat label={labels.alerts} value="3" tone="danger" bars={[2, 1, 4, 2, 5, 3, 6]} />
              <MiniStat label={labels.cameras} value="4" tone="accent" bars={[4, 4, 4, 4, 4, 4, 4]} />
            </div>

            {/* Alert list */}
            <div className="rounded-xl border border-border bg-surface-elevated/50 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-text-muted">
                  {labels.recent}
                </span>
                <span className="inline-flex items-center gap-1.5 text-2xs text-success">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" aria-hidden />
                  {labels.live}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {alerts.map((a, i) => (
                  <li key={a.name} className="flex items-center gap-2.5 px-3 py-2">
                    <MosaicAvatar variant={i} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-text truncate">{a.name}</div>
                      <div className="text-2xs text-text-muted truncate inline-flex items-center gap-1">
                        <Cctv className="w-2.5 h-2.5 opacity-60" aria-hidden />
                        {a.cam}
                      </div>
                    </div>
                    <span className={cn("badge", `badge-${a.tone}`)}>{a.score}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Status chips */}
            <div className="flex flex-wrap gap-1.5">
              <span className="badge-accent gap-1">
                <ShieldCheck className="w-3 h-3" aria-hidden />
                {labels.sealed}
              </span>
              <span className="badge-warning gap-1">
                <Clock className="w-3 h-3" aria-hidden />
                {labels.pending}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Floating approval card */}
      <div
        className="hidden sm:flex absolute -bottom-4 left-3 md:-left-6 items-center gap-2.5 rounded-xl border border-success/30 bg-surface-elevated/95 backdrop-blur-xl shadow-overlay px-3.5 py-2.5 animate-fade-in-up"
        style={{ animationDelay: "420ms" }}
      >
        <span className="w-7 h-7 rounded-full bg-success-soft text-success inline-flex items-center justify-center">
          <CheckCircle2 className="w-4 h-4" />
        </span>
        <span className="text-xs font-medium text-text">{labels.approved}</span>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
  bars,
}: {
  label: string;
  value: string;
  tone: "info" | "danger" | "accent";
  bars: number[];
}) {
  const barCls = { info: "bg-info/60", danger: "bg-danger/60", accent: "bg-accent/60" }[tone];
  const max = Math.max(...bars);
  return (
    <div className="rounded-lg border border-border bg-surface-elevated/50 px-2.5 py-2 min-w-0">
      <div className="text-[9px] uppercase tracking-[0.1em] text-text-muted truncate">{label}</div>
      <div className="flex items-end justify-between gap-2 mt-1">
        <span className="text-base sm:text-lg font-bold tracking-tight tabular-nums text-text">{value}</span>
        <span className="flex items-end gap-px h-5" aria-hidden>
          {bars.map((b, i) => (
            <span key={i} className={cn("w-1 rounded-sm", barCls)} style={{ height: `${(b / max) * 100}%` }} />
          ))}
        </span>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-2 px-4 sm:px-6 py-6 sm:py-7 text-left">
      <dt className="text-xs text-text-muted font-medium">{label}</dt>
      <dd className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight text-text tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/* ───────────────────────── Sections ───────────────────────── */

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
    <section id={id} className="mb-14 md:mb-20 border-t border-border pt-10 md:pt-12 animate-fade-in-up">
      <div className="flex items-center gap-3 mb-3">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10 text-accent border border-accent/20 text-sm font-mono font-bold">
          {String(index).padStart(2, "0")}
        </span>
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">
          {eyebrow}
        </span>
      </div>
      <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-text mb-2 text-balance">{title}</h2>
      <p className="text-base text-text-soft mb-6 max-w-3xl text-pretty leading-relaxed">{body}</p>
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
    <div className="card p-6 sm:p-7">
      <div className={`w-10 h-10 inline-flex items-center justify-center rounded-lg border mb-3 ${cls}`}>
        {icon}
      </div>
      <h3 className="text-base font-semibold tracking-tight text-text">{title}</h3>
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
    <div className="px-4 py-6 text-center border-border">
      <div className={`inline-flex items-center justify-center w-11 h-11 rounded-lg bg-text-muted/[0.04] border border-border ${toneCls} mb-2.5`}>
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
  href,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  highlight?: boolean;
  href: string;
  cta: string;
}) {
  return (
    <Link href={href as never} className={`${highlight ? "card-glow" : "card-hover"} group flex flex-col h-full p-6 sm:p-7`}>
      <div className="w-12 h-12 rounded-xl bg-accent/15 text-accent border border-accent/20 inline-flex items-center justify-center mb-3.5">
        {icon}
      </div>
      <h3 className="text-base font-semibold tracking-tight text-text">{title}</h3>
      <p className="text-sm text-text-muted mt-2 leading-relaxed flex-1">{body}</p>
      <span className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-accent">{cta}<ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" /></span>
    </Link>
  );
}

function SecPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-lg bg-surface-elevated border border-border hover:border-border-strong transition-colors">
      <span className="w-8 h-8 rounded-md bg-accent/10 text-accent border border-accent/20 inline-flex items-center justify-center shrink-0">
        {icon}
      </span>
      <span className="text-sm text-text">{label}</span>
    </div>
  );
}
