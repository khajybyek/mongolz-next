"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, X, Filter } from "lucide-react";

interface Labels {
  q: string;
  user: string;
  allActions: string;
  rows: string;
  from: string;
  to: string;
  filter: string;
  clear: string;
}

interface Props {
  actions: string[];
  currentAction: string;
  currentQ: string;
  currentUser: string;
  currentFrom: string;
  currentTo: string;
  currentLimit: string;
  labels: Labels;
}

export function AuditFilters({
  actions,
  currentAction,
  currentQ,
  currentUser,
  currentFrom,
  currentTo,
  currentLimit,
  labels,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(currentQ);
  const [user, setUser] = useState(currentUser);
  const [action, setAction] = useState(currentAction);
  const [from, setFrom] = useState(currentFrom);
  const [to, setTo] = useState(currentTo);
  const [limit, setLimit] = useState(currentLimit);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (q) params.set("q", q);
    if (user) params.set("user", user);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (limit && limit !== "500") params.set("limit", limit);
    const qs = params.toString();
    startTransition(() => router.push(`/audit${qs ? "?" + qs : ""}` as never));
  }

  function clearAll() {
    setQ(""); setUser(""); setAction(""); setFrom(""); setTo(""); setLimit("500");
    startTransition(() => router.push("/audit"));
  }

  const hasFilters = currentAction || currentQ || currentUser || currentFrom || currentTo || (sp.get("limit") && sp.get("limit") !== "500");

  return (
    <form onSubmit={applyFilters} className="card mb-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-3 text-text-muted" />
          <input
            type="text"
            placeholder={labels.q}
            aria-label={labels.q}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="input pl-8 text-sm"
          />
        </div>
        <input
          type="text"
          placeholder={labels.user}
          aria-label={labels.user}
          value={user}
          onChange={(e) => setUser(e.target.value)}
          className="input text-sm"
        />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label={labels.allActions}
          className="input text-sm"
        >
          <option value="">{labels.allActions}</option>
          {actions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          aria-label={labels.rows}
          className="input text-sm"
        >
          <option value="100">100 {labels.rows}</option>
          <option value="500">500 {labels.rows}</option>
          <option value="1000">1000 {labels.rows}</option>
          <option value="2000">2000 {labels.rows}</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 items-end">
        <div>
          <label htmlFor="audit-filter-from" className="text-[10px] uppercase tracking-wide text-text-muted block mb-1">{labels.from}</label>
          <input
            id="audit-filter-from"
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input text-sm"
          />
        </div>
        <div>
          <label htmlFor="audit-filter-to" className="text-[10px] uppercase tracking-wide text-text-muted block mb-1">{labels.to}</label>
          <input
            id="audit-filter-to"
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="btn-primary text-sm flex items-center gap-2"
        >
          <Filter className="w-3.5 h-3.5" />
          {labels.filter}
        </button>
        {hasFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="btn-ghost text-sm flex items-center gap-2"
          >
            <X className="w-3.5 h-3.5" />
            {labels.clear}
          </button>
        )}
      </div>
    </form>
  );
}
