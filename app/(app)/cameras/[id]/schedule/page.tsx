import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  addScheduleAction,
  deleteScheduleAction,
  setMaskDefaultAction,
} from "./actions";

export const dynamic = "force-dynamic";

interface ScheduleRow {
  id: string;
  window_mode: "masked" | "revealed";
  starts_at: string;
  ends_at: string;
  weekdays: number;
  note: string | null;
  created_at: string;
}

const WEEKDAY_NAMES_MN = ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"];

function weekdaysLabel(mask: number): string {
  if (mask === 127) return "Өдөр бүр";
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    if (mask & (1 << i)) parts.push(WEEKDAY_NAMES_MN[i]!);
  }
  return parts.join(", ");
}

export default async function CameraSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const svc = createServiceClient();
  const { data: camera } = await svc
    .from("cameras")
    .select("id, name, cam_type, mask_default")
    .eq("id", id)
    .single();

  if (!camera) notFound();

  const { data: schedules } = await svc
    .from("masking_schedules")
    .select("id, window_mode, starts_at, ends_at, weekdays, note, created_at")
    .eq("camera_id", id)
    .order("starts_at");

  const rows = (schedules ?? []) as ScheduleRow[];

  // Evaluate current effective mode
  const { data: nowMode } = await svc.rpc("effective_mask_mode", {
    p_camera_id: id,
  });

  return (
    <>
      <Link
        href="/cameras"
        className="text-sm text-neutral-400 hover:text-neutral-100 inline-flex items-center gap-1.5 mb-3"
      >
        <ArrowLeft className="w-4 h-4" />
        Камер
      </Link>

      <PageHeader
        title={`Хуваарь — ${camera.name}`}
        subtitle="Цаг тус бүрд masked / revealed горимыг сонгох. Хоосон бол default → 24/7 mask."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 mt-4">
        <div className="space-y-4">
          {/* Add new schedule */}
          <form action={addScheduleAction} className="card space-y-3">
            <h3 className="text-sm font-semibold">Шинэ window нэмэх</h3>
            <input type="hidden" name="camera_id" value={camera.id} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <select name="window_mode" defaultValue="revealed" className="input text-sm">
                <option value="revealed">Илрэх (revealed)</option>
                <option value="masked">Мaскгүй (masked)</option>
              </select>
              <input
                name="starts_at"
                placeholder="HH:MM"
                pattern="[0-2][0-9]:[0-5][0-9]"
                defaultValue="09:00"
                required
                className="input text-sm"
              />
              <input
                name="ends_at"
                placeholder="HH:MM"
                pattern="[0-2][0-9]:[0-5][0-9]"
                defaultValue="18:00"
                required
                className="input text-sm"
              />
              <input
                name="weekdays"
                placeholder="weekdays bitmask"
                defaultValue={127}
                min={1}
                max={127}
                type="number"
                required
                className="input text-sm"
                title="1=Sun, 2=Mon, ..., 64=Sat. Sum (127 = every day, 62 = Mon-Fri)."
              />
            </div>
            <input
              name="note"
              placeholder="Тэмдэглэл (optional) — ажлын цаг гэх мэт"
              maxLength={200}
              className="input text-sm"
            />
            <p className="text-[10px] text-neutral-500 leading-relaxed">
              Жишээ: 127 = өдөр бүр · 62 = Да-Ба ажлын өдрүүд · 65 = Ня+Бя амралт ·
              Дотор нь нийлүүлсэн bitmask: Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64.
            </p>
            <button type="submit" className="btn-primary w-full">
              Window нэмэх
            </button>
          </form>

          {/* Schedule list */}
          <div className="card p-0">
            <table className="w-full text-sm">
              <thead className="bg-bg-tertiary/50">
                <tr className="text-xs uppercase tracking-wide text-neutral-400">
                  <th className="px-4 py-2.5 text-left">Горим</th>
                  <th className="px-4 py-2.5 text-left">Цаг</th>
                  <th className="px-4 py-2.5 text-left">Өдрүүд</th>
                  <th className="px-4 py-2.5 text-left">Тэмдэглэл</th>
                  <th className="px-4 py-2.5 text-right">Үйлдэл</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-xs text-neutral-500">
                      Window бүртгэгдээгүй — default ({camera.mask_default}) ажиллаж байна.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5">
                        <span
                          className={`badge ${
                            r.window_mode === "masked"
                              ? "bg-accent/15 text-accent"
                              : "bg-warning/15 text-warning"
                          }`}
                        >
                          {r.window_mode}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono">
                        {r.starts_at.slice(0, 5)} – {r.ends_at.slice(0, 5)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-neutral-400">
                        {weekdaysLabel(r.weekdays)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-neutral-500">
                        {r.note ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <form action={deleteScheduleAction} className="inline">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="camera_id" value={camera.id} />
                          <button
                            type="submit"
                            className="p-1.5 rounded hover:bg-danger/15 text-neutral-400 hover:text-danger"
                            title="Устгах"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right side: default + current state */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-xs uppercase tracking-wide text-neutral-400 mb-2">
              Одоогийн төлөв
            </h3>
            <div
              className={`text-2xl font-bold ${
                nowMode === "masked" ? "text-accent" : "text-warning"
              }`}
            >
              {nowMode ?? "masked"}
            </div>
            <p className="text-[10px] text-neutral-500 mt-1">
              Asia/Seoul цагаар одоо. Шинэ recording-д энэ горим хэрэглэгдэнэ.
            </p>
          </div>

          <form action={setMaskDefaultAction} className="card space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-neutral-400">
              Default горим (window-аас гадуур)
            </h3>
            <input type="hidden" name="camera_id" value={camera.id} />
            <select
              name="mask_default"
              defaultValue={camera.mask_default}
              className="input text-sm"
            >
              <option value="masked">Masked (24/7 maskingtei — recommended)</option>
              <option value="revealed">Revealed (window-уудаас зөвхөн masked үед)</option>
            </select>
            <button type="submit" className="btn-secondary w-full text-sm">
              Хадгалах
            </button>
            <p className="text-[10px] text-neutral-500 leading-relaxed">
              ⚠️ &quot;Revealed&quot; default нь privacy-preserving шаардлагыг сулруулна.
              Зөвхөн хатуу хяналттай ажлын талбарт.
            </p>
          </form>
        </div>
      </div>
    </>
  );
}
