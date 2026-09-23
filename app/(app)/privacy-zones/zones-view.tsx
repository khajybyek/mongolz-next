"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, Plus, Trash2, Cctv, AlertTriangle, ShieldOff } from "lucide-react";
import { Empty } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/lib/i18n/client";
import { formatDate } from "@/lib/utils";
import { TotpPrompt } from "@/components/totp-prompt";
import { useToast } from "@/components/ui/toast";

/** JSON body or null — a non-JSON answer (HTML error page) must not throw. */
async function readJson(r: Response): Promise<{ error?: string; zones?: unknown[] } | null> {
  return (await r.json().catch(() => null)) as { error?: string; zones?: unknown[] } | null;
}

type Camera = { id: string; name: string };
type Zone = {
  id: string;
  camera_id: string;
  name: string;
  reason: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  never_reveal: boolean;
  enforce_vip_mask: boolean;
  enabled: boolean;
  created_at: string;
};

type Draft = { x: number; y: number; w: number; h: number } | null;

export function ZonesView({ cameras }: { cameras: Camera[] }) {
  const { t } = useT();
  const [cameraId, setCameraId] = useState(cameras[0]?.id ?? "");
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [neverReveal, setNeverReveal] = useState(true);
  const [vipMask, setVipMask] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const { toast } = useToast();
  // Deleting / disabling / loosening a zone needs a fresh TOTP step-up; the
  // refused request is parked here and replayed after a correct code.
  const [needsTotp, setNeedsTotp] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);

  /** true when the response was a step-up refusal (prompt opened). */
  function needsStepUp(r: Response, j: { error?: string } | null, retry: () => void): boolean {
    if (r.status === 403 && j?.error === "REAUTH_REQUIRED") {
      retryRef.current = retry;
      setNeedsTotp(true);
      return true;
    }
    return false;
  }

  const refresh = useCallback(async () => {
    if (!cameraId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`/api/privacy-zones?camera_id=${cameraId}`, { cache: "no-store" });
      const j = await readJson(r);
      if (r.ok) setZones((j?.zones ?? []) as Zone[]);
      else setErr(j?.error ?? `HTTP ${r.status}`);
    } finally {
      setLoading(false);
    }
  }, [cameraId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function pointerToNorm(e: React.PointerEvent) {
    const el = canvasRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  function onPointerDown(e: React.PointerEvent) {
    const p = pointerToNorm(e);
    if (!p) return;
    dragRef.current = p;
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const start = dragRef.current;
    if (!start) return;
    const p = pointerToNorm(e);
    if (!p) return;
    setDraft({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    });
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  async function saveZone() {
    if (!draft || !name || !cameraId) return;
    if (draft.w < 0.02 || draft.h < 0.02) {
      setErr(t("zones_too_small"));
      return;
    }
    setBusy("create");
    setErr(null);
    try {
      const r = await fetch("/api/privacy-zones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          camera_id: cameraId,
          name,
          reason: reason || undefined,
          x: draft.x,
          y: draft.y,
          w: draft.w,
          h: draft.h,
          never_reveal: neverReveal,
          enforce_vip_mask: vipMask,
        }),
      });
      const j = await readJson(r);
      if (needsStepUp(r, j, () => void saveZone())) return;
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setDraft(null);
      setName("");
      setReason("");
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteZone(id: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/privacy-zones?id=${id}`, { method: "DELETE" });
      const j = await readJson(r);
      if (needsStepUp(r, j, () => void deleteZone(id))) return;
      if (!r.ok) {
        toast({ title: t("toast_failed"), description: j?.error ?? `HTTP ${r.status}`, tone: "danger" });
      }
      await refresh();
    } catch {
      toast({ title: t("toast_failed"), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(zone: Zone) {
    setBusy(zone.id);
    try {
      const r = await fetch("/api/privacy-zones", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: zone.id, enabled: !zone.enabled }),
      });
      const j = await readJson(r);
      if (needsStepUp(r, j, () => void toggleEnabled(zone))) return;
      if (!r.ok) {
        toast({ title: t("toast_failed"), description: j?.error ?? `HTTP ${r.status}`, tone: "danger" });
      }
      await refresh();
    } catch {
      toast({ title: t("toast_failed"), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  if (cameras.length === 0) {
    return <Empty message={t("zones_no_cameras")} />;
  }

  return (
    <>
    <TotpPrompt
      open={needsTotp}
      onClose={() => {
        setNeedsTotp(false);
        retryRef.current = null;
        setErr(t("step_up_required"));
      }}
      onSuccess={() => {
        setNeedsTotp(false);
        const retry = retryRef.current;
        retryRef.current = null;
        retry?.();
      }}
    />
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-4">
        <div className="card p-3 flex items-end gap-3">
          <div>
            <label className="label flex items-center gap-1">
              <Cctv className="w-3.5 h-3.5" /> {t("zones_camera")}
            </label>
            <select
              value={cameraId}
              onChange={(e) => {
                setCameraId(e.target.value);
                setDraft(null);
              }}
              className="select"
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="text-xs text-text-muted ml-auto">{t("zones_draw_hint")}</div>
        </div>

        {/* Drawing canvas — 16:9 aspect, normalised coordinate system */}
        <div className="card p-3">
          <div
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative aspect-video w-full bg-bg-tertiary rounded overflow-hidden select-none cursor-crosshair touch-none"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
              backgroundSize: "8.33% 11.11%",
            }}
          >
            {/* Existing zones */}
            {zones.map((z) => (
              <div
                key={z.id}
                className={
                  "absolute rounded border-2 " +
                  (z.enabled
                    ? "border-danger/70 bg-danger/15"
                    : "border-text-faint/40 bg-text-muted/5")
                }
                style={{
                  left: `${z.x * 100}%`,
                  top: `${z.y * 100}%`,
                  width: `${z.w * 100}%`,
                  height: `${z.h * 100}%`,
                }}
              >
                <span className="absolute top-0 left-0 text-[9px] px-1 bg-bg/80 text-text">
                  {z.name}
                </span>
              </div>
            ))}
            {/* Draft preview */}
            {draft && (
              <div
                className="absolute rounded border-2 border-accent bg-accent/20"
                style={{
                  left: `${draft.x * 100}%`,
                  top: `${draft.y * 100}%`,
                  width: `${draft.w * 100}%`,
                  height: `${draft.h * 100}%`,
                }}
              />
            )}
          </div>
        </div>
      </div>

      <aside className="space-y-3">
        <div className="card p-3 space-y-2">
          <h3 className="section-title flex items-center gap-2">
            <Plus className="w-4 h-4 text-accent" /> {t("zones_new")}
          </h3>
          <input
            type="text"
            placeholder={t("zones_name_placeholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
          <textarea
            placeholder={t("zones_reason_placeholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="input resize-none"
          />
          <label className="flex items-center gap-2 text-xs text-text-soft">
            <input type="checkbox" checked={neverReveal} onChange={(e) => setNeverReveal(e.target.checked)} />
            {t("zones_never_reveal")}
          </label>
          <label className="flex items-center gap-2 text-xs text-text-soft">
            <input type="checkbox" checked={vipMask} onChange={(e) => setVipMask(e.target.checked)} />
            {t("zones_vip_mask")}
          </label>
          {err && (
            <div className="helper-error flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> {err}
            </div>
          )}
          <button
            type="button"
            onClick={saveZone}
            disabled={!draft || !name || busy === "create"}
            className="btn-primary w-full"
          >
            {busy === "create" ? <Spinner /> : t("zones_save")}
          </button>
        </div>

        <div className="card p-3 space-y-2">
          <h3 className="section-title flex items-center gap-2">
            <Lock className="w-4 h-4 text-accent" /> {t("zones_existing")}
          </h3>
          {loading ? (
            <Spinner />
          ) : zones.length === 0 ? (
            <Empty message={t("zones_none")} icon={Lock} />
          ) : (
            <ul className="space-y-1.5">
              {zones.map((z) => (
                <li key={z.id} className="flex items-start gap-2 text-xs">
                  <span className={"mt-1 w-2 h-2 rounded-full shrink-0 " + (z.enabled ? "bg-danger" : "bg-text-faint")} />
                  <div className="flex-1 min-w-0">
                    <div className="text-text truncate">{z.name}</div>
                    <div className="text-text-faint text-[10px] truncate">
                      {formatDate(z.created_at)} · {(z.w * z.h * 100).toFixed(1)}%
                    </div>
                    {z.reason && (
                      <div className="text-text-muted text-[10px] truncate" title={z.reason}>
                        {z.reason}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleEnabled(z)}
                    disabled={busy === z.id}
                    title={z.enabled ? t("zones_disable") : t("zones_enable")}
                    className="btn-icon"
                  >
                    <ShieldOff className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteZone(z.id)}
                    disabled={busy === z.id}
                    title={t("delete_btn")}
                    aria-label={t("delete_btn")}
                    className="btn-icon hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
    </>
  );
}
