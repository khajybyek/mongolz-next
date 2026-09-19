"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileSpreadsheet, Link2, ListChecks, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import { SCH_GAME_LABEL } from "@/lib/sch/schema";
import { guessMapping, looksLikeHeader, parseDelimitedDetailed } from "@/lib/sch/import";
import {
  IMPORT_FIELDS,
  IMPORT_MAX_PAYLOAD_BYTES,
  IMPORT_MAX_ROWS,
  isImportField,
  type ImportField,
  type ImportIssue,
  type ImportMapping,
  type SchImportCommitInput,
  type SchImportPreview,
  type SchImportResult,
} from "@/lib/sch/import-types";
import {
  fill,
  schAdminCopy,
  schImportFieldLabel,
  schImportIssueLabel,
  schImportStateLabel,
  schImportStateVariant,
  schStatusLabel,
  type SchAdminCopy,
} from "./admin-copy";
import { commitSchImportAction, previewSchImportAction } from "./import-actions";

type Step = 1 | 2 | 3;
type ImportStatus = SchImportCommitInput["status"];
type PreviewOk = Extract<SchImportPreview, { ok: true }>;
type ErrorKey = "impErrUnreadable" | "impErrFileTooLarge" | "impErrEmpty" | "impErrInvalid" | "impErrTooLarge" | "unavailable";

/** Same cap the XLSX reader enforces; a CSV beyond it is not a form sheet either. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Without these three the database refuses the row, so checking is pointless. */
const REQUIRED_FIELDS: ImportField[] = ["full_name", "email", "facebook"];

function serverErrorKey(code: "invalid" | "too_large" | "unavailable"): ErrorKey {
  return code === "invalid" ? "impErrInvalid" : code === "too_large" ? "impErrTooLarge" : "unavailable";
}

/**
 * Only the mapped columns leave the browser: the payload stays small and the
 * answers the organiser chose to ignore are never sent. Row order (and with it
 * the sheet row numbers in the preview) is unchanged.
 */
function compactInput(table: string[][], mapping: ImportMapping, hasHeader: boolean) {
  const keep = mapping.map((f, i) => (f === "ignore" ? -1 : i)).filter((i) => i >= 0);
  return {
    table: table.map((r) => keep.map((i) => r[i] ?? "")),
    mapping: keep.map((i) => mapping[i]),
    hasHeader,
  };
}

/**
 * Organiser console — import the Google Form response sheet. The browser only
 * parses and proposes a column mapping; the server re-validates every row for
 * the preview and again for the commit, so nothing shown here is trusted.
 */
export function ImportDialog() {
  const { lang } = useT();
  const copy = schAdminCopy(lang);
  const { toast } = useToast();
  const router = useRouter();
  const uid = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [reading, setReading] = useState(false);
  const [pasted, setPasted] = useState("");
  const [table, setTable] = useState<string[][]>([]);
  const [truncated, setTruncated] = useState(false);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ImportMapping>([]);
  const [status, setStatus] = useState<ImportStatus>("pending");
  const [preview, setPreview] = useState<PreviewOk | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);

  const busy = pending || reading;

  // Step change → the heading takes focus, so a screen reader announces where
  // the organiser landed and the keyboard continues from the top of the step.
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, step]);

  function reset() {
    setStep(1);
    setPasted("");
    setTable([]);
    setTruncated(false);
    setMapping([]);
    setStatus("pending");
    setPreview(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function close() {
    if (busy) return;
    setOpen(false);
    reset();
  }

  function accept(next: string[][], wasTruncated: boolean) {
    if (next.length === 0) {
      setError("impErrEmpty");
      return;
    }
    const header = looksLikeHeader(next[0]);
    if (next.length - (header ? 1 : 0) <= 0) {
      setError("impErrEmpty");
      return;
    }
    setTable(next);
    setTruncated(wasTruncated);
    setHasHeader(header);
    setMapping(guessMapping(header ? next[0] : [], next.slice(header ? 1 : 0, 26)));
    setPreview(null);
    setError(null);
    setStep(2);
  }

  async function readFile(file: File) {
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError("impErrFileTooLarge");
      return;
    }
    setReading(true);
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const { readXlsxFirstSheetDetailed } = await import("@/lib/sch/xlsx");
        const parsed = await readXlsxFirstSheetDetailed(await file.arrayBuffer());
        accept(parsed.table, parsed.truncated);
      } else {
        const parsed = parseDelimitedDetailed(await file.text());
        accept(parsed.table, parsed.truncated);
      }
    } catch (e) {
      setError(e instanceof Error && e.message === "xlsx_too_large" ? "impErrFileTooLarge" : "impErrUnreadable");
    } finally {
      setReading(false);
    }
  }

  function readPasted() {
    setError(null);
    try {
      const parsed = parseDelimitedDetailed(pasted);
      accept(parsed.table, parsed.truncated);
    } catch {
      setError("impErrUnreadable");
    }
  }

  function toggleHeader(next: boolean) {
    setHasHeader(next);
    setMapping(guessMapping(next ? table[0] ?? [] : [], table.slice(next ? 1 : 0, 26)));
    setPreview(null);
  }

  /** A field lives in one column: picking it again moves it here. */
  function assign(col: number, field: ImportField) {
    setMapping((prev) => prev.map((f, i) => (i === col ? field : field !== "ignore" && f === field ? "ignore" : f)));
    setPreview(null);
  }

  const dataRows = Math.max(0, table.length - (hasHeader ? 1 : 0));
  const columns = useMemo(
    () =>
      mapping.map((field, i) => {
        const from = hasHeader ? 1 : 0;
        let sample = "";
        for (let r = from; r < table.length && !sample; r++) sample = table[r][i] ?? "";
        return { index: i, field, title: (hasHeader ? table[0]?.[i] : "") || "", sample };
      }),
    [mapping, table, hasHeader],
  );
  const mappedEnough = REQUIRED_FIELDS.every((f) => mapping.includes(f));

  function payload(): SchImportCommitInput | null {
    const input = { ...compactInput(table, mapping, hasHeader), status };
    const bytes = new TextEncoder().encode(JSON.stringify(input)).length;
    return bytes > IMPORT_MAX_PAYLOAD_BYTES ? null : input;
  }

  function check() {
    const input = payload();
    if (!input) {
      setError("impErrTooLarge");
      return;
    }
    setError(null);
    startTransition(async () => {
      let result: SchImportPreview;
      try {
        result = await previewSchImportAction({ table: input.table, mapping: input.mapping, hasHeader: input.hasHeader });
      } catch {
        result = { error: "unavailable" };
      }
      if ("error" in result) {
        setError(serverErrorKey(result.error));
        return;
      }
      setPreview(result);
      setStep(3);
    });
  }

  function commit() {
    const input = payload();
    if (!input) {
      setError("impErrTooLarge");
      return;
    }
    setError(null);
    startTransition(async () => {
      let result: SchImportResult;
      try {
        result = await commitSchImportAction(input);
      } catch {
        result = { error: "unavailable" };
      }
      if ("error" in result) {
        setError(serverErrorKey(result.error));
        // A failed commit may still have written its first batches (a retry is
        // safe — the import is idempotent): show them, and make the organiser
        // check again so the counts on screen are true before the next try.
        if (result.error === "unavailable") {
          setPreview(null);
          setStep(2);
          router.refresh();
        }
        return;
      }
      toast(
        result.inserted > 0
          ? { title: fill(copy.impDone, { n: result.inserted }), tone: "success" }
          : { title: copy.impDoneNone, tone: "info" },
      );
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  const stepTitle = step === 1 ? copy.impStepFile : step === 2 ? copy.impStepMap : copy.impStepPreview;
  const newCount = preview?.totals.entries_new ?? 0;

  const footer =
    step === 1 ? (
      <button type="button" className="btn-secondary" onClick={close} disabled={busy}>{copy.cancel}</button>
    ) : step === 2 ? (
      <>
        <button type="button" className="btn-secondary" onClick={() => { setError(null); setStep(1); }} disabled={busy}>
          <ArrowLeft className="h-4 w-4" aria-hidden />{copy.impBack}
        </button>
        <button type="button" className="btn-primary" onClick={check} disabled={busy || !mappedEnough}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ListChecks className="h-4 w-4" aria-hidden />}
          {pending ? copy.impChecking : copy.impCheck}
        </button>
      </>
    ) : (
      <>
        <button type="button" className="btn-secondary" onClick={() => { setError(null); setStep(2); }} disabled={busy}>
          <ArrowLeft className="h-4 w-4" aria-hidden />{copy.impBack}
        </button>
        <button type="button" className="btn-primary" onClick={commit} disabled={busy || newCount === 0}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
          {pending ? copy.impCommitting : fill(copy.impCommit, { n: newCount })}
        </button>
      </>
    );

  return (
    <>
      <button type="button" className="btn-outline" onClick={() => setOpen(true)}>
        <FileSpreadsheet className="h-4 w-4" aria-hidden />{copy.importSheet}
      </button>

      <Dialog open={open} onClose={close} title={copy.impTitle} description={copy.impDesc} size="xl" closeOnBackdrop={false} footer={footer}>
        <div className="space-y-4">
          <div>
            <p className="text-2xs font-medium uppercase tracking-wide text-text-muted">{fill(copy.impStepOf, { n: step })}</p>
            <h4 ref={headingRef} tabIndex={-1} className="text-base font-semibold tracking-tight text-text outline-none">{stepTitle}</h4>
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-text">{copy[error]}</p>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="label" htmlFor={`${uid}-file`}>{copy.impFile}</label>
                <input
                  ref={fileRef}
                  id={`${uid}-file`}
                  className="input"
                  type="file"
                  accept=".csv,.tsv,.txt,.xlsx"
                  disabled={busy}
                  aria-describedby={`${uid}-file-hint`}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Cleared so that picking the same (fixed) file again fires `change`.
                    e.target.value = "";
                    if (file) void readFile(file);
                  }}
                />
                <p id={`${uid}-file-hint`} className="helper">{copy.impFileHint}</p>
                {/* Reserved line: the spinner never pushes the textarea down. */}
                <p className="mt-1 flex h-4 items-center gap-1.5 text-2xs text-text-muted" aria-live="polite">
                  {reading && <><Loader2 className="h-3 w-3 animate-spin" aria-hidden />{copy.impReading}</>}
                </p>
              </div>
              <div>
                <label className="label" htmlFor={`${uid}-paste`}>{copy.impPaste}</label>
                <textarea
                  id={`${uid}-paste`}
                  className="input resize-y font-mono text-xs"
                  rows={5}
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  disabled={busy}
                  spellCheck={false}
                  aria-describedby={`${uid}-paste-hint`}
                />
                <p id={`${uid}-paste-hint`} className="helper">{copy.impPasteHint}</p>
                <button type="button" className="btn-outline btn-sm mt-2" onClick={readPasted} disabled={busy || !pasted.trim()}>
                  <ListChecks className="h-3.5 w-3.5" aria-hidden />{copy.impPasteRead}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-soft">
                <Badge variant="muted"><span className="num">{fill(copy.impLoaded, { rows: dataRows, cols: mapping.length })}</span></Badge>
              </div>
              {truncated && (
                <p role="alert" className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-text">
                  {fill(copy.impTruncated, { n: IMPORT_MAX_ROWS })}
                </p>
              )}
              <label className="flex items-center gap-2 text-sm text-text">
                <input type="checkbox" className="h-4 w-4 accent-accent" checked={hasHeader} onChange={(e) => toggleHeader(e.target.checked)} disabled={busy} />
                {copy.impHasHeader}
              </label>
              <p className="text-xs leading-relaxed text-text-muted">{copy.impMapHint}</p>

              <ul className="relative max-h-[40vh] divide-y divide-border overflow-y-auto overscroll-contain rounded-xl border border-border">
                {columns.map((c) => {
                  const name = c.title || fill(copy.impColumn, { n: c.index + 1 });
                  return (
                    <li key={c.index} className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center">
                      <div className="min-w-0">
                        <label htmlFor={`${uid}-col-${c.index}`} className="block truncate text-sm font-medium text-text" title={name}>
                          <span className="num mr-1.5 text-2xs text-text-muted">{c.index + 1}</span>{name}
                        </label>
                        <p className="truncate text-xs text-text-muted" title={c.sample || undefined}>{c.sample || copy.impNoSample}</p>
                      </div>
                      <select
                        id={`${uid}-col-${c.index}`}
                        className="select w-full"
                        value={c.field}
                        disabled={busy}
                        onChange={(e) => { if (isImportField(e.target.value)) assign(c.index, e.target.value); }}
                      >
                        {IMPORT_FIELDS.map((f) => <option key={f} value={f}>{schImportFieldLabel(f, lang)}</option>)}
                      </select>
                    </li>
                  );
                })}
              </ul>
              {!mappedEnough && <p className="text-xs text-warning">{copy.impNeedFields}</p>}

              <div>
                <label className="label" htmlFor={`${uid}-status`}>{copy.impStatus}</label>
                <select
                  id={`${uid}-status`}
                  className="select w-full sm:w-64"
                  value={status}
                  disabled={busy}
                  aria-describedby={`${uid}-status-hint`}
                  onChange={(e) => setStatus(e.target.value === "paid" ? "paid" : "pending")}
                >
                  <option value="pending">{schStatusLabel("pending", lang)}</option>
                  <option value="paid">{schStatusLabel("paid", lang)}</option>
                </select>
                <p id={`${uid}-status-hint`} className="helper">{copy.impStatusHint}</p>
              </div>
            </div>
          )}

          {step === 3 && preview && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="muted"><span className="num">{fill(copy.impRows, { n: preview.totals.rows })}</span></Badge>
                <Badge variant="accent"><span className="num">{fill(copy.impEntriesNew, { n: preview.totals.entries_new })}</span></Badge>
                {(["ready", "partial", "already_registered", "duplicate_in_file", "invalid"] as const).map((s) => (
                  <Badge key={s} variant={schImportStateVariant(s)} dot>
                    {schImportStateLabel(s, lang)} <span className="num">{preview.totals[s]}</span>
                  </Badge>
                ))}
                <Badge variant={schStatusLabelVariant(status)}>{copy.impStatus}: {schStatusLabel(status, lang)}</Badge>
              </div>
              {newCount === 0 && <p className="text-sm text-text-soft">{copy.impNothingNew}</p>}

              <div className="tbl-wrap relative max-h-[36vh] overflow-y-auto overscroll-contain">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="num">{copy.impColRow}</th>
                      <th>{copy.colName}</th>
                      <th>{copy.impColEmail}</th>
                      <th>{copy.impColGames}</th>
                      <th>{copy.impColState}</th>
                      <th>{copy.impColIssues}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.row}>
                        <td className="num text-text-muted">{r.row}</td>
                        <td className="font-medium text-text">{r.name || "—"}</td>
                        <td className="min-w-[11rem] break-all text-xs">{r.email || "—"}</td>
                        <td>
                          <div className="flex max-w-[16rem] flex-wrap gap-1">
                            {r.games_new.map((g) => <Badge key={g} variant="success">{SCH_GAME_LABEL[g]}</Badge>)}
                            {r.games_existing.map((g) => (
                              <Badge
                                key={g}
                                variant="muted"
                                title={fill(copy.impGameExisting, { game: SCH_GAME_LABEL[g] })}
                              >
                                {/* aria-label is ignored on a plain span — hidden text is read instead. */}
                                <s aria-hidden>{SCH_GAME_LABEL[g]}</s>
                                <span className="sr-only">{fill(copy.impGameExisting, { game: SCH_GAME_LABEL[g] })}</span>
                              </Badge>
                            ))}
                            {r.has_receipt && (
                              <Badge variant="info" title={copy.impHasReceipt}>
                                <Link2 className="h-3 w-3" aria-hidden /><span className="sr-only">{copy.impHasReceipt}</span>
                              </Badge>
                            )}
                            {r.games_new.length + r.games_existing.length === 0 && !r.has_receipt && <span className="text-text-muted">—</span>}
                          </div>
                        </td>
                        <td><Badge variant={schImportStateVariant(r.state)} dot>{schImportStateLabel(r.state, lang)}</Badge></td>
                        <td className="text-xs text-text-soft">
                          {r.issues.length ? (
                            <ul className="max-w-[18rem] space-y-0.5">
                              {r.issues.map((issue, i) => <li key={i}>{issueText(issue, copy, lang)}</li>)}
                            </ul>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}

function schStatusLabelVariant(status: ImportStatus): "success" | "warning" {
  return status === "paid" ? "success" : "warning";
}

function issueText(issue: ImportIssue, copy: SchAdminCopy, lang: Parameters<typeof schAdminCopy>[0]): string {
  const text = schImportIssueLabel(issue.code, lang);
  return issue.game ? fill(copy.impIssueForGame, { game: SCH_GAME_LABEL[issue.game], issue: text }) : text;
}
