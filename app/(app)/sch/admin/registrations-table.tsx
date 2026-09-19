"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  CircleSlash,
  Clock,
  ExternalLink,
  Hourglass,
  ImageOff,
  Loader2,
  MessageSquareText,
  Receipt,
  RotateCcw,
  Search,
  Trash2,
  Trophy,
  UserCheck,
  UserX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import { cn, formatDate } from "@/lib/utils";
import { SCH_GAMES, SCH_GAME_LABEL, SCH_LIMITS, SCH_STATUSES, type SchGame, type SchStatus } from "@/lib/sch/schema";
import { facebookHref, isSteamUrl, maskSteam } from "@/lib/sch/format";
import { fill, schAdminCopy, schStatusLabel, schStatusVariant } from "./admin-copy";
import {
  deleteRegistrationAction,
  setCheckInAction,
  setRegistrationNoteAction,
  setRegistrationStatusAction,
  type SchActionResult,
} from "./actions";

/** Serialisable row the server page hands to the table — no storage paths. */
export interface SchAdminRow {
  id: string;
  submission_id: string;
  reference: string;
  game: SchGame;
  full_name: string;
  email: string;
  facebook: string;
  phone: string | null;
  in_game_id: string | null;
  rank_label: string | null;
  rank_score: number;
  roles: string[];
  premier_rank: string | null;
  faceit: "yes" | "no" | null;
  status: SchStatus;
  paid_at: string | null;
  checked_in_at: string | null;
  notes: string | null;
  team_name: string | null;
  /** true only for a receipt image stored in the private bucket */
  has_receipt: boolean;
  /** Drive link from the Google Form (imported rows); https:// or null */
  receipt_url: string | null;
  source: "web" | "import";
  created_at: string;
}

type GameTab = SchGame | "all";
type StatusFilter = SchStatus | "all";
type Sort = "newest" | "oldest";

type DialogState =
  | { kind: "receipt"; row: SchAdminRow }
  | { kind: "note"; row: SchAdminRow; draft: string }
  | { kind: "delete"; row: SchAdminRow }
  | null;

function rankVariant(score: number): "accent" | "success" | "warning" | "info" | "muted" {
  if (score >= 80) return "accent";
  if (score >= 60) return "success";
  if (score >= 40) return "info";
  if (score > 0) return "warning";
  return "muted";
}

export function RegistrationsTable({ rows }: { rows: SchAdminRow[] }) {
  const { lang } = useT();
  const copy = schAdminCopy(lang);
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [game, setGame] = useState<GameTab>("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [receiptFailed, setReceiptFailed] = useState(false);

  const counts = useMemo(() => {
    const byGame: Record<GameTab, number> = { all: rows.length, mobile_legends: 0, cs2: 0, dota2: 0 };
    for (const r of rows) byGame[r.game] += 1;
    return byGame;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (game !== "all" && r.game !== game) return false;
      if (status !== "all" && r.status !== status) return false;
      if (!q) return true;
      return [r.full_name, r.email, r.in_game_id ?? "", r.reference, r.facebook, r.phone ?? "", r.team_name ?? ""]
        .some((v) => v.toLowerCase().includes(q));
    });
    list.sort((a, b) => {
      const d = Date.parse(a.created_at) - Date.parse(b.created_at);
      return sort === "newest" ? -d : d;
    });
    return list;
  }, [rows, game, status, query, sort]);

  function errorTitle(result: Exclude<SchActionResult, { ok: true }>): string {
    return result.error === "conflict" ? copy.conflict : result.error === "invalid" ? copy.invalid : copy.unavailable;
  }

  function run(row: SchAdminRow, work: () => Promise<SchActionResult>, okTitle: string, onOk?: () => void) {
    setBusyId(row.id);
    startTransition(async () => {
      let result: SchActionResult;
      try {
        result = await work();
      } catch {
        result = { error: "unavailable" };
      }
      setBusyId(null);
      if ("error" in result) {
        toast({ title: errorTitle(result), tone: "danger" });
        if (result.error === "conflict") router.refresh();
        return;
      }
      onOk?.();
      toast({ title: okTitle, tone: "success", duration: 2000 });
      router.refresh();
    });
  }

  const setStatusFor = (row: SchAdminRow, next: SchStatus, onOk?: () => void) =>
    run(row, () => setRegistrationStatusAction({ id: row.id, status: next }), copy.statusSaved, onOk);

  const closeDialog = () => {
    if (pending) return;
    setDialog(null);
    setReceiptFailed(false);
  };

  const tabs = [
    { value: "all", label: copy.all, badge: <span className="num text-2xs text-text-muted">{counts.all}</span> },
    ...SCH_GAMES.map((g) => ({
      value: g,
      label: SCH_GAME_LABEL[g],
      badge: <span className="num text-2xs text-text-muted">{counts[g]}</span>,
    })),
  ];

  return (
    <section className="space-y-4" aria-label={copy.statTotal}>
      <Tabs tabs={tabs} value={game} onChange={(v) => setGame(v as GameTab)} className="overflow-x-auto" />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{copy.search}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            className="input pl-9"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.searchHint}
            autoComplete="off"
          />
        </label>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label={copy.statusFilter}>
            <option value="all">{copy.allStatuses}</option>
            {SCH_STATUSES.map((s) => <option key={s} value={s}>{schStatusLabel(s, lang)}</option>)}
          </select>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={copy.sort}>
            <option value="newest">{copy.sortNewest}</option>
            <option value="oldest">{copy.sortOldest}</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty icon={Trophy} message={copy.empty} description={copy.emptyDesc} size="compact" />
      ) : visible.length === 0 ? (
        <Empty icon={Search} message={copy.noMatch} size="compact" />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>{copy.colName}</th>
                <th>{copy.colContact}</th>
                <th>{copy.colRank}</th>
                <th>{copy.colRoles}</th>
                <th>{copy.colId}</th>
                <th>{copy.colStatus}</th>
                <th>{copy.colTeam}</th>
                <th>{copy.colCreated}</th>
                <th className="text-right">{copy.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const busy = pending && busyId === row.id;
                const fb = facebookHref(row.facebook);
                const steam = isSteamUrl(row.in_game_id);
                return (
                  <tr key={row.id} className={cn(busy && "opacity-60")}>
                    <td>
                      <div className="font-medium text-text">{row.full_name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-text-muted">
                        {game === "all" && <Badge variant="muted">{SCH_GAME_LABEL[row.game]}</Badge>}
                        <span className="font-mono">{copy.reference} {row.reference}</span>
                        {row.source === "import" && <Badge variant="muted" title={copy.formBadgeHint}>{copy.formBadge}</Badge>}
                      </div>
                      {row.notes && (
                        <p className="mt-1 max-w-[16rem] truncate text-2xs text-text-soft" title={row.notes}>
                          <MessageSquareText className="mr-1 inline h-3 w-3" aria-hidden />{row.notes}
                        </p>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-col gap-0.5 text-xs">
                        <a className="link break-all" href={`mailto:${row.email}`}>{row.email}</a>
                        {row.phone && <span className="text-text-soft">{row.phone}</span>}
                        {fb ? (
                          <a className="link inline-flex items-center gap-1 break-all" href={fb} target="_blank" rel="noopener noreferrer">
                            {row.facebook}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                          </a>
                        ) : (
                          <span className="break-all text-text-soft">{row.facebook}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <Badge variant={rankVariant(row.rank_score)}>
                        {row.rank_label ?? (row.game === "cs2" ? copy.premierUnknown : "—")}
                      </Badge>
                      <div className="num mt-1 text-2xs text-text-muted">{row.rank_score}/100</div>
                    </td>
                    <td>
                      {row.game === "cs2" ? (
                        <Badge variant={row.faceit === "yes" ? "info" : "muted"}>{row.faceit === "yes" ? copy.faceitYes : copy.faceitNo}</Badge>
                      ) : row.roles.length ? (
                        <div className="flex max-w-[14rem] flex-wrap gap-1">
                          {row.roles.map((role) => <Badge key={role} variant="muted">{role}</Badge>)}
                        </div>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {row.in_game_id ? (
                        steam ? (
                          <a className="link inline-flex items-center gap-1 break-all font-mono text-xs" href={row.in_game_id} target="_blank" rel="noopener noreferrer">
                            {maskSteam(row.in_game_id)}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                          </a>
                        ) : (
                          <span className="break-all font-mono text-xs">{row.in_game_id}</span>
                        )
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={schStatusVariant(row.status)} dot>{schStatusLabel(row.status, lang)}</Badge>
                        {row.paid_at && <span className="text-2xs text-text-muted">{copy.paidAt} {formatDate(row.paid_at)}</span>}
                        {row.checked_in_at && (
                          <Badge variant="accent"><UserCheck className="h-3 w-3" aria-hidden />{copy.checkedIn}</Badge>
                        )}
                      </div>
                    </td>
                    <td>{row.team_name ? <Badge variant="info">{row.team_name}</Badge> : <span className="text-text-muted">{copy.noTeam}</span>}</td>
                    <td className="whitespace-nowrap text-xs text-text-soft">
                      <Clock className="mr-1 inline h-3 w-3" aria-hidden />{formatDate(row.created_at)}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {row.has_receipt ? (
                          <button
                            type="button"
                            className="btn-outline btn-sm"
                            title={copy.viewReceipt}
                            onClick={() => { setReceiptFailed(false); setDialog({ kind: "receipt", row }); }}
                            disabled={busy}
                          >
                            <Receipt className="h-3.5 w-3.5" aria-hidden />{copy.receipt}
                          </button>
                        ) : row.receipt_url?.startsWith("https://") ? (
                          <a
                            className="btn-outline btn-sm"
                            href={row.receipt_url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            title={copy.driveReceiptHint}
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />{copy.driveReceipt}
                          </a>
                        ) : (
                          <Badge variant="danger"><ImageOff className="h-3 w-3" aria-hidden />{copy.noReceipt}</Badge>
                        )}
                        {row.status !== "paid" && (
                          <button type="button" className="btn-primary btn-sm" onClick={() => setStatusFor(row, "paid")} disabled={busy} title={copy.markPaid}>
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <BadgeCheck className="h-3.5 w-3.5" aria-hidden />}{copy.markPaid}
                          </button>
                        )}
                        {row.status !== "waitlist" && (
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setStatusFor(row, "waitlist")} disabled={busy} title={copy.toWaitlist}>
                            <Hourglass className="h-3.5 w-3.5" aria-hidden />{copy.toWaitlist}
                          </button>
                        )}
                        {row.status !== "rejected" && (
                          <button type="button" className="btn-ghost btn-sm text-danger" onClick={() => setStatusFor(row, "rejected")} disabled={busy} title={copy.reject}>
                            <CircleSlash className="h-3.5 w-3.5" aria-hidden />{copy.reject}
                          </button>
                        )}
                        {row.status !== "pending" && (
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setStatusFor(row, "pending")} disabled={busy} title={copy.reopen}>
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden />{copy.reopen}
                          </button>
                        )}
                        <button
                          type="button"
                          className={cn("btn-sm", row.checked_in_at ? "btn-secondary" : "btn-outline")}
                          onClick={() => run(row, () => setCheckInAction({ id: row.id, checkedIn: !row.checked_in_at }), copy.checkInSaved)}
                          disabled={busy}
                          title={row.checked_in_at ? copy.undoCheckIn : copy.checkIn}
                        >
                          {row.checked_in_at ? <UserX className="h-3.5 w-3.5" aria-hidden /> : <UserCheck className="h-3.5 w-3.5" aria-hidden />}
                          {row.checked_in_at ? copy.undoCheckIn : copy.checkIn}
                        </button>
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setDialog({ kind: "note", row, draft: row.notes ?? "" })} disabled={busy} title={copy.editNote}>
                          <MessageSquareText className="h-3.5 w-3.5" aria-hidden />{copy.editNote}
                        </button>
                        <button type="button" className="btn-ghost btn-sm text-danger" onClick={() => setDialog({ kind: "delete", row })} disabled={busy} title={copy.delete} aria-label={`${copy.delete}: ${row.full_name}`}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <p className="text-xs text-text-muted">{fill(copy.showing, { n: visible.length, total: rows.length })}</p>
      )}

      {/* Receipt lightbox — the image is only requested once the dialog opens, so
          scrolling the list never touches the audited viewer route. */}
      <Dialog
        open={dialog?.kind === "receipt"}
        onClose={closeDialog}
        title={copy.receiptTitle}
        description={dialog?.kind === "receipt" ? fill(copy.receiptFor, { name: dialog.row.full_name, game: SCH_GAME_LABEL[dialog.row.game] }) : undefined}
        size="lg"
        footer={dialog?.kind === "receipt" ? (
          <>
            <a className="btn-ghost btn-sm" href={`/api/sch/receipt/${dialog.row.id}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />{copy.receiptOpen}
            </a>
            <button type="button" className="btn-secondary" onClick={closeDialog} disabled={pending}>{copy.cancel}</button>
            {dialog.row.status !== "paid" && (
              <button
                type="button"
                className="btn-primary"
                disabled={pending}
                onClick={() => setStatusFor(dialog.row, "paid", () => setDialog(null))}
              >
                {pending && busyId === dialog.row.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BadgeCheck className="h-4 w-4" aria-hidden />}
                {copy.markPaid}
              </button>
            )}
          </>
        ) : undefined}
      >
        {dialog?.kind === "receipt" && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-text-muted">{copy.receiptDesc}</p>
            <div className="flex min-h-[12rem] items-center justify-center overflow-hidden rounded-xl border border-border bg-bg-secondary">
              {receiptFailed ? (
                <p role="alert" className="p-6 text-sm text-danger">{copy.receiptFailed}</p>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- audited, no-store gateway route; next/image would cache it
                <img
                  key={dialog.row.id}
                  src={`/api/sch/receipt/${dialog.row.id}`}
                  alt={copy.receiptTitle}
                  className="max-h-[70vh] w-auto max-w-full object-contain"
                  onError={() => setReceiptFailed(true)}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-soft">
              <Badge variant={schStatusVariant(dialog.row.status)} dot>{schStatusLabel(dialog.row.status, lang)}</Badge>
              <span className="font-mono">{copy.reference} {dialog.row.reference}</span>
            </div>
          </div>
        )}
      </Dialog>

      {/* Organiser note */}
      <Dialog
        open={dialog?.kind === "note"}
        onClose={closeDialog}
        title={copy.noteTitle}
        description={dialog?.kind === "note" ? dialog.row.full_name : undefined}
        footer={dialog?.kind === "note" ? (
          <>
            <button type="button" className="btn-secondary" onClick={closeDialog} disabled={pending}>{copy.cancel}</button>
            <button
              type="button"
              className="btn-primary"
              disabled={pending}
              onClick={() => run(dialog.row, () => setRegistrationNoteAction({ id: dialog.row.id, note: dialog.draft }), copy.noteSaved, () => setDialog(null))}
            >
              {pending && busyId === dialog.row.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {pending && busyId === dialog.row.id ? copy.saving : copy.save}
            </button>
          </>
        ) : undefined}
      >
        {dialog?.kind === "note" && (
          <div>
            <label className="label" htmlFor="sch-note">{copy.note}</label>
            <textarea
              id="sch-note"
              className="input resize-y"
              rows={4}
              maxLength={SCH_LIMITS.notes.max}
              value={dialog.draft}
              onChange={(e) => setDialog({ ...dialog, draft: e.target.value })}
              autoFocus
            />
            <p className="helper">{copy.noteHint}</p>
          </div>
        )}
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={dialog?.kind === "delete"}
        onClose={closeDialog}
        title={copy.deleteTitle}
        size="sm"
        footer={dialog?.kind === "delete" ? (
          <>
            <button type="button" className="btn-secondary" onClick={closeDialog} disabled={pending}>{copy.cancel}</button>
            <button
              type="button"
              className="btn-danger"
              disabled={pending}
              onClick={() => run(dialog.row, () => deleteRegistrationAction({ id: dialog.row.id }), copy.deleted, () => setDialog(null))}
            >
              {pending && busyId === dialog.row.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
              {copy.delete}
            </button>
          </>
        ) : undefined}
      >
        {dialog?.kind === "delete" && (
          <p className="text-sm leading-relaxed text-text-soft">
            {fill(copy.deleteConfirm, { name: dialog.row.full_name, game: SCH_GAME_LABEL[dialog.row.game] })}
          </p>
        )}
      </Dialog>
    </section>
  );
}
