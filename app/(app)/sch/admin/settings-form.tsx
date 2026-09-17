"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Settings2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import { SCH_GAMES, SCH_GAME_LABEL, type SchGame } from "@/lib/sch/schema";
import { fill, schAdminCopy } from "./admin-copy";
import { updateEventSettingsAction, type SchActionResult, type SchEventSettingsInput } from "./actions";

/** Serialisable event settings the page hands to the dialog. */
export interface SchEventView {
  title: string;
  intro: string | null;
  registration_open: boolean;
  registration_deadline: string | null;
  fee_krw: number;
  fee_mnt: number;
  payment_info: string | null;
  contact: string | null;
  game_dates: Record<SchGame, string>;
  teams_published: Record<SchGame, boolean>;
}

const KST_LOCAL = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** ISO instant → "YYYY-MM-DDTHH:mm" on the Asia/Seoul wall clock (datetime-local value). */
export function toKstLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const part: Record<string, string> = {};
  for (const p of KST_LOCAL.formatToParts(d)) part[p.type] = p.value;
  const hour = part.hour === "24" ? "00" : part.hour;
  return `${part.year}-${part.month}-${part.day}T${hour}:${part.minute}`;
}

export function SettingsForm({ event }: { event: SchEventView }) {
  const { lang } = useT();
  const copy = schAdminCopy(lang);
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState(event.title);
  const [intro, setIntro] = useState(event.intro ?? "");
  const [registrationOpen, setRegistrationOpen] = useState(event.registration_open);
  const [deadline, setDeadline] = useState(toKstLocalInput(event.registration_deadline));
  const [feeKrw, setFeeKrw] = useState(String(event.fee_krw));
  const [feeMnt, setFeeMnt] = useState(String(event.fee_mnt));
  const [paymentInfo, setPaymentInfo] = useState(event.payment_info ?? "");
  const [contact, setContact] = useState(event.contact ?? "");
  const [dates, setDates] = useState<Record<SchGame, string>>({ ...event.game_dates });
  const [published, setPublished] = useState<Record<SchGame, boolean>>({ ...event.teams_published });

  function reset() {
    setTitle(event.title);
    setIntro(event.intro ?? "");
    setRegistrationOpen(event.registration_open);
    setDeadline(toKstLocalInput(event.registration_deadline));
    setFeeKrw(String(event.fee_krw));
    setFeeMnt(String(event.fee_mnt));
    setPaymentInfo(event.payment_info ?? "");
    setContact(event.contact ?? "");
    setDates({ ...event.game_dates });
    setPublished({ ...event.teams_published });
  }

  function show() {
    reset();
    setOpen(true);
  }

  function close() {
    if (!pending) setOpen(false);
  }

  function errorTitle(result: Exclude<SchActionResult, { ok: true }>): string {
    if (result.error === "no_teams") return fill(copy.saveFirstGame, { game: SCH_GAME_LABEL[result.game] });
    return result.error === "conflict" ? copy.conflict : result.error === "invalid" ? copy.invalid : copy.unavailable;
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const payload: SchEventSettingsInput = {
      title,
      intro,
      registration_open: registrationOpen,
      registration_deadline: deadline,
      fee_krw: Number(feeKrw),
      fee_mnt: Number(feeMnt),
      payment_info: paymentInfo,
      contact,
      game_dates: { ...dates },
      teams_published: { ...published },
    };
    startTransition(async () => {
      let result: SchActionResult;
      try {
        result = await updateEventSettingsAction(payload);
      } catch {
        result = { error: "unavailable" };
      }
      if ("error" in result) {
        toast({ title: errorTitle(result), tone: "danger" });
        if (result.error === "conflict") router.refresh();
        return;
      }
      toast({ title: copy.settingsSaved, tone: "success", duration: 2000 });
      setOpen(false);
      router.refresh();
    });
  }

  const formId = "sch-settings-form";

  return (
    <>
      <button type="button" className="btn-secondary" onClick={show}>
        <Settings2 className="h-4 w-4" aria-hidden />{copy.settings}
      </button>

      <Dialog
        open={open}
        onClose={close}
        title={copy.settingsTitle}
        description={copy.settingsDesc}
        size="lg"
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={close} disabled={pending}>{copy.cancel}</button>
            <button type="submit" form={formId} className="btn-primary" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              {pending ? copy.saving : copy.save}
            </button>
          </>
        }
      >
        <form id={formId} onSubmit={submit} className="space-y-5">
          <div>
            <label className="label" htmlFor="sch-title">{copy.eventTitle}</label>
            <input id="sch-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={120} required />
          </div>
          <div>
            <label className="label" htmlFor="sch-intro">{copy.intro}</label>
            <textarea id="sch-intro" className="input resize-y" rows={4} maxLength={4000} value={intro} onChange={(e) => setIntro(e.target.value)} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-bg-secondary/40 p-3 text-sm">
              <input type="checkbox" className="accent-accent" checked={registrationOpen} onChange={(e) => setRegistrationOpen(e.target.checked)} />
              <span className="font-medium text-text">{copy.registrationOpen}</span>
            </label>
            <div>
              <label className="label" htmlFor="sch-deadline">{copy.deadline}</label>
              <input id="sch-deadline" className="input" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              <p className="helper">{copy.deadlineHint}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="sch-fee-krw">{copy.feeKrw}</label>
              <input id="sch-fee-krw" className="input num" type="number" inputMode="numeric" min={0} max={100000000} step={1} value={feeKrw} onChange={(e) => setFeeKrw(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="sch-fee-mnt">{copy.feeMnt}</label>
              <input id="sch-fee-mnt" className="input num" type="number" inputMode="numeric" min={0} max={100000000} step={1} value={feeMnt} onChange={(e) => setFeeMnt(e.target.value)} required />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="sch-payment">{copy.paymentInfo}</label>
            <textarea id="sch-payment" className="input resize-y font-mono text-xs" rows={4} maxLength={1000} value={paymentInfo} onChange={(e) => setPaymentInfo(e.target.value)} />
            <p className="helper">{copy.paymentHint}</p>
          </div>
          <div>
            <label className="label" htmlFor="sch-contact">{copy.contact}</label>
            <input id="sch-contact" className="input" maxLength={300} value={contact} onChange={(e) => setContact(e.target.value)} />
            <p className="helper">{copy.contactHint}</p>
          </div>

          <fieldset className="space-y-2">
            <legend className="label">{copy.gameDates}</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {SCH_GAMES.map((g) => (
                <div key={g}>
                  <label className="text-xs text-text-soft" htmlFor={`sch-date-${g}`}>{SCH_GAME_LABEL[g]}</label>
                  <input
                    id={`sch-date-${g}`}
                    className="input mt-1"
                    type="date"
                    value={dates[g]}
                    onChange={(e) => setDates({ ...dates, [g]: e.target.value })}
                    required
                  />
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="label">{copy.publishTeams}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {SCH_GAMES.map((g) => (
                <label key={g} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-bg-secondary/40 p-3 text-sm">
                  <input type="checkbox" className="accent-accent" checked={published[g]} onChange={(e) => setPublished({ ...published, [g]: e.target.checked })} />
                  <span className="text-text">{SCH_GAME_LABEL[g]}</span>
                </label>
              ))}
            </div>
            <p className="helper">{copy.publishHint}</p>
          </fieldset>
        </form>
      </Dialog>
    </>
  );
}
