"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Cctv, Flame } from "lucide-react";
import { Empty } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/lib/i18n/client";

type Camera = { id: string; name: string };
type HeatmapPayload = {
  cameraId: string;
  hours: number;
  samples: number;
  grid: { w: number; h: number; cells: number[]; max: number };
  points: Array<{ x: number; y: number; w: number; h: number }>;
};

export function HeatmapView({ cameras }: { cameras: Camera[] }) {
  const { t } = useT();
  const [cameraId, setCameraId] = useState<string>(cameras[0]?.id ?? "");
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<HeatmapPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!cameraId) return;
    setLoading(true);
    setErr(null);
    const ctrl = new AbortController();
    const url = new URL("/api/heatmap", window.location.origin);
    url.searchParams.set("camera_id", cameraId);
    url.searchParams.set("hours", String(hours));
    fetch(url.toString(), { signal: ctrl.signal })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j?.error || "heatmap fetch failed");
        setData(j as HeatmapPayload);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setErr(e.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [cameraId, hours]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawHeatmap(ctx, canvas.width, canvas.height, data);
  }, [data]);

  const topCells = useMemo(() => {
    if (!data) return [] as Array<{ ix: number; iy: number; count: number }>;
    const out: Array<{ ix: number; iy: number; count: number }> = [];
    const { w, h, cells } = data.grid;
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        const c = cells[iy * w + ix];
        if (c > 0) out.push({ ix, iy, count: c });
      }
    }
    return out.sort((a, b) => b.count - a.count).slice(0, 5);
  }, [data]);

  if (cameras.length === 0) {
    return <Empty message={t("heatmap_select_camera")} />;
  }

  return (
    <div className="space-y-4">
      <div className="card p-3 flex flex-wrap gap-4 items-end">
        <div className="text-sm">
          <label className="text-text-soft block text-xs mb-1 flex items-center gap-1">
            <Cctv className="w-3.5 h-3.5" /> {t("heatmap_camera")}
          </label>
          <select
            value={cameraId}
            onChange={(e) => setCameraId(e.target.value)}
            className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm"
          >
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="text-sm">
          <label className="text-text-soft block text-xs mb-1">{t("heatmap_window")}</label>
          <select
            value={hours}
            onChange={(e) => setHours(parseInt(e.target.value, 10))}
            className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm"
          >
            <option value={1}>1h</option>
            <option value={6}>6h</option>
            <option value={24}>24h</option>
            <option value={72}>3d</option>
            <option value={168}>7d</option>
          </select>
        </div>
        {data && (
          <div className="ml-auto text-xs text-text-muted">
            {t("heatmap_samples")}: <span className="font-mono text-text">{data.samples}</span>
          </div>
        )}
      </div>

      <div className="card p-3">
        {loading && (
          <div className="aspect-video flex items-center justify-center">
            <Spinner />
          </div>
        )}
        {!loading && err && (
          <div className="text-sm text-danger-ring">{err}</div>
        )}
        {!loading && !err && data && data.samples === 0 && (
          <div className="aspect-video flex items-center justify-center text-sm text-text-muted">
            {t("heatmap_no_data")}
          </div>
        )}
        {!loading && !err && data && data.samples > 0 && (
          <div className="relative aspect-video w-full bg-bg-tertiary rounded overflow-hidden">
            <canvas
              ref={canvasRef}
              width={1280}
              height={720}
              className="w-full h-full"
            />
            <div className="absolute bottom-1 right-1 flex items-center gap-2 text-[10px] text-text px-1.5 py-0.5 rounded bg-bg/60 backdrop-blur">
              <Flame className="w-3 h-3" /> max {data.grid.max}
            </div>
          </div>
        )}
      </div>

      {topCells.length > 0 && data && (
        <div className="card p-3">
          <div className="text-xs text-text-soft mb-2">Top 5 hottest cells</div>
          <div className="grid grid-cols-5 gap-2">
            {topCells.map((c, i) => (
              <div key={i} className="bg-bg-tertiary rounded p-2 text-center">
                <div className="text-[10px] text-text-muted">
                  ({c.ix},{c.iy})
                </div>
                <div className="text-base font-semibold text-text">{c.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function drawHeatmap(ctx: CanvasRenderingContext2D, W: number, H: number, data: HeatmapPayload) {
  ctx.clearRect(0, 0, W, H);
  const { w, h, cells, max } = data.grid;
  if (max === 0) return;
  const cellW = W / w;
  const cellH = H / h;
  // Soft halo via radial gradient per cell — GPU-friendly, no pixel-buffer loop.
  ctx.globalCompositeOperation = "lighter";
  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      const c = cells[iy * w + ix];
      if (c === 0) continue;
      const norm = c / max;
      const cx = (ix + 0.5) * cellW;
      const cy = (iy + 0.5) * cellH;
      const radius = Math.max(cellW, cellH) * 1.6;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, colorForIntensity(norm));
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.4 + norm * 0.55;
      ctx.fillStyle = grad;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

function colorForIntensity(t: number): string {
  // Viridis-ish ramp: dark blue → cyan → green → yellow → red
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [49, 54, 149]],
    [0.25, [34, 211, 238]],
    [0.5, [134, 239, 172]],
    [0.75, [250, 204, 21]],
    [1.0, [239, 68, 68]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (t >= a && t <= b) {
      const f = (t - a) / Math.max(b - a, 1e-6);
      const r = Math.round(ca[0] + (cb[0] - ca[0]) * f);
      const g = Math.round(ca[1] + (cb[1] - ca[1]) * f);
      const bl = Math.round(ca[2] + (cb[2] - ca[2]) * f);
      return `rgb(${r}, ${g}, ${bl})`;
    }
  }
  return "rgb(239, 68, 68)";
}

