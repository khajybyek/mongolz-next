import type { Metadata, Route } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, Coins, Gamepad2, Lock, MessageCircle, Trophy, Users } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getServerLang } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";
import { SCH_GAMES, SCH_GAME_LABEL } from "@/lib/sch/schema";
import { readSchEvent } from "./actions";
import { SchForm } from "./sch-form";
import { formatAmount, formatGameDate, SCH_GAME_TONE, schCopy } from "./sch-copy";

export const dynamic = "force-dynamic";

/** Per-game accent for the schedule chips (theme tokens only). */
const TONE_CLASS = {
  accent: "",
  warning: "bg-warning-soft text-warning border-warning/20",
  info: "bg-info-soft text-info border-info/20",
} as const;

export const metadata: Metadata = {
  title: "SCH Esports · Chuseok 2026",
  description: "Chuseok 2026 SCH Esport тэмцээний бүртгэл — Mobile Legends, CS2, Dota 2.",
  robots: { index: false, follow: false },
};

export default async function SchRegistrationPage() {
  const lang = await getServerLang();
  const c = schCopy(lang);
  const event = await readSchEvent();
  const anyTeams = SCH_GAMES.some((g) => event.teamsPublished[g]);

  return (
    <>
      {/* ── Hero ── */}
      <section className="grid items-start gap-8 pb-10 pt-10 md:grid-cols-[1.15fr_1fr] md:pt-16 lg:gap-12">
        <div className="animate-fade-in-up">
          <div className="mb-5 inline-flex items-center gap-2.5 text-xs font-semibold tracking-wide text-accent">
            <span className="h-px w-6 bg-accent" aria-hidden />
            {c.eyebrow}
          </div>
          <h1 className="text-balance text-[2.1rem] font-semibold leading-[1.12] tracking-[-0.04em] text-gradient-soft sm:text-5xl">
            {event.title}
          </h1>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant={event.isOpen ? "success" : "danger"} dot>
              {event.isOpen ? c.openBadge : c.closedBadge}
            </Badge>
            {event.deadline && (
              <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                {c.deadline}: <span className="font-medium text-text-soft">{formatDate(event.deadline)}</span>
              </span>
            )}
          </div>

          {/* Game / date chips */}
          <ul className="mt-7 grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label={c.schedule}>
            {SCH_GAMES.map((g) => (
              <li key={g} className="card flex items-center gap-3 p-3.5">
                <span className={`icon-tile h-10 w-10 ${TONE_CLASS[SCH_GAME_TONE[g]]}`}>
                  <Gamepad2 className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight text-text">{SCH_GAME_LABEL[g]}</span>
                  <span className="block text-xs text-text-muted">{formatGameDate(event.gameDates[g], lang)}</span>
                </span>
              </li>
            ))}
          </ul>

          <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-xl border border-border bg-surface/70 p-4">
              <span className="icon-tile h-9 w-9"><Coins className="h-4 w-4" aria-hidden /></span>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-text-muted">{c.fee} · {c.feePerGame}</dt>
                <dd className="mt-0.5 text-base font-semibold tabular-nums text-text">
                  {formatAmount(event.feeKrw)} KRW
                  <span className="mx-1.5 text-text-faint" aria-hidden>/</span>
                  {formatAmount(event.feeMnt)} MNT
                </dd>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-border bg-surface/70 p-4">
              <span className="icon-tile h-9 w-9"><MessageCircle className="h-4 w-4" aria-hidden /></span>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-text-muted">{c.contact}</dt>
                <dd className="mt-0.5 break-words text-sm text-text">{event.contact ?? "—"}</dd>
              </div>
            </div>
          </dl>

          {anyTeams && (
            <Link href={"/sch/teams" as Route} className="btn-secondary mt-6">
              <Users className="h-4 w-4" aria-hidden />
              {c.teamsPublished} — {c.viewTeams}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </div>

        {/* Rules card */}
        <aside className="card-glass animate-fade-in-up p-6 sm:p-7" style={{ animationDelay: "120ms" }} aria-labelledby="sch-rules">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="icon-tile h-9 w-9"><Trophy className="h-4 w-4" aria-hidden /></span>
            <h2 id="sch-rules" className="text-base font-semibold tracking-tight text-text">{c.rules}</h2>
          </div>
          <p className="whitespace-pre-line text-sm leading-relaxed text-text-soft">
            {event.intro ?? c.successRule}
          </p>
          <div className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-xs leading-5 text-text-muted">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <p>{c.consent}</p>
          </div>
          {event.isOpen && (
            <a href="#sch-form" className="btn-primary mt-5 w-full sm:w-auto">
              {c.goToForm}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          )}
        </aside>
      </section>

      {!event.loaded && (
        <div className="mb-6">
          <Alert variant="warning">{c.offlineNote}</Alert>
        </div>
      )}

      {/* ── Form / closed ── */}
      <section id="sch-form" className="scroll-mt-24 border-t border-border pt-10 md:pt-12">
        {event.isOpen ? (
          <SchForm
            lang={lang}
            feeKrw={event.feeKrw}
            feeMnt={event.feeMnt}
            paymentInfo={event.paymentInfo}
            gameDates={event.gameDates}
          />
        ) : (
          <div className="card mx-auto max-w-xl p-8 text-center">
            <span className="icon-tile mx-auto mb-4 h-12 w-12"><Lock className="h-5 w-5" aria-hidden /></span>
            <h2 className="text-xl font-semibold tracking-tight text-text">{c.closedTitle}</h2>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">{c.closedBody}</p>
            {event.contact && <p className="mt-4 text-sm text-text-soft">{c.contact}: {event.contact}</p>}
            {anyTeams && (
              <Link href={"/sch/teams" as Route} className="btn-secondary mt-6">
                <Users className="h-4 w-4" aria-hidden />
                {c.viewTeams}
              </Link>
            )}
          </div>
        )}
      </section>
    </>
  );
}
