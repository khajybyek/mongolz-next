import Link from "next/link";
import { Bell, BriefcaseBusiness, Clock, Search, UserRound } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate, cn } from "@/lib/utils";
import { incidentCopy, incidentPriorityLabel, incidentStatusLabel } from "@/lib/incident-copy";
import {
  INCIDENT_STATUSES,
  incidentPriorityVariant,
  incidentStatusVariant,
  isIncidentPriority,
  isIncidentStatus,
} from "@/lib/incidents";
import { UUID_RE } from "@/lib/workflow-query";
import { CreateIncidentForm, type AdminOption, type AlertOption } from "./incident-forms";
import type { Incident, IncidentStatus } from "@/lib/database.types";

type IncidentListRow = Incident & {
  assignee: { id: string; email: string; full_name: string | null } | null;
  incident_alerts: { count: number }[];
  incident_faces: { count: number }[];
};

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; alert?: string }>;
}) {
  await requireAdmin();
  const { lang } = await getT();
  const copy = incidentCopy(lang);
  const params = (await searchParams) ?? {};
  const status: IncidentStatus | "all" = isIncidentStatus(params.status) ? params.status : "all";
  const initialAlertId = typeof params.alert === "string" && UUID_RE.test(params.alert) ? params.alert : "";
  const supabase = await createClient();

  let incidentQuery = supabase
    .from("incidents")
    .select("*, assignee:profiles!incidents_assignee_id_fkey(id,email,full_name), incident_alerts(count), incident_faces(count)")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (status !== "all") incidentQuery = incidentQuery.eq("status", status);

  const [incidentRes, adminRes, alertRes] = await Promise.all([
    incidentQuery,
    supabase.from("profiles").select("id,email,full_name").eq("role", "admin").order("email"),
    supabase.from("alerts").select("id,suspect_name,camera_name,created_at").order("created_at", { ascending: false }).limit(100),
  ]);

  const admins = (adminRes.data ?? []) as AdminOption[];
  const alertRows = [...(alertRes.data ?? [])];
  if (initialAlertId && !alertRows.some((alert) => alert.id === initialAlertId)) {
    const { data: initialAlert } = await supabase
      .from("alerts")
      .select("id,suspect_name,camera_name,created_at")
      .eq("id", initialAlertId)
      .maybeSingle();
    if (initialAlert) alertRows.unshift(initialAlert);
  }
  const alerts: AlertOption[] = alertRows.map((alert) => ({
    id: alert.id,
    label: `${alert.suspect_name} · ${alert.camera_name ?? "—"} · ${formatDate(alert.created_at)}`,
  }));
  const incidents = ((incidentRes.data ?? []) as unknown as IncidentListRow[]).filter(
    (row) => isIncidentStatus(row.status) && isIncidentPriority(row.priority),
  );

  return (
    <>
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        icon={<BriefcaseBusiness className="h-5 w-5" />}
      />

      <div className="mb-5"><CreateIncidentForm admins={admins} alerts={alerts} initialAlertId={initialAlertId} /></div>

      <nav className="tabs mb-5 overflow-x-auto" aria-label={copy.status}>
        {["all", ...INCIDENT_STATUSES].map((value) => {
          const active = status === value;
          const href = value === "all" ? "/incidents" : `/incidents?status=${value}`;
          const label = value === "all" ? copy.all : incidentStatusLabel(value as IncidentStatus, lang);
          return <Link key={value} href={href as never} className={cn("tab whitespace-nowrap", active && "tab-active")} aria-current={active ? "page" : undefined}>{label}</Link>;
        })}
      </nav>

      {incidentRes.error ? (
        <Empty icon={BriefcaseBusiness} message={copy.unavailable} />
      ) : incidents.length === 0 ? (
        <Empty icon={BriefcaseBusiness} message={copy.empty} description={copy.emptyDesc} />
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {incidents.map((incident) => (
            <Link key={incident.id} href={`/incidents/${incident.id}` as never} className="card group p-4 transition-colors hover:border-accent/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-text transition-colors group-hover:text-accent">{incident.title}</h2>
                  {incident.description && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-text-muted">{incident.description}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  <Badge variant={incidentPriorityVariant(incident.priority)}>{incidentPriorityLabel(incident.priority, lang)}</Badge>
                  <Badge variant={incidentStatusVariant(incident.status)} dot>{incidentStatusLabel(incident.status, lang)}</Badge>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-soft">
                <span className="inline-flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />{incident.assignee?.full_name || incident.assignee?.email || copy.unassigned}</span>
                <span className="inline-flex items-center gap-1.5"><Bell className="h-3.5 w-3.5" />{incident.incident_alerts?.[0]?.count ?? 0}</span>
                <span className="inline-flex items-center gap-1.5"><Search className="h-3.5 w-3.5" />{incident.incident_faces?.[0]?.count ?? 0}</span>
                <span className="ml-auto inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{formatDate(incident.updated_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
