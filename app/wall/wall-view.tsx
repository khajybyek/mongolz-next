"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Cctv, ImageOff, Maximize2, Minimize2, LogOut, Power } from "lucide-react";
import { FaceThumb } from "@/components/face-thumb";
import { useT } from "@/lib/i18n/client";
import { formatDate } from "@/lib/utils";

type WallCamera = {
  camera_id: string;
  name: string;
  enabled: boolean;
  status: "healthy" | "stale" | "offline" | "unknown";
  last_seen: string | null;
  faces_24h: number;
  faces_1h: number;
  latest_face_id: string | null;
};

const REFRESH_MS = 10_000;

export function WallView({
  cameras,
  isAdmin,
}: {
  cameras: WallCamera[];
  isAdmin: boolean;
}) {
  const { t } = useT();
  const router = useRouter();
  const [isFull, setIsFull] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Auto-refresh server data every 10s — fresh latest-face thumbnails +
  // updated health rollups.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  useEffect(() => {
    function onFsChange() {
      setIsFull(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await rootRef.current?.requestFullscreen?.();
    }
  }

  if (cameras.length === 0) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 text-text-muted">
        <Power className="w-16 h-16" />
        <div className="text-lg">{t("wall_no_cameras")}</div>
      </div>
    );
  }

  // Grid sizing — 1, 2, 4, 9, 16 layouts based on camera count.
  const n = cameras.length;
  const cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;

  const display = focused
    ? cameras.filter((c) => c.camera_id === focused)
    : cameras;

  return (
    <div ref={rootRef} className="min-h-screen bg-bg flex flex-col">
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface/40 backdrop-blur">
        <div className="flex items-center gap-3">
          <Cctv className="w-5 h-5 text-accent" />
          <div>
            <div className="text-sm font-bold tracking-tight">{t("wall_title")}</div>
            <div className="text-[10px] text-text-muted">
              {n} {t("wall_cameras")} · auto-refresh 10s
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <a href="/dashboard" className="btn-ghost text-xs">
            ← {t("wall_back")}
          </a>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="btn-ghost p-2"
            aria-label={isFull ? t("wall_exit_fs") : t("wall_enter_fs")}
            title={isFull ? t("wall_exit_fs") : t("wall_enter_fs")}
          >
            {isFull ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <form action="/auth/logout" method="post">
            <button type="submit" className="btn-ghost p-2" aria-label={t("logout")} title={t("logout")}>
              <LogOut className="w-4 h-4" />
            </button>
          </form>
        </div>
      </header>

      <main
        className={
          "flex-1 grid gap-1 p-1 " +
          (focused ? "grid-cols-1" : `grid-cols-${cols}`)
        }
        style={focused ? undefined : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {display.map((c) => (
          <CameraTile
            key={c.camera_id}
            cam={c}
            isAdmin={isAdmin}
            focused={focused === c.camera_id}
            onToggleFocus={() =>
              setFocused((cur) => (cur === c.camera_id ? null : c.camera_id))
            }
          />
        ))}
      </main>
    </div>
  );
}

function CameraTile({
  cam,
  isAdmin,
  focused,
  onToggleFocus,
}: {
  cam: WallCamera;
  isAdmin: boolean;
  focused: boolean;
  onToggleFocus: () => void;
}) {
  const { t } = useT();
  const statusColor =
    cam.status === "healthy"
      ? "bg-success animate-pulse"
      : cam.status === "stale"
        ? "bg-warning"
        : cam.status === "offline"
          ? "bg-danger"
          : "bg-text-muted";
  const statusTone =
    cam.status === "healthy"
      ? "text-success"
      : cam.status === "stale"
        ? "text-warning"
        : cam.status === "offline"
          ? "text-danger"
          : "text-text-muted";

  return (
    <button
      type="button"
      onClick={onToggleFocus}
      className={
        "relative bg-black rounded overflow-hidden group cursor-pointer border border-border hover:border-accent/40 transition" +
        (focused ? " min-h-[calc(100vh-100px)]" : "")
      }
    >
      {cam.latest_face_id ? (
        <FaceThumb
          faceId={cam.latest_face_id}
          alt={cam.name}
          className="absolute inset-0 opacity-90"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-text-faint">
          <ImageOff className="w-12 h-12 opacity-40" />
        </div>
      )}

      {/* Top-left: camera name + status dot */}
      <div className="absolute top-2 left-2 flex items-center gap-2 bg-bg/70 backdrop-blur rounded px-2 py-1 text-xs">
        <span className={"w-2 h-2 rounded-full " + statusColor} />
        <span className="font-semibold truncate max-w-[200px]">{cam.name}</span>
      </div>

      {/* Top-right: status text */}
      {isAdmin && (
        <div className="absolute top-2 right-2 bg-bg/70 backdrop-blur rounded px-2 py-1 text-[10px] uppercase tracking-wider">
          <span className={statusTone}>{cam.status}</span>
        </div>
      )}

      {/* Bottom strip */}
      {isAdmin && (
        <div className="absolute bottom-0 inset-x-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent text-[10px] text-white/90 px-2 py-1.5">
          <span>
            {cam.last_seen ? `${t("wall_last")}: ${formatDate(cam.last_seen)}` : t("cam_status_unknown")}
          </span>
          <span className="font-mono">
            {cam.faces_1h} / 1h · {cam.faces_24h} / 24h
          </span>
        </div>
      )}
    </button>
  );
}
