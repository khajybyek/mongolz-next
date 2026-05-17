"use client";

import { useState, useEffect } from "react";
import { Sparkles, Loader2 } from "lucide-react";
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

export function ThresholdsCard() {
  const { t } = useT();
  const [data, setData] = useState<ThresholdSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/alerts/suggested-thresholds");
      const j = await res.json();
      setData(j.suspects ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="card mb-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-medium">{t("al_suggested_thresholds")}</h3>
        <button onClick={load} disabled={loading} className="btn-ghost btn-sm ml-auto">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("refresh")}
        </button>
      </div>

      {!data ? (
        <p className="text-xs text-text-muted">{t("loading_dots")}</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-text-muted">{t("no_suspects_yet")}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {data.map((s) => (
            <div key={s.suspect_id} className="bg-surface-elevated border border-border rounded-lg p-3 space-y-1">
              <div className="text-xs font-medium truncate text-text">{s.suspect_name}</div>
              {s.total_labeled === 0 ? (
                <div className="text-2xs text-text-muted">{t("no_labels")}</div>
              ) : (
                <>
                  <div className="text-2xl font-bold font-mono text-accent">
                    {s.suggested_threshold != null
                      ? Number(s.suggested_threshold).toFixed(2)
                      : "—"}
                  </div>
                  <div className="text-2xs text-text-muted">
                    {s.tp_count} TP · {s.fp_count} FP · {s.total_labeled} {t("total_lower")}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-2xs text-text-muted leading-relaxed">{t("al_threshold_hint")}</p>
    </div>
  );
}
