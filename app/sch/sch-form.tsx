"use client";

/**
 * SCH Esports — public registration form.
 *
 * One form for one person and up to three games. Submit runs in three
 * steps so the receipt image never travels through Next.js:
 *   1. prepareReceiptUpload  → submission id + signed upload URL
 *   2. browser → storage      (PUT to that signed URL, see uploadReceipt)
 *   3. submitSchRegistration → rows written after the server re-checks
 * Each step can fail on its own; the answers stay on screen and the user
 * retries without re-filling anything.
 *
 * Step 2 deliberately does not touch `supabase.storage` from this client
 * component: the repository forbids bucket access in client code
 * (__tests__/storage-policy-inventory.test.ts) because every bucket is
 * reached through a server gateway. The signed upload URL *is* that
 * gateway — the server minted it for exactly one object path — so the
 * browser only performs the PUT the SDK would have performed, with the same
 * headers, and gains real upload progress in the bargain.
 *
 * The answers are mirrored into sessionStorage (lib/sch/draft.ts): the
 * public language switcher hard-reloads the page, and a registrant who
 * switches language halfway through must not lose the form — nor an
 * already uploaded receipt, whose server-side bookkeeping is kept too.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  Gamepad2,
  ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  Wallet,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { Lang } from "@/lib/i18n/translations";
import { cn } from "@/lib/utils";
import {
  DOTA_RANKS,
  DOTA_ROLES,
  FACEIT_OPTIONS,
  ML_RANKS,
  ML_ROLES,
  RECEIPT_MAX_BYTES,
  SCH_GAMES,
  SCH_GAME_LABEL,
  SCH_LIMITS,
  isReceiptUploadMime,
  referenceCode,
  schPersonSchema,
  type ReceiptUploadMime,
  type SchGame,
} from "@/lib/sch/schema";
import { SCH_DRAFT_KEY, parseDraft, serialiseDraft, type SchDraftUpload } from "@/lib/sch/draft";
import { accountNumber, type SchFieldKey } from "@/lib/sch/submit";
import { prepareReceiptUpload, submitSchRegistration, type SubmitSchResult } from "./actions";
import { formatAmount, formatGameDate, schCopy, type SchCopy, localizeEventText } from "./sch-copy";

/* ─────────────────────────── types ─────────────────────────── */

interface Props {
  lang: Lang;
  feeKrw: number;
  feeMnt: number;
  paymentInfo: string | null;
  gameDates: Record<SchGame, string>;
}

type Phase = "idle" | "preparing" | "uploading" | "submitting";
/** Every inline error the form can show: the server-nameable fields plus the consent line. */
type ErrorKey = SchFieldKey | "consent";
type Errors = Partial<Record<ErrorKey, string>>;
type ServerError = Exclude<SubmitSchResult, { ok: true }> | { error: "upload" };
type Success = Extract<SubmitSchResult, { ok: true }>;

const ERROR_ORDER: ErrorKey[] = [
  "full_name", "email", "facebook", "games",
  "ml_rank", "ml_roles", "ml_id", "cs2_steam", "cs2_faceit",
  "dota_roles", "dota_rank", "dota_steam", "receipt", "consent",
];

/**
 * The e-mail rule is the server's own (`schPersonSchema`), not a look-alike
 * regex: a looser client check let addresses such as `a@b.c` or a Cyrillic
 * local part pass here, upload the receipt, and then fail the submit as a
 * generic "invalid" with no field highlighted.
 */
const emailSchema = schPersonSchema.shape.email;
const emailOk = (value: string): boolean => emailSchema.safeParse(value).success;
const STEAM_RE = /^(https?:\/\/)?(www\.)?steamcommunity\.com\/(id|profiles)\/[A-Za-z0-9_\-.]+\/?$/i;
/**
 * No HEIC: nothing but Safari decodes it, so the organiser could never open
 * the receipt in the console. With HEIC absent from `accept`, iOS converts a
 * camera photo to JPEG before handing it over.
 */
const EXT_MIME: Record<string, ReceiptUploadMime> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

/** Message per server-named field, for a rejection the client check did not catch. */
const FIELD_MESSAGE: Record<SchFieldKey, Exclude<keyof SchCopy, "weekdays">> = {
  full_name: "errName", email: "errEmail", facebook: "errFacebook", games: "errGames",
  ml_rank: "errRank", ml_roles: "errRoles", ml_id: "errRequired",
  cs2_steam: "errSteam", cs2_faceit: "errRequired",
  dota_roles: "errRoles", dota_rank: "errRank", dota_steam: "errSteam",
  receipt: "errReceiptAgain",
};

/** Some camera JPGs are reported with an empty type — fall back to the extension. */
function resolveMime(file: File): ReceiptUploadMime | null {
  if (isReceiptUploadMime(file.type)) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return EXT_MIME[ext] ?? null;
}

/** id of the description an `aria-describedby` should point at: the error when shown, else the hint. */
function describedBy(id: string, error?: string, hint?: string): string | undefined {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

/**
 * Bring the first invalid field into view and move focus onto its control
 * (the input itself; the first chip of a chip group; the file input or the
 * consent checkbox). Called for a submit only — never while correcting.
 */
function focusInvalid(key: ErrorKey): void {
  const anchor = document.getElementById(`sch-${key}`);
  if (!anchor) return;
  anchor.scrollIntoView({ block: "center", behavior: "smooth" });
  const control =
    key === "receipt" ? document.getElementById("sch-receipt-input")
    : key === "consent" ? document.getElementById("sch-consent-input")
    : anchor.matches("input, select, textarea") ? anchor
    : anchor.querySelector<HTMLElement>("button, input");
  control?.focus({ preventScroll: true });
}

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * PUT the receipt to the signed upload URL the server minted. Mirrors what
 * `storage.uploadToSignedUrl` sends for a raw body (x-upsert, cache-control,
 * content-type, anon api key) so the bucket's MIME allow-list sees the
 * resolved type even when the browser reported none. Resolves on a 2xx,
 * rejects otherwise; progress is reported as 0–100.
 */
/**
 * One production run showed the server storing the rows within a second
 * while the browser waited on the action response for over a minute. A
 * response that never arrives must not strand the registrant on a
 * spinner: after the deadline the step is reported as "unavailable" — the
 * answers and the uploaded receipt stay, and a re-submit with the same
 * submission id is answered by the server as a replay of the stored rows.
 */
const PREPARE_TIMEOUT_MS = 30_000;
const SUBMIT_TIMEOUT_MS = 60_000;
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | { error: "unavailable" }> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve({ error: "unavailable" }), ms);
    work.then(
      (v) => { window.clearTimeout(timer); resolve(v); },
      () => { window.clearTimeout(timer); resolve({ error: "unavailable" }); },
    );
  });
}

function uploadReceipt(signedUrl: string, file: File, mime: ReceiptUploadMime, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anonKey) {
      xhr.setRequestHeader("apikey", anonKey);
      xhr.setRequestHeader("authorization", `Bearer ${anonKey}`);
    }
    // Same header the SDK sends. The overwrite permission itself lives in
    // the token (prepareReceiptUpload mints it with `upsert: true`), which
    // is what makes a retry work when a PUT landed but its response never
    // reached the browser — this header alone would still answer 409.
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("content-type", mime);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("upload network error"));
    xhr.onabort = () => reject(new Error("upload aborted"));
    xhr.send(file);
  });
}

/* ─────────────────────────── component ─────────────────────────── */

export function SchForm({ lang, feeKrw, feeMnt, paymentInfo, gameDates }: Props) {
  const c = schCopy(lang);

  const [person, setPerson] = useState({ full_name: "", email: "", facebook: "", phone: "" });
  const [games, setGames] = useState<SchGame[]>([]);
  const [ml, setMl] = useState<{ rank: string; roles: string[]; in_game_id: string }>({ rank: "", roles: [], in_game_id: "" });
  const [cs2, setCs2] = useState<{ premier_rank: string; steam_url: string; faceit: string }>({ premier_rank: "", steam_url: "", faceit: "" });
  const [dota, setDota] = useState<{ roles: string[]; rank: string; steam_url: string }>({ roles: [], rank: "", steam_url: "" });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");

  const [errors, setErrors] = useState<Errors>({});
  /**
   * Which field a SUBMIT left invalid first, with a sequence so a repeated
   * submit on the same field re-triggers. Inline corrections never set it,
   * so fixing a chip cannot yank the page back to an earlier error.
   */
  const [focusTarget, setFocusTarget] = useState<{ key: ErrorKey; seq: number } | null>(null);
  const focusSeq = useRef(0);
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [success, setSuccess] = useState<Success | null>(null);
  /** Mirrors `uploadedPath` for the badge on the receipt card. */
  const [uploadedOk, setUploadedOk] = useState(false);
  const [progress, setProgress] = useState(0);
  /** A receipt uploaded before a reload: no File, but the object is in place. */
  const [restoredUpload, setRestoredUpload] = useState<SchDraftUpload["file"] | null>(null);
  const [draftNote, setDraftNote] = useState<"answers" | "answers_receipt" | null>(null);
  const draftReady = useRef(false);

  // Upload bookkeeping so a retry never re-uploads a receipt that is already in place.
  const prepared = useRef<{ submissionId: string; path: string; signedUrl: string } | null>(null);
  const uploadedPath = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const busy = phase !== "idle";
  const selectedInOrder = useMemo(() => SCH_GAMES.filter((g) => games.includes(g)), [games]);
  const totalKrw = feeKrw * selectedInOrder.length;
  const totalMnt = feeMnt * selectedInOrder.length;

  useEffect(() => {
    if (!receipt) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(receipt);
    setPreviewUrl(url);
    setPreviewFailed(false);
    return () => URL.revokeObjectURL(url);
  }, [receipt]);

  useEffect(() => {
    // Runs after the errors have rendered, so the focused control's
    // aria-describedby already points at an existing message.
    if (focusTarget) focusInvalid(focusTarget.key);
  }, [focusTarget]);

  /** Show `e` as the inline errors of a submit attempt and move to the first one. */
  function reportErrors(e: Errors): boolean {
    setErrors(e);
    const first = ERROR_ORDER.find((k) => e[k]);
    if (!first) return false;
    setFocusTarget({ key: first, seq: ++focusSeq.current });
    return true;
  }

  /* ── draft: restore once on mount, then mirror every change ── */
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(SCH_DRAFT_KEY);
    } catch {
      raw = null;
    }
    const draft = parseDraft(raw);
    if (draft) {
      setPerson(draft.person);
      setGames(draft.games);
      setMl(draft.ml);
      setCs2(draft.cs2);
      setDota(draft.dota);
      if (draft.upload) {
        prepared.current = { submissionId: draft.upload.submissionId, path: draft.upload.path, signedUrl: "" };
        uploadedPath.current = draft.upload.path;
        setUploadedOk(true);
        setRestoredUpload(draft.upload.file);
      }
      setDraftNote(draft.upload ? "answers_receipt" : "answers");
    }
    draftReady.current = true;
  }, []);

  useEffect(() => {
    if (!draftReady.current) return;
    let upload: SchDraftUpload | null = null;
    if (uploadedOk && prepared.current && uploadedPath.current) {
      const mime = receipt ? resolveMime(receipt) : null;
      const file = restoredUpload ?? (receipt && mime ? { name: receipt.name, size: receipt.size, mime } : null);
      if (file) upload = { submissionId: prepared.current.submissionId, path: uploadedPath.current, file };
    }
    try {
      window.sessionStorage.setItem(SCH_DRAFT_KEY, serialiseDraft({ person, games, ml, cs2, dota, upload }));
    } catch {
      // Private mode or a full quota: the form still works, it just will not survive a reload.
    }
  }, [person, games, ml, cs2, dota, uploadedOk, receipt, restoredUpload]);

  function clearDraft() {
    try {
      window.sessionStorage.removeItem(SCH_DRAFT_KEY);
    } catch {
      // ignore
    }
  }

  /* ── validation (mirrors lib/sch/schema.ts) ── */
  function validate(): Errors {
    const e: Errors = {};
    const name = person.full_name.trim();
    if (name.length < SCH_LIMITS.name.min || name.length > SCH_LIMITS.name.max) e.full_name = c.errName;
    if (!emailOk(person.email)) e.email = c.errEmail;
    const fb = person.facebook.trim();
    if (fb.length < SCH_LIMITS.facebook.min || fb.length > SCH_LIMITS.facebook.max) e.facebook = c.errFacebook;
    if (games.length === 0) e.games = c.errGames;
    if (games.includes("mobile_legends")) {
      if (!ml.rank) e.ml_rank = c.errRank;
      if (ml.roles.length === 0) e.ml_roles = c.errRoles;
      const id = ml.in_game_id.trim();
      if (id.length < SCH_LIMITS.inGameId.min || id.length > SCH_LIMITS.inGameId.max) e.ml_id = c.errRequired;
    }
    if (games.includes("cs2")) {
      if (!STEAM_RE.test(cs2.steam_url.trim()) || cs2.steam_url.trim().length > SCH_LIMITS.inGameId.max) e.cs2_steam = c.errSteam;
      if (!cs2.faceit) e.cs2_faceit = c.errRequired;
    }
    if (games.includes("dota2")) {
      if (dota.roles.length === 0) e.dota_roles = c.errRoles;
      if (!dota.rank) e.dota_rank = c.errRank;
      if (!STEAM_RE.test(dota.steam_url.trim()) || dota.steam_url.trim().length > SCH_LIMITS.inGameId.max) e.dota_steam = c.errSteam;
    }
    if (!receipt) {
      if (!restoredUpload) e.receipt = c.errReceipt;
    } else if (!resolveMime(receipt)) e.receipt = c.errReceiptType;
    else if (receipt.size > RECEIPT_MAX_BYTES || receipt.size <= 0) e.receipt = c.errReceiptSize;
    if (!consent) e.consent = c.errConsent;
    return e;
  }

  function onPickFile(file: File | null) {
    setReceipt(file);
    setErrors((prev) => ({ ...prev, receipt: undefined }));
    // A different file means a different object: forget the earlier upload.
    prepared.current = null;
    uploadedPath.current = null;
    setUploadedOk(false);
    setRestoredUpload(null);
    if (!file) return;
    const mime = resolveMime(file);
    if (!mime) setErrors((prev) => ({ ...prev, receipt: c.errReceiptType }));
    else if (file.size > RECEIPT_MAX_BYTES) setErrors((prev) => ({ ...prev, receipt: c.errReceiptSize }));
  }

  function buildEntries() {
    return selectedInOrder.map((g) => {
      if (g === "mobile_legends") return { game: g, rank: ml.rank, roles: ml.roles, in_game_id: ml.in_game_id.trim() };
      if (g === "cs2") return { game: g, premier_rank: cs2.premier_rank.trim(), steam_url: cs2.steam_url.trim(), faceit: cs2.faceit };
      return { game: g, roles: dota.roles, rank: dota.rank, steam_url: dota.steam_url.trim() };
    });
  }

  /** Forget the minted id + uploaded object; the next attempt starts from the mint step. */
  function forgetUpload() {
    prepared.current = null;
    uploadedPath.current = null;
    setUploadedOk(false);
    setRestoredUpload(null);
  }

  /* ── submit: prepare → upload → submit ── */
  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (busy) return;
    if (reportErrors(validate())) {
      setServerError(null);
      return;
    }
    setServerError(null);
    setDraftNote(null);

    try {
      if (!uploadedPath.current) {
        // validate() guarantees a File whenever nothing is uploaded yet.
        const file = receipt;
        const mime = file ? resolveMime(file) : null;
        if (!file || !mime) {
          setErrors((prev) => ({ ...prev, receipt: c.errReceiptAgain }));
          return;
        }
        if (!prepared.current) {
          setPhase("preparing");
          const r = await withTimeout(prepareReceiptUpload({ mime, bytes: file.size }), PREPARE_TIMEOUT_MS);
          if ("error" in r) { setServerError({ error: r.error }); setPhase("idle"); return; }
          prepared.current = { submissionId: r.submissionId, path: r.path, signedUrl: r.signedUrl };
        }
        setPhase("uploading");
        setProgress(0);
        try {
          await uploadReceipt(prepared.current.signedUrl, file, mime, setProgress);
        } catch {
          setServerError({ error: "upload" });
          setPhase("idle");
          return;
        }
        uploadedPath.current = prepared.current.path;
        setUploadedOk(true);
      }

      setPhase("submitting");
      const res = await withTimeout(submitSchRegistration({
        submission_id: prepared.current!.submissionId,
        receipt_path: uploadedPath.current,
        person: {
          full_name: person.full_name.trim(),
          email: person.email.trim(),
          facebook: person.facebook.trim(),
          phone: person.phone.trim(),
        },
        entries: buildEntries(),
        website,
      }), SUBMIT_TIMEOUT_MS);
      if ("error" in res) {
        if (res.error === "receipt_missing") {
          // The object is not there. Start from a fresh submission id: a
          // retry against the old signed URL could only collide or expire.
          forgetUpload();
          setServerError({ error: "upload" });
          if (!receipt) setErrors((prev) => ({ ...prev, receipt: c.errReceiptAgain }));
        } else if (res.error === "closed" || res.error === "conflict") {
          // Nothing more can be done with this submission id.
          forgetUpload();
          setServerError(res);
        } else if (res.error === "invalid" && res.fields?.length) {
          // The server named the rejected answers: highlight them like a
          // client-side miss instead of the generic "some answers were rejected".
          const named: Errors = {};
          for (const key of res.fields) named[key] = c[FIELD_MESSAGE[key]];
          reportErrors(named);
          setServerError(null);
        } else {
          // rate_limited / duplicate / invalid / unavailable: the server kept
          // the receipt, so the retry only re-submits — no second upload.
          setServerError(res);
        }
        setPhase("idle");
        return;
      }
      clearDraft();
      setSuccess(res);
      setPhase("idle");
    } catch {
      setServerError({ error: "unavailable" });
      setPhase("idle");
    }
  }

  function resetAll() {
    setPerson({ full_name: "", email: "", facebook: "", phone: "" });
    setGames([]);
    setMl({ rank: "", roles: [], in_game_id: "" });
    setCs2({ premier_rank: "", steam_url: "", faceit: "" });
    setDota({ roles: [], rank: "", steam_url: "" });
    setReceipt(null);
    setConsent(false);
    setWebsite("");
    setErrors({});
    setServerError(null);
    setSuccess(null);
    setDraftNote(null);
    forgetUpload();
    clearDraft();
    if (fileInput.current) fileInput.current.value = "";
  }

  if (success) {
    return (
      <SuccessPanel
        c={c}
        lang={lang}
        result={success}
        gameDates={gameDates}
        onReset={() => {
          resetAll();
          document.getElementById("sch-form")?.scrollIntoView({ block: "start", behavior: "smooth" });
        }}
      />
    );
  }

  const submitLabel =
    phase === "preparing" ? c.preparing
    : phase === "uploading" ? `${c.uploading} ${progress}%`
    : phase === "submitting" ? c.submitting
    : serverError?.error === "upload" ? c.retryUpload
    : c.submit;

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto max-w-3xl space-y-6" aria-busy={busy}>
      <div className="text-center sm:text-left">
        <h2 className="text-2xl font-semibold tracking-tight text-text">{c.formTitle}</h2>
        <p className="mt-1.5 text-sm text-text-muted">{c.formHint}</p>
      </div>

      {draftNote && (
        <Alert variant="info" onClose={() => setDraftNote(null)}>
          {c.draftRestored}
          {draftNote === "answers_receipt" && <> {c.draftReceiptKept}</>}
        </Alert>
      )}

      {/* ── 1. Player ── */}
      <Section step={1} title={c.stepPlayer}>
        <Field id="sch-full_name" label={c.fullName} required error={errors.full_name} hint={c.fullNameHint}>
          <input
            id="sch-full_name"
            name="full_name"
            className={cn("input", errors.full_name && "input-error")}
            autoComplete="name"
            maxLength={SCH_LIMITS.name.max}
            value={person.full_name}
            onChange={(e) => setPerson({ ...person, full_name: e.target.value })}
            aria-invalid={Boolean(errors.full_name)}
            aria-describedby={describedBy("sch-full_name", errors.full_name, c.fullNameHint)}
            disabled={busy}
          />
        </Field>
        <Field id="sch-email" label={c.email} required error={errors.email}>
          <input
            id="sch-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            className={cn("input", errors.email && "input-error")}
            value={person.email}
            onChange={(e) => setPerson({ ...person, email: e.target.value })}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy("sch-email", errors.email)}
            disabled={busy}
          />
        </Field>
        <Field id="sch-facebook" label={c.facebook} required error={errors.facebook} hint={c.facebookHint}>
          <input
            id="sch-facebook"
            name="facebook"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={SCH_LIMITS.facebook.max}
            placeholder="facebook.com/…"
            className={cn("input", errors.facebook && "input-error")}
            value={person.facebook}
            onChange={(e) => setPerson({ ...person, facebook: e.target.value })}
            aria-invalid={Boolean(errors.facebook)}
            aria-describedby={describedBy("sch-facebook", errors.facebook, c.facebookHint)}
            disabled={busy}
          />
        </Field>
        <Field id="sch-phone" label={c.phone} optional={c.optional}>
          <input
            id="sch-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={SCH_LIMITS.phone.max}
            className="input"
            value={person.phone}
            onChange={(e) => setPerson({ ...person, phone: e.target.value })}
            disabled={busy}
          />
        </Field>
      </Section>

      {/* ── 2. Games ── */}
      <Section step={2} title={c.stepGames} hint={c.gamesHint}>
        <div
          id="sch-games"
          role="group"
          aria-label={c.stepGames}
          aria-invalid={Boolean(errors.games)}
          aria-describedby={errors.games ? "sch-games-error" : undefined}
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {SCH_GAMES.map((g) => {
            const on = games.includes(g);
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                disabled={busy}
                onClick={() => {
                  setGames((prev) => toggle(prev, g));
                  setErrors((prev) => ({ ...prev, games: undefined }));
                }}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3.5 text-left transition",
                  on ? "border-accent bg-accent/10 shadow-glow-soft" : "border-border bg-surface-elevated/60 hover:border-border-strong",
                )}
              >
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", on ? "border-accent/30 bg-accent text-bg" : "border-border bg-surface text-text-muted")}>
                  {on ? <Check className="h-4 w-4" aria-hidden /> : <Gamepad2 className="h-4 w-4" aria-hidden />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-text">{SCH_GAME_LABEL[g]}</span>
                  <span className="block text-xs text-text-muted">{formatGameDate(gameDates[g], lang)} · {formatAmount(feeKrw)} KRW</span>
                </span>
              </button>
            );
          })}
        </div>
        {errors.games && <p id="sch-games-error" className="helper-error">{errors.games}</p>}

        {games.includes("mobile_legends") && (
          <GameSection label={SCH_GAME_LABEL.mobile_legends} date={formatGameDate(gameDates.mobile_legends, lang)}>
            <ChoiceGroup
              id="sch-ml_rank"
              label={c.mlRank}
              required
              error={errors.ml_rank}
              options={ML_RANKS}
              value={ml.rank ? [ml.rank] : []}
              onToggle={(v) => { setMl({ ...ml, rank: v }); setErrors((p) => ({ ...p, ml_rank: undefined })); }}
              single
              disabled={busy}
            />
            <ChoiceGroup
              id="sch-ml_roles"
              label={c.mlRoles}
              required
              error={errors.ml_roles}
              options={ML_ROLES}
              value={ml.roles}
              onToggle={(v) => { setMl({ ...ml, roles: toggle(ml.roles, v) }); setErrors((p) => ({ ...p, ml_roles: undefined })); }}
              disabled={busy}
            />
            <Field id="sch-ml_id" label={c.mlId} required error={errors.ml_id} hint={c.mlIdHint}>
              <input
                id="sch-ml_id"
                inputMode="text"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={SCH_LIMITS.inGameId.max}
                className={cn("input", errors.ml_id && "input-error")}
                value={ml.in_game_id}
                onChange={(e) => setMl({ ...ml, in_game_id: e.target.value })}
                aria-invalid={Boolean(errors.ml_id)}
                aria-describedby={describedBy("sch-ml_id", errors.ml_id, c.mlIdHint)}
                disabled={busy}
              />
            </Field>
          </GameSection>
        )}

        {games.includes("cs2") && (
          <GameSection label={SCH_GAME_LABEL.cs2} date={formatGameDate(gameDates.cs2, lang)}>
            <Field id="sch-cs2_premier" label={c.cs2Premier} optional={c.optional} hint={c.cs2PremierHint}>
              <input
                id="sch-cs2_premier"
                inputMode="numeric"
                maxLength={SCH_LIMITS.premier.max}
                className="input"
                value={cs2.premier_rank}
                onChange={(e) => setCs2({ ...cs2, premier_rank: e.target.value })}
                aria-describedby={describedBy("sch-cs2_premier", undefined, c.cs2PremierHint)}
                disabled={busy}
              />
            </Field>
            <Field id="sch-cs2_steam" label={c.steamUrl} required error={errors.cs2_steam} hint={c.steamHint}>
              <input
                id="sch-cs2_steam"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={SCH_LIMITS.inGameId.max}
                placeholder="https://steamcommunity.com/id/…"
                className={cn("input", errors.cs2_steam && "input-error")}
                value={cs2.steam_url}
                onChange={(e) => setCs2({ ...cs2, steam_url: e.target.value })}
                aria-invalid={Boolean(errors.cs2_steam)}
                aria-describedby={describedBy("sch-cs2_steam", errors.cs2_steam, c.steamHint)}
                disabled={busy}
              />
            </Field>
            <ChoiceGroup
              id="sch-cs2_faceit"
              label={c.faceit}
              required
              error={errors.cs2_faceit}
              options={FACEIT_OPTIONS}
              labels={{ yes: c.faceitYes, no: c.faceitNo }}
              value={cs2.faceit ? [cs2.faceit] : []}
              onToggle={(v) => { setCs2({ ...cs2, faceit: v }); setErrors((p) => ({ ...p, cs2_faceit: undefined })); }}
              single
              disabled={busy}
            />
          </GameSection>
        )}

        {games.includes("dota2") && (
          <GameSection label={SCH_GAME_LABEL.dota2} date={formatGameDate(gameDates.dota2, lang)}>
            <ChoiceGroup
              id="sch-dota_roles"
              label={c.dotaRoles}
              required
              error={errors.dota_roles}
              options={DOTA_ROLES}
              value={dota.roles}
              onToggle={(v) => { setDota({ ...dota, roles: toggle(dota.roles, v) }); setErrors((p) => ({ ...p, dota_roles: undefined })); }}
              disabled={busy}
            />
            <ChoiceGroup
              id="sch-dota_rank"
              label={c.dotaRank}
              required
              error={errors.dota_rank}
              options={DOTA_RANKS}
              value={dota.rank ? [dota.rank] : []}
              onToggle={(v) => { setDota({ ...dota, rank: v }); setErrors((p) => ({ ...p, dota_rank: undefined })); }}
              single
              disabled={busy}
            />
            <Field id="sch-dota_steam" label={c.steamUrl} required error={errors.dota_steam} hint={c.steamHint}>
              <input
                id="sch-dota_steam"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={SCH_LIMITS.inGameId.max}
                placeholder="https://steamcommunity.com/id/…"
                className={cn("input", errors.dota_steam && "input-error")}
                value={dota.steam_url}
                onChange={(e) => setDota({ ...dota, steam_url: e.target.value })}
                aria-invalid={Boolean(errors.dota_steam)}
                aria-describedby={describedBy("sch-dota_steam", errors.dota_steam, c.steamHint)}
                disabled={busy}
              />
            </Field>
          </GameSection>
        )}
      </Section>

      {/* ── 3. Payment ── */}
      <Section step={3} title={c.payment} hint={c.paymentHint}>
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3.5">
          <div>
            <div className="text-xs font-medium text-text-muted">
              {c.total} · {selectedInOrder.length} {c.games} × {formatAmount(feeKrw)} KRW
            </div>
            <div className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight text-text">
              {formatAmount(totalKrw)} <span className="text-base font-medium text-text-soft">KRW</span>
            </div>
          </div>
          <div className="text-right text-sm tabular-nums text-text-soft">
            {formatAmount(totalMnt)} MNT
            <span className="block text-xs text-text-muted">{selectedInOrder.length} × {formatAmount(feeMnt)} MNT</span>
          </div>
        </div>

        <PaymentInfo c={c} text={paymentInfo} />

        <p className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm font-bold leading-relaxed text-warning">
          {c.warning}
        </p>

        <div id="sch-receipt">
          <span className="label">
            {c.receipt} <span className="text-danger" aria-hidden>*</span>
          </span>
          <input
            ref={fileInput}
            id="sch-receipt-input"
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={busy}
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            aria-describedby={errors.receipt ? "sch-receipt-error" : "sch-receipt-hint"}
            aria-invalid={Boolean(errors.receipt)}
          />
          {receipt || restoredUpload ? (
            <div className={cn("flex flex-col gap-3 rounded-xl border bg-surface-elevated/60 p-3 sm:flex-row sm:items-center", errors.receipt ? "border-danger/60" : "border-border")}>
              <div className="flex h-28 w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-bg-secondary sm:h-24 sm:w-32">
                {previewUrl && !previewFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                  <img src={previewUrl} alt="" className="h-full w-full object-cover" onError={() => setPreviewFailed(true)} />
                ) : (
                  <span className="flex flex-col items-center gap-1 px-2 text-center text-[11px] text-text-muted">
                    <ImageIcon className="h-5 w-5" aria-hidden />
                    {c.noPreview}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                {/* Same id as the empty-state hint, so the input's description never dangles. */}
                <span id="sch-receipt-hint" className="sr-only">{c.receiptHint}</span>
                <div className="truncate text-sm font-medium text-text">{receipt?.name ?? restoredUpload?.name}</div>
                <div className="text-xs text-text-muted">{(((receipt?.size ?? restoredUpload?.size) ?? 0) / (1024 * 1024)).toFixed(2)} MB</div>
                {uploadedOk && (
                  <Badge variant="success" dot className="mt-1.5">
                    <CheckCircle2 className="h-3 w-3" aria-hidden />
                    {c.receiptUploaded}
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                <label htmlFor="sch-receipt-input" className={cn("btn-secondary btn-sm cursor-pointer", busy && "pointer-events-none opacity-60")}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  {c.replace}
                </label>
                <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={() => { onPickFile(null); if (fileInput.current) fileInput.current.value = ""; }}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  {c.remove}
                </button>
              </div>
            </div>
          ) : (
            <label
              htmlFor="sch-receipt-input"
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition hover:border-accent/60 hover:bg-accent/5",
                errors.receipt ? "border-danger/60" : "border-border-strong",
                busy && "pointer-events-none opacity-60",
              )}
            >
              <span className="icon-tile h-11 w-11"><Upload className="h-5 w-5" aria-hidden /></span>
              <span className="text-sm font-medium text-text">{c.chooseImage}</span>
              <span id="sch-receipt-hint" className="text-xs text-text-muted">{c.receiptHint}</span>
            </label>
          )}
          {errors.receipt && <p id="sch-receipt-error" className="helper-error">{errors.receipt}</p>}
        </div>
      </Section>

      {/* ── consent + honeypot + submit ── */}
      <div id="sch-consent" className="space-y-4">
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-text-soft">
          <input
            id="sch-consent-input"
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
            checked={consent}
            onChange={(e) => { setConsent(e.target.checked); setErrors((p) => ({ ...p, consent: undefined })); }}
            aria-invalid={Boolean(errors.consent)}
            aria-describedby={errors.consent ? "sch-consent-error" : undefined}
            disabled={busy}
          />
          <span>{c.consent}</span>
        </label>
        {errors.consent && <p id="sch-consent-error" className="helper-error -mt-2">{errors.consent}</p>}

        {/* Honeypot: real browsers leave it empty. */}
        <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
          <label htmlFor="sch-website">Website</label>
          <input id="sch-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>

        {serverError && <ServerErrorAlert c={c} err={serverError} onClose={() => setServerError(null)} />}
        {Object.values(errors).some(Boolean) && !serverError && <Alert variant="danger">{c.errFix}</Alert>}

        <button type="submit" className="btn-primary btn-lg w-full sm:w-auto" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Wallet className="h-4 w-4" aria-hidden />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function Section({ step, title, hint, children }: { step: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="card space-y-5 p-5 sm:p-6">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 font-mono text-sm font-bold text-accent">
          {String(step).padStart(2, "0")}
        </span>
        <div>
          <div className="text-base font-semibold tracking-tight text-text">{title}</div>
          {hint && <div className="text-xs text-text-muted">{hint}</div>}
        </div>
      </div>
      {children}
    </fieldset>
  );
}

function GameSection({ label, date, children }: { label: string; date: string; children: React.ReactNode }) {
  return (
    <div className="animate-fade-in space-y-5 rounded-xl border border-border bg-surface-elevated/40 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">{label}</h3>
        <Badge variant="accent">{date}</Badge>
      </div>
      {children}
    </div>
  );
}

function Field({
  id, label, required, optional, hint, error, children,
}: {
  id: string; label: string; required?: boolean; optional?: string; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {required && <span className="ml-1 text-danger" aria-hidden>*</span>}
        {optional && <span className="ml-1.5 text-xs font-normal text-text-muted">({optional})</span>}
      </label>
      {children}
      {/* Ids match `describedBy(id, …)` so the control announces its own message. */}
      {error ? <p id={`${id}-error`} className="helper-error">{error}</p> : hint ? <p id={`${id}-hint`} className="helper">{hint}</p> : null}
    </div>
  );
}

/** Segmented chips: `single` behaves like radios, otherwise like checkboxes. */
function ChoiceGroup({
  id, label, required, error, options, labels, value, onToggle, single, disabled,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  options: readonly string[];
  labels?: Record<string, string>;
  value: string[];
  onToggle: (v: string) => void;
  single?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      id={id}
      role={single ? "radiogroup" : "group"}
      aria-labelledby={`${id}-label`}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <span id={`${id}-label`} className="label">
        {label}
        {required && <span className="ml-1 text-danger" aria-hidden>*</span>}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button
              key={o}
              type="button"
              role={single ? "radio" : "checkbox"}
              aria-checked={on}
              disabled={disabled}
              onClick={() => onToggle(o)}
              className={cn(
                "inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition",
                on
                  ? "border-accent bg-accent/15 font-medium text-accent"
                  : "border-border bg-surface-elevated/60 text-text-soft hover:border-border-strong hover:text-text",
                error && !on && "border-danger/40",
              )}
            >
              {on && <Check className="h-3.5 w-3.5" aria-hidden />}
              {labels?.[o] ?? o}
            </button>
          );
        })}
      </div>
      {error && <p id={`${id}-error`} className="helper-error">{error}</p>}
    </div>
  );
}

/** Bank details from `sch_event.payment_info`; lines with an account-like number get a copy button. */
function PaymentInfo({ c, text }: { c: SchCopy; text: string | null }) {
  const [copied, setCopied] = useState<number | null>(null);
  const lines = useMemo(() => (text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean), [text]);

  /** Only the account number reaches the clipboard — it is what the banking app asks for. */
  async function copyLine(i: number, account: string) {
    try {
      await navigator.clipboard.writeText(account);
      setCopied(i);
      window.setTimeout(() => setCopied((cur) => (cur === i ? null : cur)), 1600);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div>
      <span className="label">{c.accounts}</span>
      {lines.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface-elevated/60 px-4 py-3 text-sm text-text-muted">{c.paymentTba}</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-elevated/60">
          {lines.map((line, i) => {
            const account = accountNumber(line);
            return (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className={cn("min-w-0 break-words text-sm", account ? "font-medium text-text" : "text-text-soft")}>{line}</span>
                {account && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm shrink-0"
                    onClick={() => copyLine(i, account)}
                    aria-live="polite"
                    aria-label={`${c.copyAccount} ${account}`}
                    title={account}
                  >
                    {copied === i ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    {copied === i ? c.copied : c.copyAccount}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ServerErrorAlert({ c, err, onClose }: { c: SchCopy; err: ServerError; onClose: () => void }) {
  const text =
    err.error === "duplicate" ? `${c.errDuplicate} ${SCH_GAME_LABEL[err.game]}`
    : err.error === "rate_limited" ? c.errRateLimited
    : err.error === "closed" ? c.errClosed
    : err.error === "invalid" ? c.errInvalid
    : err.error === "upload" || err.error === "receipt_missing" ? c.errUpload
    : err.error === "conflict" ? c.errConflict
    : c.errUnavailable;
  return <Alert variant="danger" onClose={onClose}>{text}</Alert>;
}

function SuccessPanel({
  c, lang, result, gameDates, onReset,
}: {
  c: SchCopy; lang: Lang; result: Success; gameDates: Record<SchGame, string>; onReset: () => void;
}) {
  const n = result.games.length;
  return (
    <div className="card-glow mx-auto max-w-2xl animate-scale-in p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight text-text">{c.successTitle}</h2>
          <p className="mt-1 text-sm text-text-muted">{c.successRule}</p>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-accent/25 bg-accent/5 p-4">
          <dt className="text-xs font-medium text-text-muted">{c.successRef}</dt>
          <dd className="mt-1 font-mono text-2xl font-bold tracking-[0.12em] text-accent">{referenceCode(result.submissionId)}</dd>
          <dd className="mt-1 text-xs text-text-muted">{c.successRefHint}</dd>
        </div>
        <div className="rounded-xl border border-border bg-surface-elevated/60 p-4">
          <dt className="text-xs font-medium text-text-muted">{c.successTotal}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-text">
            {formatAmount(result.feeKrw * n)} <span className="text-sm font-medium text-text-soft">KRW</span>
          </dd>
          <dd className="text-sm tabular-nums text-text-soft">{formatAmount(result.feeMnt * n)} MNT · {n} {c.games}</dd>
        </div>
      </dl>

      <div className="mt-5">
        <span className="label">{c.successGames}</span>
        <ul className="flex flex-wrap gap-2">
          {result.games.map((g) => (
            <li key={g}>
              <Badge variant="accent" className="px-2.5 py-1 text-xs">
                {SCH_GAME_LABEL[g]} · {formatGameDate(gameDates[g], lang)}
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5">
        <span className="label">{c.successPay}</span>
        <p className="whitespace-pre-line rounded-xl border border-border bg-surface-elevated/60 px-4 py-3 text-sm leading-relaxed text-text">
          {localizeEventText(result.paymentInfo, "payment", lang) ?? c.paymentTba}
        </p>
      </div>

      <button type="button" className="btn-secondary mt-6" onClick={onReset}>
        <RefreshCw className="h-4 w-4" aria-hidden />
        {c.successAnother}
      </button>
    </div>
  );
}
