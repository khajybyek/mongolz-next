/**
 * Console pages that derived totals from a capped list (2026-09-23).
 *
 *  - /suspects/[id] read the newest 100 alerts and reported
 *    alerts.length as "Total alerts" and the 100th row as "First seen".
 *  - /wall picked each camera's newest face from ONE query limited to
 *    cameras × 3 rows, so a busy camera starved every other tile.
 *
 * The pages are called as plain async functions; the returned element tree
 * is inspected without rendering. Supabase is faked with a thenable builder
 * that answers from the calls made on it.
 */
import type { ReactElement, ReactNode } from "react";

const SUSPECT = "11111111-2222-4333-8444-555555555555";
const CAM_BUSY = "aaaaaaaa-0000-4000-8000-000000000001";
const CAM_QUIET = "aaaaaaaa-0000-4000-8000-000000000002";

type Call = [string, ...unknown[]];
type Answer = (calls: Call[]) => { data?: unknown; count?: number | null; error?: unknown };

const answers: Record<string, Answer> = {};
const rpcAnswers: Record<string, unknown> = {};
const fromCalls: Array<{ table: string; calls: Call[] }> = [];

function builder(table: string) {
  const calls: Call[] = [];
  fromCalls.push({ table, calls });
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "gte", "not"]) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return b;
    };
  }
  const settle = (extra: string) => {
    calls.push([extra]);
    const a = answers[table]?.(calls) ?? { data: null };
    return Promise.resolve({ data: a.data ?? null, count: a.count ?? null, error: a.error ?? null });
  };
  b.single = () => settle("single");
  b.maybeSingle = () => settle("maybeSingle");
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => settle("await").then(res, rej);
  return b;
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (t: string) => builder(t),
    rpc: async (fn: string) => ({ data: rpcAnswers[fn] ?? null, error: null }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://storage.test/p" }, error: null }) }) },
  }),
}));
jest.mock("@/lib/supabase/auth", () => ({
  requireAdmin: jest.fn(async () => ({ profile: { role: "admin" } })),
  requireUser: jest.fn(async () => ({ profile: { role: "admin" } })),
}));
jest.mock("@/lib/i18n/server", () => ({
  getT: async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { t } = require("@/lib/i18n/translations") as typeof import("@/lib/i18n/translations");
    return { t: (k: Parameters<typeof t>[0]) => t(k, "en"), lang: "en" };
  },
}));
jest.mock("@/lib/ml-client", () => ({ mlActiveCameras: jest.fn(async () => []) }));
jest.mock("lucide-react", () => new Proxy({}, { get: () => () => null }));
jest.mock("next/link", () => () => null);
jest.mock("@/components/ui/page-header", () => ({ PageHeader: () => null }));
jest.mock("@/components/ui/empty", () => ({ Empty: () => null }));
jest.mock("@/components/face-thumb", () => ({ FaceThumb: () => null }));
jest.mock("@/app/wall/wall-view", () => ({ WallView: () => null }));

import SuspectDetailPage from "@/app/(app)/suspects/[id]/page";
import WallPage from "@/app/wall/page";

/** Every element in the tree (elements only — components are not run). */
function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const n of node) elements(n, out);
  } else if (node && typeof node === "object" && "props" in node) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    out.push(el);
    elements(el.props.children, out);
  }
  return out;
}
function statValue(tree: ReactNode, label: string): unknown {
  const el = elements(tree).find(
    (e) => typeof e.type === "function" && (e.props as { label?: string }).label === label,
  );
  if (!el) throw new Error(`no stat labelled ${label}`);
  return el.props as { value: unknown; note?: string | null };
}
const has = (calls: Call[], name: string, ...args: unknown[]) =>
  calls.some((c) => c[0] === name && args.every((a, i) => c[i + 1] === a));

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
  for (const k of Object.keys(rpcAnswers)) delete rpcAnswers[k];
  fromCalls.length = 0;
});

describe("suspect detail stats", () => {
  function seed({ total, countError = false }: { total: number; countError?: boolean }) {
    const newest = Array.from({ length: Math.min(total, 100) }, (_, i) => ({
      id: `al-${i}`,
      camera_id: CAM_BUSY,
      camera_name: "Gate",
      face_id: null,
      created_at: `2026-09-${String(22 - Math.floor(i / 10)).padStart(2, "0")}T00:00:00Z`,
      label: null,
      similarity: 0.6,
      match_count: 1,
    }));
    answers.suspects = () => ({
      data: { id: SUSPECT, name: "fixture", image_path: "s.jpg", notes: null, privacy_tier: "standard", created_at: "2026-01-01T00:00:00Z" },
    });
    answers.alerts = (calls) => {
      const sel = calls.find((c) => c[0] === "select");
      if ((sel?.[2] as { head?: boolean } | undefined)?.head) {
        return countError ? { error: { message: "denied" } } : { count: total };
      }
      if (has(calls, "order", "created_at") && (calls.find((c) => c[0] === "order")?.[2] as { ascending: boolean }).ascending) {
        return { data: { created_at: "2026-02-03T00:00:00Z" } };
      }
      return { data: newest };
    };
  }

  it("reports the real total and the real first sighting, not the 100-row window", async () => {
    seed({ total: 250 });
    const tree = await SuspectDetailPage({ params: Promise.resolve({ id: SUSPECT }) });
    expect((statValue(tree, "Total alerts") as { value: unknown }).value).toBe(250);
    expect(String((statValue(tree, "First seen") as { value: unknown }).value)).toContain("2026.02.03");
    // Stats still computed from the window say so.
    expect((statValue(tree, "Cameras") as { note?: string }).note).toBe("From the latest 100 alerts");
    const count = fromCalls.find((q) => q.table === "alerts" && q.calls.some((c) => c[0] === "select" && (c[2] as { head?: boolean })?.head));
    expect(count && has(count.calls, "eq", "suspect_id", SUSPECT)).toBe(true);
  });

  it("shows no sampling note when the window holds every alert", async () => {
    seed({ total: 7 });
    const tree = await SuspectDetailPage({ params: Promise.resolve({ id: SUSPECT }) });
    expect((statValue(tree, "Total alerts") as { value: unknown }).value).toBe(7);
    expect((statValue(tree, "Cameras") as { note?: string | null }).note).toBeNull();
  });

  it("shows — rather than 0 when the count cannot be read", async () => {
    seed({ total: 3, countError: true });
    const tree = await SuspectDetailPage({ params: Promise.resolve({ id: SUSPECT }) });
    expect((statValue(tree, "Total alerts") as { value: unknown }).value).toBe("—");
  });
});

describe("wall latest face per camera", () => {
  it("looks up each camera's newest face on its own, so a busy camera cannot starve the others", async () => {
    rpcAnswers.camera_health = [
      { camera_id: CAM_BUSY, name: "Busy", enabled: true, status: "healthy", last_seen: null, faces_24h: 50, faces_1h: 9 },
      { camera_id: CAM_QUIET, name: "Quiet", enabled: true, status: "healthy", last_seen: null, faces_24h: 1, faces_1h: 0 },
    ];
    answers.faces = (calls) => {
      // Model the old failure: a shared query over both cameras would only
      // ever see the busy camera's rows.
      if (calls.some((c) => c[0] === "in")) return { data: Array.from({ length: 6 }, (_, i) => ({ id: `busy-${i}`, camera_id: CAM_BUSY })) };
      const cam = calls.find((c) => c[0] === "eq" && c[1] === "camera_id")?.[2];
      return { data: cam === CAM_BUSY ? { id: "busy-newest" } : { id: "quiet-newest" } };
    };
    const el = (await WallPage()) as ReactElement<{ cameras: Array<{ camera_id: string; latest_face_id: string | null }> }>;
    const byCam = Object.fromEntries(el.props.cameras.map((c) => [c.camera_id, c.latest_face_id]));
    expect(byCam).toEqual({ [CAM_BUSY]: "busy-newest", [CAM_QUIET]: "quiet-newest" });
    for (const q of fromCalls.filter((f) => f.table === "faces")) {
      expect(has(q.calls, "limit", 1)).toBe(true);
    }
  });
});
