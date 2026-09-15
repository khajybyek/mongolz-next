import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, Database, RadioTower, ServerCog, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { PageHeader } from "@/components/ui/page-header";
import { getT } from "@/lib/i18n/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const copy = {
  mn: {
    title: "Edge төхөөрөмжүүд", subtitle: "Камерын дэргэдэх agent, шифрлэсэн offline queue болон cloud delivery-ийн төлөв.",
    empty: "Одоогоор Edge төхөөрөмж heartbeat илгээгээгүй байна.", online: "Хэвийн", paused: "Capture зогссон", stale: "Удааширсан", offline: "Холболтгүй", degraded: "Алдаатай",
    camera: "Камер", lastSeen: "Сүүлд холбогдсон", queue: "Хүлээгдэж буй", oldest: "Хамгийн хуучин", delivered: "Хүргэсэн", failures: "Амжилтгүй оролдлого", faces24h: "24 цагийн нүүр", version: "Хувилбар", openCamera: "Камер нээх", unavailable: "Edge төхөөрөмжийн төлөвийг уншиж чадсангүй.",
  },
  en: {
    title: "Edge devices", subtitle: "On-site agents, encrypted offline queues, and cloud delivery health.",
    empty: "No edge device has sent a heartbeat yet.", online: "Online", paused: "Capture paused", stale: "Stale", offline: "Offline", degraded: "Degraded",
    camera: "Camera", lastSeen: "Last seen", queue: "Queued", oldest: "Oldest queued", delivered: "Delivered", failures: "Failed attempts", faces24h: "Faces in 24h", version: "Version", openCamera: "Open camera", unavailable: "Edge device status is unavailable.",
  },
  kr: {
    title: "엣지 장치", subtitle: "현장 에이전트, 암호화된 오프라인 대기열 및 클라우드 전송 상태입니다.",
    empty: "아직 하트비트를 보낸 엣지 장치가 없습니다.", online: "정상", paused: "캡처 중지", stale: "지연", offline: "오프라인", degraded: "오류", camera: "카메라", lastSeen: "마지막 연결", queue: "대기 중", oldest: "가장 오래된 항목", delivered: "전송 완료", failures: "실패 시도", faces24h: "24시간 얼굴", version: "버전", openCamera: "카메라 열기", unavailable: "엣지 장치 상태를 불러올 수 없습니다.",
  },
} as const;

type DeviceStatus = "online" | "paused" | "stale" | "offline" | "degraded";

function statusOf(lastSeen: string, state: string, captureEnabled: boolean): DeviceStatus {
  const age = Date.now() - Date.parse(lastSeen);
  if (!Number.isFinite(age) || age >= 10 * 60_000) return "offline";
  if (age >= 90_000) return "stale";
  if (!captureEnabled) return "paused";
  return state === "degraded" ? "degraded" : "online";
}

function statusVariant(status: DeviceStatus): "success" | "warning" | "danger" | "muted" {
  if (status === "online") return "success";
  if (status === "paused") return "muted";
  return status === "stale" ? "warning" : "danger";
}

export default async function EdgeAgentsPage() {
  await requireAdmin();
  const { lang } = await getT();
  const t = copy[lang];
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [agentRes, eventRes] = await Promise.all([
    supabase.from("edge_agents").select("id,name,camera_id,capture_enabled,version,state,queue_depth,oldest_queued_at,sent_total,failed_total,last_error,last_seen_at,cameras(name)").order("last_seen_at", { ascending: false }),
    supabase.from("edge_ingest_events").select("agent_id,face_count,received_at").gte("received_at", since).order("received_at", { ascending: false }).limit(1000),
  ]);
  if (agentRes.error || eventRes.error) return <><PageHeader title={t.title} subtitle={t.subtitle} icon={<ServerCog className="h-5 w-5" />} /><Empty icon={AlertTriangle} message={t.unavailable} /></>;

  const stats = new Map<string, { faces: number; last: string | null }>();
  for (const event of eventRes.data ?? []) {
    const current = stats.get(event.agent_id) ?? { faces: 0, last: null };
    current.faces += event.face_count;
    current.last ??= event.received_at;
    stats.set(event.agent_id, current);
  }
  const agents = (agentRes.data ?? []).map((agent) => ({ ...agent, status: statusOf(agent.last_seen_at, agent.state, agent.capture_enabled), recent: stats.get(agent.id) }));
  const totals = {
    online: agents.filter((agent) => agent.status === "online").length,
    degraded: agents.filter((agent) => agent.status === "degraded" || agent.status === "stale" || agent.status === "paused").length,
    offline: agents.filter((agent) => agent.status === "offline").length,
    queued: agents.reduce((sum, agent) => sum + agent.queue_depth, 0),
  };

  return (
    <>
      <PageHeader title={t.title} subtitle={t.subtitle} icon={<ServerCog className="h-5 w-5" />} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary icon={CheckCircle2} label={t.online} value={totals.online} tone="text-success" />
        <Summary icon={AlertTriangle} label={t.degraded} value={totals.degraded} tone="text-warning" />
        <Summary icon={WifiOff} label={t.offline} value={totals.offline} tone="text-danger" />
        <Summary icon={Database} label={t.queue} value={totals.queued} tone="text-accent" />
      </div>
      {!agents.length ? <Empty icon={ServerCog} message={t.empty} /> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {agents.map((agent) => {
            const camera = Array.isArray(agent.cameras) ? agent.cameras[0] : agent.cameras;
            return (
              <article key={agent.id} className="card space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><h2 className="truncate font-semibold text-text">{agent.name}</h2><p className="mt-1 text-xs text-text-muted">{t.camera}: {camera?.name ?? agent.camera_id}</p></div>
                  <Badge variant={statusVariant(agent.status)} dot>{t[agent.status]}</Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
                  <Metric label={t.queue} value={agent.queue_depth.toLocaleString()} />
                  <Metric label={t.delivered} value={agent.sent_total.toLocaleString()} />
                  <Metric label={t.failures} value={agent.failed_total.toLocaleString()} />
                  <Metric label={t.faces24h} value={(agent.recent?.faces ?? 0).toLocaleString()} />
                  <Metric label={t.version} value={agent.version} />
                  <Metric label={t.lastSeen} value={formatDate(agent.last_seen_at)} />
                </dl>
                {agent.oldest_queued_at && <p className="flex items-center gap-1.5 text-xs text-warning"><Clock3 className="h-3.5 w-3.5" />{t.oldest}: {formatDate(agent.oldest_queued_at)}</p>}
                {agent.last_error && <p className="break-words rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{agent.last_error}</p>}
                <Link href={`/cameras/${agent.camera_id}/schedule` as never} className="btn-secondary btn-sm"><RadioTower className="h-3.5 w-3.5" />{t.openCamera}</Link>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function Summary({ icon: Icon, label, value, tone }: { icon: typeof CheckCircle2; label: string; value: number; tone: string }) {
  return <div className="card flex items-center gap-3 p-3 sm:p-4"><Icon className={`h-5 w-5 shrink-0 ${tone}`} /><div><p className="text-xl font-semibold text-text">{value}</p><p className="text-2xs text-text-muted">{label}</p></div></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-text-muted">{label}</dt><dd className="mt-0.5 truncate font-medium text-text" title={value}>{value}</dd></div>;
}
