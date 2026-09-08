"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Loader2, Check, Wand2, AlertTriangle } from "lucide-react";
import { useT } from "@/lib/i18n/client";

interface ThresholdSuggestion {
  suspect_id: string;
  suspect_name: string;
  suggested_threshold: number | null;
  tp_count: number;
  fp_count: number;
  total_labeled: number;
  error?: string;
}

interface RuleFloor {
  suspect_id: string | null;
  rule_id: string;
  name: string;
  min_similarity: number;
  enabled: boolean;
  managed: boolean;
}

interface FloorsResponse {
  detection_gate: number;
  global_floor: number | null;
  floors: RuleFloor[];
}

/**
 * Suggested review thresholds + the alert-rule floor they can be saved into.
 *
 * The card deliberately does NOT call the suggestion a filter. Applying it
 * writes `alert_rules.min_similarity`, which decides which rule *governs* a
 * match (dedup window, burst smoothing, quiet hours) — not whether the alert
 * is created. That decision belongs to the ML detection gate, so a floor
 * above the gate leaves a band of matches alerting outside every rule. The
 * card states that band instead of letting the number imply suppression.
 */
export function ThresholdsCard() {
  const { t } = useT();
  const [data, setData] = useState<ThresholdSuggestion[] | null>(null);
  const [rules, setRules] = useState<FloorsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyState, setApplyState] = useState<
    Record<string, "idle" | "busy" | "applied" | "error">
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [suggested, floors] = await Promise.all([
        fetch("/api/alerts/suggested-thresholds").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/alerts/apply-threshold").then((r) => (r.ok ? r.json() : null)),
      ]);
      setData(suggested?.suspects ?? []);
      setRules(floors ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const gate = rules?.detection_gate ?? null;
  const floorFor = (suspectId: string) =>
    rules?.floors.find((f) => f.suspect_id === suspectId) ?? null;

  async function applyOne(s: ThresholdSuggestion) {
    if (s.suggested_threshold == null) return;
    setApplyState((p) => ({ ...p, [s.suspect_id]: "busy" }));
    try {
      const res = await fetch("/api/alerts/apply-threshold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suspect_id: s.suspect_id,
          threshold: Number(s.suggested_threshold),
        }),
      });
      if (!res.ok) throw new Error("apply failed");
      setApplyState((p) => ({ ...p, [s.suspect_id]: "applied" }));
      await load(); // show the floor that is actually stored now
      setTimeout(() => {
        setApplyState((p) => ({ ...p, [s.suspect_id]: "idle" }));
      }, 2500);
    } catch {
      setApplyState((p) => ({ ...p, [s.suspect_id]: "error" }));
      setTimeout(() => {
        setApplyState((p) => ({ ...p, [s.suspect_id]: "idle" }));
      }, 3000);
    }
  }

  return (
    <div className="card mb-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-medium">{t("al_review_thresholds")}</h3>
        <button onClick={() => void load()} disabled={loading} className="btn-ghost btn-sm ml-auto">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("refresh")}
        </button>
      </div>

      {!data ? (
        <p className="text-xs text-text-muted">{t("loading_dots")}</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-text-muted">{t("no_suspects_yet")}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {data.map((s) => {
            const st = applyState[s.suspect_id] ?? "idle";
            const suggestion =
              s.suggested_threshold != null ? Number(s.suggested_threshold) : null;
            const canApply = suggestion != null && s.total_labeled >= 5;
            const floor = floorFor(s.suspect_id);
            const leavesBand = suggestion != null && gate != null && suggestion > gate;
            return (
              <div
                key={s.suspect_id}
                className="bg-surface-elevated border border-border rounded-lg p-3 space-y-2"
              >
                <div className="text-xs font-medium truncate text-text">{s.suspect_name}</div>
                {s.total_labeled === 0 ? (
                  <div className="text-2xs text-text-muted">{t("no_labels")}</div>
                ) : (
                  <>
                    <div className="text-2xl font-bold font-mono text-accent">
                      {suggestion != null ? suggestion.toFixed(2) : "—"}
                    </div>
                    <div className="text-2xs text-text-muted">
                      {s.tp_count} TP · {s.fp_count} FP · {s.total_labeled} {t("total_lower")}
                    </div>

                    <div className="text-2xs text-text-muted flex items-center justify-between gap-2">
                      <span>{t("al_current_floor")}</span>
                      <span className="font-mono text-text-soft">
                        {floor ? `≥ ${floor.min_similarity.toFixed(2)}` : t("al_no_rule")}
                      </span>
                    </div>

                    {canApply && (
                      <button
                        type="button"
                        onClick={() => applyOne(s)}
                        disabled={st === "busy"}
                        className={
                          st === "applied"
                            ? "btn-success btn-sm w-full"
                            : st === "error"
                            ? "btn-danger btn-sm w-full"
                            : "btn-secondary btn-sm w-full"
                        }
                      >
                        {st === "busy" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : st === "applied" ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <Wand2 className="w-3 h-3" />
                        )}
                        {st === "busy"
                          ? t("autotune_busy")
                          : st === "applied"
                          ? t("autotune_applied")
                          : st === "error"
                          ? t("autotune_error")
                          : t("al_set_rule_floor")}
                      </button>
                    )}

                    {canApply && leavesBand && (
                      <p className="text-2xs text-warning leading-relaxed flex gap-1.5">
                        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                        <span>{t("al_floor_band_warning")}</span>
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-2xs text-text-muted leading-relaxed">{t("al_floor_explainer")}</p>
      {rules && (
        <p className="text-2xs text-text-faint leading-relaxed">
          {t("al_detection_gate")}: <span className="font-mono">{rules.detection_gate.toFixed(2)}</span>
          {" · "}
          {t("al_global_floor")}:{" "}
          <span className="font-mono">
            {rules.global_floor != null ? rules.global_floor.toFixed(2) : t("al_no_rule")}
          </span>
        </p>
      )}
    </div>
  );
}
