"use client";

import { useState } from "react";
import { Play, Square, Loader2, Maximize2 } from "lucide-react";
import { HlsPlayer } from "@/components/hls-player";
import { startCameraAction, stopCameraAction, getStreamTicketAction } from "../live/actions";

interface Camera {
  id: string;
  name: string;
  cam_type: string;
  enabled: boolean;
}

type GridSize = 1 | 4 | 9;

export function MultiCameraGrid({ cameras }: { cameras: Camera[] }) {
  const [activeStreams, setActiveStreams] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [gridSize, setGridSize] = useState<GridSize>(4);

  async function toggleCamera(cam: Camera) {
    if (activeStreams.has(cam.id)) {
      try {
        await stopCameraAction(cam.id);
      } catch {}
      setActiveStreams((prev) => {
        const next = new Map(prev);
        next.delete(cam.id);
        return next;
      });
    } else {
      setLoading((prev) => new Set(prev).add(cam.id));
      try {
        await startCameraAction(cam.id);
        const ticket = await getStreamTicketAction(cam.id);
        const url = `/api/ml/stream/${encodeURIComponent(cam.id)}/index.m3u8?ticket=${encodeURIComponent(ticket)}`;
        setActiveStreams((prev) => new Map(prev).set(cam.id, url));
      } catch {}
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(cam.id);
        return next;
      });
    }
  }

  const gridCols = gridSize === 1 ? "grid-cols-1" : gridSize === 4 ? "grid-cols-2" : "grid-cols-3";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {([1, 4, 9] as GridSize[]).map((s) => (
          <button
            key={s}
            onClick={() => setGridSize(s)}
            className={`px-3 py-1.5 rounded-md text-sm transition ${
              gridSize === s ? "bg-accent/15 text-accent" : "text-neutral-400 hover:bg-white/5"
            }`}
          >
            {s === 1 ? <Maximize2 className="w-4 h-4" /> : s === 4 ? "2x2" : "3x3"}
          </button>
        ))}

        <div className="ml-auto text-xs text-neutral-500">
          {activeStreams.size} / {cameras.length} active
        </div>
      </div>

      <div className={`grid ${gridCols} gap-2`}>
        {cameras.slice(0, gridSize).map((cam) => {
          const streamUrl = activeStreams.get(cam.id);
          const isLoading = loading.has(cam.id);

          return (
            <div key={cam.id} className="card p-0 overflow-hidden">
              <div className="aspect-video bg-black relative">
                {streamUrl ? (
                  <HlsPlayer src={streamUrl} className="w-full h-full" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-600 text-xs">
                    {cam.name}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs font-medium truncate">{cam.name}</span>
                <button
                  onClick={() => toggleCamera(cam)}
                  disabled={isLoading}
                  className={`p-1.5 rounded ${streamUrl ? "text-danger hover:bg-danger/15" : "text-accent hover:bg-accent/15"}`}
                >
                  {isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : streamUrl ? (
                    <Square className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
